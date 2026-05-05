// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Type definitions for the Amnesia undo/redo library.
 *
 * Amnesia is a runtime command-history store. Commands are imperative
 * `do` / `undo` pairs that the application registers as actions occur.
 * The store is **in-memory only**: closures are not serializable, so an
 * undo stack does not survive a page reload by itself.
 *
 * For state that must survive reloads, persist the underlying value via a
 * separate mechanism (e.g. `react-mnemonic`) and reconstruct fresh
 * undo entries on the next session.
 */

/**
 * A single reversible action on the history.
 *
 * Commands are stored as a pair of imperative thunks:
 *
 * - `redo()` — apply the action (called on every redo, and on initial push
 *   when `do` is omitted).
 * - `undo()` — revert the action.
 *
 * An optional `do` field lets the initial application differ from a redo
 * replay. Use it when first-apply requires setup that re-apply does not
 * (e.g. inserting a freshly-created object whose id was just minted).
 *
 * Implementations are responsible for capturing whatever closure state they
 * need to perform the inverse. Amnesia does not introspect the value.
 *
 * All handlers may be synchronous or asynchronous. When a handler returns a
 * Promise, the surrounding `push` / `undo` / `redo` call awaits it; the store
 * stays in a `pending` state for the duration of the await and other concurrent
 * operations are dropped (see `AmnesiaState.pending`).
 */
export interface Command {
    /**
     * Human-readable label, surfaced through the history snapshot. Useful for
     * "Undo last edit" style UI. Optional but recommended.
     */
    label?: string;

    /**
     * Optional initial-apply handler. When present and `push` is called
     * without `applied: true`, `do()` is invoked exactly once at push time
     * instead of `redo()`.
     *
     * `do` is **consumed at push time and is not stored on the entry** —
     * subsequent `redo()` calls always invoke `command.redo`. Use this when
     * the inverse of "first apply" and "re-apply after undo" need different
     * closures (e.g. inserting a freshly-minted node vs. restoring it by id).
     *
     * When `do` is omitted, the store falls back to `redo` for the initial
     * application. Most reversible state changes do not need `do`.
     *
     * May be synchronous or return a Promise.
     */
    do?: () => void | Promise<void>;

    /**
     * Apply (or re-apply) the action.
     *
     * Called on every `redo()` for this entry. Also invoked once on push
     * when `do` is absent and `applied: true` is not set.
     *
     * May be synchronous or return a Promise.
     */
    redo: () => void | Promise<void>;

    /**
     * Revert the action. Called on every `undo()` for this entry.
     *
     * May be synchronous or return a Promise.
     */
    undo: () => void | Promise<void>;

    /**
     * Coalesce key. Consecutive `push`es with the same non-empty key collapse
     * into one entry on the stack: only the most recent `redo` is kept, but
     * the original entry's `undo` is preserved so a single undo restores the
     * pre-coalesce state.
     *
     * Typical use: rapid keystrokes in a text input share a `coalesceKey` like
     * `"edit:title"` so a single Ctrl+Z undoes the burst rather than each key.
     *
     * Coalescing also requires that the new push arrives within
     * `coalesceWindowMs` of the previous one (provider-level setting).
     */
    coalesceKey?: string;

    /**
     * Free-form metadata for tooling. Not interpreted by Amnesia.
     */
    meta?: Record<string, unknown>;
}

/**
 * Public, read-only view of a single history entry.
 *
 * Closures are not exposed. Tools can read `label`, `coalesceKey`, and `meta`
 * to render history UIs without being tempted to invoke entries directly.
 */
export interface HistoryEntry {
    /** Stable id assigned at push time, monotonically increasing within a store. */
    readonly id: number;
    /** Optional label copied from the source command. */
    readonly label?: string;
    /** Coalesce key copied from the source command. */
    readonly coalesceKey?: string;
    /** Metadata copied from the source command. */
    readonly meta?: Record<string, unknown>;
    /** Wall-clock timestamp (ms since epoch) when the entry was pushed. */
    readonly pushedAt: number;
}

/**
 * Snapshot of the store consumed by `useSyncExternalStore`.
 *
 * Snapshots are referentially stable until the next mutation, so
 * `useSyncExternalStore` does not tear and React's re-render bailout
 * remains effective.
 */
