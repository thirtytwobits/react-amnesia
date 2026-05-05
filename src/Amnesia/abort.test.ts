// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { describe, expect, it, vi } from "vitest";
import { createAmnesiaStore } from "./history";

const flush = () => Promise.resolve();

describe("createAmnesiaStore — AbortSignal cancellation (Workstream J)", () => {
    it("passes a fresh AbortSignal to every async push handler", async () => {
        const store = createAmnesiaStore();
        let captured: AbortSignal | null = null;
        await store.push({
            redo: async (signal) => {
                captured = signal;
                await Promise.resolve();
            },
            undo: () => undefined,
        });
        expect(captured).toBeInstanceOf(AbortSignal);
        expect(captured!.aborted).toBe(false);
    });

    it("aborts the in-flight signal when clear() runs mid-await", async () => {
        const store = createAmnesiaStore();
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });
        let observedSignal!: AbortSignal;

        const pending = store.push({
            redo: async (signal) => {
                observedSignal = signal;
                await blocker;
            },
            undo: () => undefined,
        });

        // Mid-flight: the signal should not yet be aborted.
        expect(observedSignal.aborted).toBe(false);

        store.clear();
        expect(observedSignal.aborted).toBe(true);

        release();
        const id = await pending;
        await flush();

        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
    });

    it("treats AbortError after signal.aborted as a silent no-op (no onError)", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const pending = store.push({
            redo: async (signal) => {
                await blocker;
                if (signal.aborted) {
                    // The handler observed cancellation and threw AbortError —
                    // matches the contract `fetch(url, { signal })` would
                    // produce naturally.
                    const err = new Error("aborted");
                    err.name = "AbortError";
                    throw err;
                }
            },
            undo: () => undefined,
        });

        store.clear();
        release();
        const id = await pending;
        await flush();
        await flush();

        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
        // Critical: no `onError` event for an honored abort.
        expect(onError).not.toHaveBeenCalled();
    });

    it("still routes non-AbortError throws to onError when not aborted", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        await expect(
            store.push({
                redo: async () => {
                    await Promise.resolve();
                    throw new Error("real failure");
                },
                undo: () => undefined,
            }),
        ).rejects.toThrow(/real failure/);

        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "push" });
    });

    it("when the handler ignores the signal, the commit still drops via the epoch path with phase: stale", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const pending = store.push({
            // Ignores the signal entirely — completes normally.
            redo: async () => {
                await blocker;
            },
            undo: () => undefined,
        });

        store.clear();
        release();
        const id = await pending;
        await flush();

        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
        expect(onError).toHaveBeenCalled();
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "stale", recoverable: false });
    });

    it("dispose() also aborts in-flight signals", async () => {
        const store = createAmnesiaStore();
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });
        let observedSignal!: AbortSignal;

        const pending = store.push({
            redo: async (signal) => {
                observedSignal = signal;
                await blocker;
            },
            undo: () => undefined,
        });

        store.dispose();
        expect(observedSignal.aborted).toBe(true);

        release();
        const id = await pending;
        await flush();
        expect(id).toBeNull();
    });

    it("each operation gets its own controller (signals are not shared between sibling ops)", async () => {
        const store = createAmnesiaStore();

        // Sequential ops: each receives its own signal.
        let signalA!: AbortSignal;
        await store.push({
            redo: async (signal) => {
                signalA = signal;
            },
            undo: () => undefined,
        });

        let signalB!: AbortSignal;
        await store.undo();
        await store.push({
            redo: async (signal) => {
                signalB = signal;
            },
            undo: () => undefined,
        });

        expect(signalA).toBeInstanceOf(AbortSignal);
        expect(signalB).toBeInstanceOf(AbortSignal);
        expect(signalA).not.toBe(signalB);
        // Neither was aborted — each completed normally.
        expect(signalA.aborted).toBe(false);
        expect(signalB.aborted).toBe(false);
    });

    it("transaction work receives an AbortSignal that aborts on clear()", async () => {
        const store = createAmnesiaStore();
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });
        let observedSignal!: AbortSignal;

        const tx = store.transaction(async (txApi, signal) => {
            observedSignal = signal;
            await txApi.push({ redo: () => undefined, undo: () => undefined });
            await blocker;
        });

        expect(observedSignal.aborted).toBe(false);
        store.clear();
        expect(observedSignal.aborted).toBe(true);

        release();
        const id = await tx;
        await flush();
        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
    });

    it("transaction work that honors AbortError rolls back silently with no onError", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });
        let undoRan = false;

        const tx = store.transaction(async (txApi, signal) => {
            await txApi.push({
                redo: () => undefined,
                undo: () => {
                    undoRan = true;
                },
            });
            await blocker;
            if (signal.aborted) {
                const err = new Error("aborted");
                err.name = "AbortError";
                throw err;
            }
        });

        store.clear();
        release();
        const id = await tx;
        await flush();
        await flush();

        expect(id).toBeNull();
        // Rollback ran (the buffered undo executed), but no error was fired
        // because the abort was honored.
        expect(undoRan).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    it("nested transactions share the outer's signal", async () => {
        const store = createAmnesiaStore();
        let outerSignal!: AbortSignal;
        let innerSignal!: AbortSignal;

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const tx = store.transaction(async (_txApi, signal) => {
            outerSignal = signal;
            await store.transaction(async (innerTx, innerSig) => {
                innerSignal = innerSig;
                await innerTx.push({ redo: () => undefined, undo: () => undefined });
            });
            await blocker;
        });

        // Inner signal is the SAME signal object as outer — nested calls
        // flatten and share cancellation.
        expect(innerSignal).toBe(outerSignal);

        store.clear();
        expect(outerSignal.aborted).toBe(true);
        release();
        await tx;
    });

    it("synchronous handlers receive a signal that is never aborted", async () => {
        const store = createAmnesiaStore();
        let captured!: AbortSignal;
        await store.push({
            redo: (signal) => {
                captured = signal;
            },
            undo: () => undefined,
        });
        expect(captured.aborted).toBe(false);
        // Even after subsequent operations the captured signal stays calm.
        await store.push({ redo: () => undefined, undo: () => undefined });
        expect(captured.aborted).toBe(false);
    });

    it("composite undo/redo of a transaction also receives a signal", async () => {
        const store = createAmnesiaStore();
        const seenRedo: AbortSignal[] = [];
        const seenUndo: AbortSignal[] = [];

        await store.transaction(async (tx) => {
            await tx.push({
                redo: (signal) => {
                    seenRedo.push(signal);
                },
                undo: (signal) => {
                    seenUndo.push(signal);
                },
            });
            await tx.push({
                redo: (signal) => {
                    seenRedo.push(signal);
                },
                undo: (signal) => {
                    seenUndo.push(signal);
                },
            });
        });

        // Replay the composite via undo + redo.
        await store.undo();
        await store.redo();

        // Each invocation passed a signal. Composite redo replays in
        // order; composite undo replays in reverse.
        expect(seenUndo.length).toBe(2);
        expect(seenRedo.length).toBe(4); // 2 from initial work + 2 from redo replay
        for (const s of [...seenRedo, ...seenUndo]) {
            expect(s).toBeInstanceOf(AbortSignal);
        }
    });
});
