// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Framework-agnostic implementation of the Amnesia store.
 *
 * The store exposes `push`, `undo`, `redo`, `clear`, `dispose`, `subscribe`,
 * and `getSnapshot`. It does not depend on React. The provider in
 * `provider.tsx` wraps this in a Context so React components can consume it
 * via `useAmnesia()`.
 *
 * Async semantics (since `0.2.0-alpha.1`):
 *
 * - Command handlers may return Promises. While at least one handler is in
 *   flight, the snapshot's `pending` flag is `true` and concurrent
 *   `push` / `undo` / `redo` calls resolve to `null` (reported via
 *   `onError({ phase: "busy" })`).
 * - `clear()` and `dispose()` bump an internal `epoch` counter. An in-flight
 *   op whose `epoch` snapshot disagrees with the current value on resume
 *   resolves to `null` and is reported as `onError({ phase: "stale" })`.
 * - `onError` invocations are microtask-deferred so a handler may safely
 *   re-enter the store via `push` / `undo` / `redo`.
 */

import type {
    Amnesia,
    AmnesiaErrorContext,
    AmnesiaErrorHandler,
    AmnesiaProviderOptions,
    AmnesiaState,
    Command,
    HistoryEntry,
    PushOptions,
} from "./types";

interface InternalEntry extends HistoryEntry {
    redo: () => void | Promise<void>;
    undo: () => void | Promise<void>;
}

const DEFAULT_CAPACITY = 100;
const DEFAULT_COALESCE_WINDOW_MS = 400;

const defaultOnError: AmnesiaErrorHandler = (error, context) => {
    // eslint-disable-next-line no-console
    console.error(`[Amnesia] ${context.phase} failed`, error, context);
};

type OperationPhase = "push" | "undo" | "redo";

/**
 * Build a new Amnesia store instance.
 */