export interface AmnesiaState {
    /**
     * Entries available to `undo()`, oldest at index `0` and newest at the
     * end. Same ordering as a typical "history list" UI.
     */
    readonly past: readonly HistoryEntry[];

    /**
     * Entries available to `redo()`, with the next-redo entry at the end.
     */
    readonly future: readonly HistoryEntry[];

    /** Convenience flag — equivalent to `past.length > 0`. */
    readonly canUndo: boolean;

    /** Convenience flag — equivalent to `future.length > 0`. */
    readonly canRedo: boolean;

    /**
     * Monotonic version counter incremented on every mutation. Useful for
     * cache keys or `useEffect` dependency arrays.
     */
    readonly version: number;

    /**
     * Monotonic counter that bumps **only** on `clear()` and provider unmount
     * (`dispose()`). Unlike `version`, incidental pushes / undos / redos do
     * not advance it.
     *
     * Used internally by async operations as an abort token: an in-flight
     * `await` whose `epoch` snapshot disagrees with the current value resolves
     * to a stale-drop and is reported via `onError({ phase: "stale" })`.
     *
     * Application code can also subscribe to `epoch` to detect "the document
     * changed underneath me" without re-rendering on every keystroke.
     */
    readonly epoch: number;

    /**
     * `true` while at least one `push` / `undo` / `redo` has an unresolved
     * Promise in flight. Synchronous handlers complete before any subscriber
     * observes `pending: true`.
     *
     * Concurrent calls while `pending === true` resolve to `null` immediately
     * and are reported via `onError({ phase: "busy" })`.
     */
    readonly pending: boolean;
}

/**
 * Options accepted by `push(command, options)`.
 */
export interface PushOptions {
    /**
     * When `true`, Amnesia assumes the caller has already applied the action
     * and skips the initial `redo()` invocation. The entry still goes onto
     * the stack as if it had just been applied.
     *
     * Defaults to `false` (Amnesia calls `redo()` on push).
     */
    applied?: boolean;
}

/**
 * Error reporter used by the provider when something goes wrong during
 * `push` / `undo` / `redo`.
 *
 * Invocations are **microtask-deferred**: the handler runs after the
 * surrounding operation has finished and the pending set is empty, so a
 * handler is free to call `push` / `undo` / `redo` re-entrantly without
 * looping.
 *
 * The default behavior is to log via `console.error` with the prefix
 * `[Amnesia]`. Pass a custom handler to forward to your error tracker.
 *
 * When a command throws during `undo()` or `redo()`, the entry is **left in
 * place** so the application can retry or recover; this is reported as
 * `phase: "undo" | "redo"` with `recoverable: true`.
 */
export type AmnesiaErrorHandler = (error: unknown, context: AmnesiaErrorContext) => void;

/**
 * Context passed to the provider's `onError` handler.
 *
 * Phases:
 *
 * - `"push"` — the command's `redo` threw on initial application. The entry
 *   is **not** added to the stack; the original error is also re-thrown to
 *   the caller of `push`.
 * - `"undo"` / `"redo"` — the entry's handler threw. The entry stays on its
 *   current stack so the application can retry. `recoverable: true`.
 * - `"busy"` — the call arrived while another op was in flight and was
 *   dropped. `recoverable: true` (the caller can retry after `pending`
 *   becomes false).
 * - `"stale"` — an in-flight async op detected that `clear()` (or
 *   provider unmount) ran during its `await`. The entry is dropped.
 *   `recoverable: false`.
 */
export interface AmnesiaErrorContext {
    /** Which lifecycle phase produced the error. */
    phase: "push" | "undo" | "redo" | "busy" | "stale";
    /** The entry id involved, when known. */
    entryId?: number;
    /** Label of the involved entry, when known. */
    label?: string;
    /**
     * Whether the application could meaningfully retry the operation. `true`
     * for `"undo"` / `"redo"` / `"busy"` failures, `false` for `"push"` and
     * `"stale"`. Always present from the runtime — the optionality is for
     * forward compatibility.
     */
    recoverable?: boolean;
}

/**
 * Configuration for `AmnesiaProvider`.
 */
export interface AmnesiaProviderOptions {
    /**
     * Maximum number of entries retained on the past stack. When the limit is
     * reached, the oldest entry is dropped on every new push.
     *
     * Defaults to `100`. Set to `Infinity` to disable, but be aware closures
     * may retain large amounts of memory.
     */
    capacity?: number;

    /**
     * Maximum time (in milliseconds) between two pushes that share a
     * non-empty `coalesceKey` for them to merge into a single entry.
     *
     * Defaults to `400`.
     */
    coalesceWindowMs?: number;

    /**
     * Custom error reporter for failures inside `redo` / `undo`. See
     * {@link AmnesiaErrorHandler}.
     */
    onError?: AmnesiaErrorHandler;
}

/**
 * Public API exposed by `AmnesiaProvider` and consumed by `useAmnesia()`.
 *
 * The store is intentionally framework-agnostic so non-React layers (e.g.
 * a CodeMirror plugin or a canvas renderer) can interact with it directly
 * via the context bridge.
 */
export interface Amnesia {
    /**
     * Push a new command onto the past stack.
     *
     * By default the command's `redo()` is called immediately. Pass
     * `{ applied: true }` to skip that initial invocation when the caller
     * has already mutated the underlying state.
     *
     * Pushing always clears the future (redo) stack — branching is not
     * supported in the v0 API.
     *
     * Always returns a Promise. For synchronous commands the Promise is
     * already resolved by the time `push` returns (no microtask delay
     * relative to side effects).
     *
     * - Resolves to the entry id on success.
     * - Resolves to `null` when the call was dropped because another op was
     *   in flight (`onError({ phase: "busy" })`) or because `clear()` /
     *   provider unmount raced the await (`onError({ phase: "stale" })`).
     * - Rejects with the original error when the command's `redo` throws on
     *   initial application; the entry is not added to the stack.
     */
    push: (command: Command, options?: PushOptions) => Promise<number | null>;

    /**
     * Undo the most recent past entry. No-op when `canUndo` is false.
     *
     * Resolves to the entry id on success, `null` when nothing was undone or
     * the op was dropped (busy / stale). A handler that throws leaves the
     * entry in place and surfaces via `onError({ phase: "undo" })`.
     */
    undo: () => Promise<number | null>;

    /**
     * Redo the most recent future entry. No-op when `canRedo` is false.
     *
     * Resolves to the entry id on success, `null` when nothing was redone or
     * the op was dropped (busy / stale). A handler that throws leaves the
     * entry in place and surfaces via `onError({ phase: "redo" })`.
     */
    redo: () => Promise<number | null>;

    /**
     * Drop the entire past and future stacks without invoking any commands.
     *
     * Use when the application enters a state where existing history would
     * no longer be valid (e.g. a document switch).
     *
     * `clear()` is always synchronous. It bumps the `epoch` counter so any
     * in-flight async op resolves to a stale-drop on resume.
     */
    clear: () => void;

    /**
     * Tear down the store. Bumps `epoch` and empties the pending set so
     * in-flight async ops resolve as no-ops without committing. Listeners
     * are not notified.
     *
     * Idempotent: safe to call multiple times.
     *
     * `AmnesiaProvider` does **not** call `dispose()` automatically on
     * unmount: doing so would conflict with React 18 StrictMode's simulated
     * effect cleanup. The store will be garbage-collected along with the
     * provider. Call `dispose()` yourself when sharing a store with
     * non-React code that needs explicit teardown.
     */
    dispose: () => void;

    /**
     * Subscribe to store mutations. Returns an unsubscribe function. Mainly
     * used by `useSyncExternalStore`; application code should prefer
     * `useAmnesia()`.
     */
    subscribe: (listener: () => void) => () => void;

    /** Read the latest snapshot. */
    getSnapshot: () => AmnesiaState;
}

/**
 * Options for `useUndoableState`.
 *
 * @template T The state value type.
 */
export interface UseUndoableStateOptions<T> {
    /** Optional label applied to every command pushed by the setter. */
    label?: string;

    /**
     * Coalesce key applied to every command pushed by the setter. Use this to
     * group bursts (typing, dragging) into one entry.
     */
    coalesceKey?: string;

    /**
     * Equality predicate used to suppress no-op writes. Defaults to `Object.is`.
     */
    equals?: (a: T, b: T) => boolean;

    /**
     * Scope id to push entries into. Defaults to `"default"`. The hook pins
     * to this scope rather than tracking the active scope so React state
     * stays bound to a stable history surface even when the user's focus
     * (and the active claim) moves elsewhere.
     */
    scopeId?: string;
}