export function createAmnesiaStore(options: AmnesiaProviderOptions = {}): Amnesia {
    const capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    const coalesceWindowMs = Math.max(0, options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS);
    const onError = options.onError ?? defaultOnError;

    let past: InternalEntry[] = [];
    let future: InternalEntry[] = [];
    let version = 0;
    let epoch = 0;
    let nextId = 1;
    let disposed = false;
    const pendingTokens = new Set<symbol>();
    let snapshot: AmnesiaState = freezeSnapshot(past, future, version, epoch, pendingTokens);
    const listeners = new Set<() => void>();

    // Deferred onError queue. Errors are drained only when `pendingTokens` is
    // empty so a handler that calls `push` / `undo` / `redo` always sees a
    // quiescent store and never causes runaway "busy" recursion.
    //
    // - `notify()` calls `drainErrors()` after dispatching listeners. This is
    //   the primary drain trigger: every successful op or `clear()` notifies.
    // - A microtask backstop queued from `scheduleError(...)` covers cases
    //   where no notify follows (e.g. a synchronous `push` whose `redo` throws
    //   and re-throws without committing).
    // - The `flushing` flag makes drains re-entrancy-safe: a handler that
    //   itself causes another op to notify won't recurse.
    const errorQueue: Array<{ error: unknown; context: AmnesiaErrorContext }> = [];
    let flushing = false;

    const drainErrors = (): void => {
        if (flushing) return;
        if (pendingTokens.size > 0) return;
        if (errorQueue.length === 0) return;
        flushing = true;
        try {
            while (errorQueue.length > 0) {
                const next = errorQueue.shift();
                if (!next) break;
                try {
                    onError(next.error, next.context);
                } catch {
                    // Handler failures must not break the store.
                }
            }
        } finally {
            flushing = false;
        }
    };

    const scheduleError = (error: unknown, context: AmnesiaErrorContext): void => {
        errorQueue.push({ error, context });
        // Microtask backstop in case no notify() follows. Cheap when
        // unnecessary — drainErrors no-ops if already drained.
        queueMicrotask(drainErrors);
    };

    const notify = (): void => {
        snapshot = freezeSnapshot(past, future, version, epoch, pendingTokens);
        // Snapshot the listener list so callbacks added or removed during
        // dispatch do not affect the current tick.
        const dispatch = Array.from(listeners);
        for (const listener of dispatch) {
            try {
                listener();
            } catch {
                // Subscriber failures are isolated; the store stays consistent.
            }
        }
        drainErrors();
    };

    const buildErrorContext = (
        phase: AmnesiaErrorContext["phase"],
        recoverable: boolean,
        entry?: InternalEntry,
    ): AmnesiaErrorContext => ({
        phase,
        recoverable,
        ...(entry ? { entryId: entry.id } : {}),
        ...(entry?.label !== undefined ? { label: entry.label } : {}),
    });

    /**
     * Drive an operation through its busy / pending / epoch lifecycle.
     *
     * `prologue` returns the invocation thunk and the commit payload, or
     * `null` when there is nothing to do (e.g. `undo()` on an empty stack).
     * `commit` mutates state and returns the entry id; it runs only when the
     * op is still on the same epoch as when it started.
     *
     * Synchronous handlers take a fast path: a single `notify()` after the
     * commit, identical to the v0.1.0 contract. Async handlers also notify
     * at the start of the await window so subscribers can observe
     * `pending: true`.
     */
    const startOp = async <TWork>(
        phase: OperationPhase,
        prologue: () => { invoke: () => void | Promise<void>; entry?: InternalEntry; payload: TWork } | null,
        commit: (payload: TWork) => number | null,
    ): Promise<number | null> => {
        if (disposed) return null;
        if (pendingTokens.size > 0) {
            scheduleError(undefined, buildErrorContext("busy", true));
            return null;
        }

        const prepared = prologue();
        if (prepared === null) return null;

        const token = Symbol(phase);
        const epochAtStart = epoch;
        pendingTokens.add(token);

        let raw: void | Promise<void>;
        try {
            raw = prepared.invoke();
        } catch (error) {
            pendingTokens.delete(token);
            scheduleError(error, buildErrorContext(phase, phase !== "push", prepared.entry));
            if (phase === "push") throw error;
            return null;
        }

        if (!isThenable(raw)) {
            // Synchronous handler: commit and notify exactly once. No
            // observable `pending: true` state to consumers.
            const id = commit(prepared.payload);
            pendingTokens.delete(token);
            notify();
            return id;
        }

        // Asynchronous handler: announce pending, await, then commit.
        notify();
        try {
            await raw;
        } catch (error) {
            if (epoch === epochAtStart) {
                pendingTokens.delete(token);
                notify();
            }
            scheduleError(error, buildErrorContext(phase, phase !== "push", prepared.entry));
            if (phase === "push") throw error;
            return null;
        }

        // Epoch may have changed if clear() / dispose() ran during the await.
        // clear() / dispose() already cleared the pending set and emitted (or
        // torn down) the store, so we must not touch state.
        if (epoch !== epochAtStart) {
            scheduleError(undefined, buildErrorContext("stale", false, prepared.entry));
            return null;
        }

        const id = commit(prepared.payload);
        pendingTokens.delete(token);
        notify();
        return id;
    };

    const push: Amnesia["push"] = (command: Command, pushOptions?: PushOptions): Promise<number | null> => {
        const applied = pushOptions?.applied === true;

        return startOp(
            "push",
            () => ({
                invoke: applied ? () => undefined : () => command.redo(),
                payload: command,
            }),
            (cmd: Command) => {
                const now = nowMs();
                const previous = past[past.length - 1];
                const canCoalesce =
                    previous !== undefined &&
                    cmd.coalesceKey !== undefined &&
                    cmd.coalesceKey !== "" &&
                    previous.coalesceKey === cmd.coalesceKey &&
                    now - previous.pushedAt <= coalesceWindowMs;

                if (canCoalesce && previous !== undefined) {
                    // Replace the redo with the latest one but keep the
                    // original undo so a single Ctrl+Z reverts the entire
                    // coalesced burst.
                    const merged: InternalEntry = {
                        id: previous.id,
                        pushedAt: now,
                        redo: cmd.redo,
                        undo: previous.undo,
                        ...(cmd.label !== undefined ? { label: cmd.label } : {}),
                        ...(cmd.coalesceKey !== undefined ? { coalesceKey: cmd.coalesceKey } : {}),
                        ...(cmd.meta !== undefined ? { meta: cmd.meta } : {}),
                    };
                    past = [...past.slice(0, -1), merged];
                    future = [];
                    version += 1;
                    return merged.id;
                }

                const entry: InternalEntry = {
                    id: nextId++,
                    pushedAt: now,
                    redo: cmd.redo,
                    undo: cmd.undo,
                    ...(cmd.label !== undefined ? { label: cmd.label } : {}),
                    ...(cmd.coalesceKey !== undefined ? { coalesceKey: cmd.coalesceKey } : {}),
                    ...(cmd.meta !== undefined ? { meta: cmd.meta } : {}),
                };

                past = [...past, entry];
                if (past.length > capacity) {
                    past = past.slice(past.length - capacity);
                }
                future = [];
                version += 1;
                return entry.id;
            },
        );
    };

    const undo: Amnesia["undo"] = (): Promise<number | null> => {
        return startOp(
            "undo",
            () => {
                const entry = past[past.length - 1];
                if (entry === undefined) return null;
                return {
                    invoke: () => entry.undo(),
                    entry,
                    payload: entry,
                };
            },
            (entry: InternalEntry) => {
                past = past.slice(0, -1);
                future = [...future, entry];
                version += 1;
                return entry.id;
            },
        );
    };

    const redo: Amnesia["redo"] = (): Promise<number | null> => {
        return startOp(
            "redo",
            () => {
                const entry = future[future.length - 1];
                if (entry === undefined) return null;
                return {
                    invoke: () => entry.redo(),
                    entry,
                    payload: entry,
                };
            },
            (entry: InternalEntry) => {
                future = future.slice(0, -1);
                past = [...past, entry];
                version += 1;
                return entry.id;
            },
        );
    };

    const clear: Amnesia["clear"] = (): void => {
        if (disposed) return;
        const hadPending = pendingTokens.size > 0;
        if (past.length === 0 && future.length === 0 && !hadPending) return;
        past = [];
        future = [];
        // Bump epoch so any in-flight async op detects the staleness on
        // resume and resolves as a stale-drop without committing.
        epoch += 1;
        pendingTokens.clear();
        version += 1;
        notify();
    };

    const dispose: Amnesia["dispose"] = (): void => {
        if (disposed) return;
        disposed = true;
        // Bump epoch + drop pending tokens so awaiting ops resolve as no-ops.
        // Do not notify subscribers — listeners are typically being torn down
        // by the unmounting provider.
        epoch += 1;
        pendingTokens.clear();
        past = [];
        future = [];
        listeners.clear();
        // Snapshot is still readable (frozen). Refresh it so any post-dispose
        // getSnapshot() reflects the cleared state.
        snapshot = freezeSnapshot(past, future, version, epoch, pendingTokens);
    };

    const subscribe: Amnesia["subscribe"] = (listener) => {
        if (disposed) return () => undefined;
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };

    const getSnapshot: Amnesia["getSnapshot"] = () => snapshot;

    return { push, undo, redo, clear, dispose, subscribe, getSnapshot };
}

function freezeSnapshot(
    past: InternalEntry[],
    future: InternalEntry[],
    version: number,
    epoch: number,
    pendingTokens: ReadonlySet<symbol>,
): AmnesiaState {
    return Object.freeze({
        past: Object.freeze(past.map(toPublic)) as readonly HistoryEntry[],
        future: Object.freeze(future.map(toPublic)) as readonly HistoryEntry[],
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        version,
        epoch,
        pending: pendingTokens.size > 0,
    });
}

function toPublic(entry: InternalEntry): HistoryEntry {
    return Object.freeze({
        id: entry.id,
        pushedAt: entry.pushedAt,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
        ...(entry.coalesceKey !== undefined ? { coalesceKey: entry.coalesceKey } : {}),
        ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
    });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function nowMs(): number {
    return Date.now();
}
