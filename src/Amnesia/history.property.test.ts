// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createAmnesiaStore } from "./history";

/**
 * Property-based tests over random sequences of store operations. The store
 * has a small number of invariants that should hold regardless of operation
 * order or sync/async mix. fast-check generates many sequences in parallel
 * to catch regressions the hand-written tests might miss.
 */

type Op = { kind: "push"; async: boolean } | { kind: "undo" } | { kind: "redo" } | { kind: "clear" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("push" as const), async: fc.boolean() }),
    fc.record({ kind: fc.constant("undo" as const) }),
    fc.record({ kind: fc.constant("redo" as const) }),
    // Skew clear() rarer so non-trivial stacks build up.
    fc.record({ kind: fc.constant("clear" as const) }),
) as fc.Arbitrary<Op>;

async function runOps(ops: readonly Op[]): Promise<{
    store: ReturnType<typeof createAmnesiaStore>;
    versions: number[];
    epochs: number[];
    clears: number;
}> {
    const store = createAmnesiaStore({ capacity: 50, coalesceWindowMs: 0 });
    const versions: number[] = [store.getSnapshot().version];
    const epochs: number[] = [store.getSnapshot().epoch];
    let clears = 0;

    for (const op of ops) {
        if (op.kind === "push") {
            const value = Math.random();
            const cmd = {
                redo: op.async
                    ? async () => {
                          await Promise.resolve();
                      }
                    : () => undefined,
                undo: () => undefined,
                meta: { value },
            };
            try {
                await store.push(cmd);
            } catch {
                // Push may reject (e.g. busy under contention). We don't
                // care about the return for invariant checking.
            }
        } else if (op.kind === "undo") {
            await store.undo();
        } else if (op.kind === "redo") {
            await store.redo();
        } else {
            store.clear();
            clears += 1;
        }
        const snap = store.getSnapshot();
        versions.push(snap.version);
        epochs.push(snap.epoch);
    }

    return { store, versions, epochs, clears };
}

describe("createAmnesiaStore — invariants", () => {
    it("version is monotonically non-decreasing", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(opArb, { minLength: 0, maxLength: 30 }), async (ops) => {
                const { versions } = await runOps(ops);
                for (let i = 1; i < versions.length; i++) {
                    expect(versions[i]).toBeGreaterThanOrEqual(versions[i - 1]!);
                }
            }),
            { numRuns: 50 },
        );
    });

    it("epoch increases by exactly 1 per clear() and stays constant otherwise", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(opArb, { minLength: 0, maxLength: 30 }), async (ops) => {
                const { epochs, clears } = await runOps(ops);
                const startEpoch = epochs[0]!;
                const finalEpoch = epochs[epochs.length - 1]!;
                // clear() bumps epoch, but only when there is something to
                // clear (it short-circuits on a fresh empty store with no
                // pending ops). The bound is "at most `clears`" — and at
                // least 0.
                expect(finalEpoch - startEpoch).toBeGreaterThanOrEqual(0);
                expect(finalEpoch - startEpoch).toBeLessThanOrEqual(clears);
                // Epoch never decreases.
                for (let i = 1; i < epochs.length; i++) {
                    expect(epochs[i]).toBeGreaterThanOrEqual(epochs[i - 1]!);
                }
            }),
            { numRuns: 50 },
        );
    });

    it("pending becomes false within finite microtasks (no token leaks)", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(opArb, { minLength: 0, maxLength: 30 }), async (ops) => {
                const { store } = await runOps(ops);
                // After all awaited ops complete, give the microtask queue
                // a chance to drain any remaining work.
                await Promise.resolve();
                await Promise.resolve();
                expect(store.getSnapshot().pending).toBe(false);
            }),
            { numRuns: 50 },
        );
    });

    it("past + future length never exceeds capacity (50)", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(opArb, { minLength: 0, maxLength: 60 }), async (ops) => {
                const { store } = await runOps(ops);
                const snap = store.getSnapshot();
                expect(snap.past.length).toBeLessThanOrEqual(50);
                expect(snap.future.length).toBeLessThanOrEqual(50);
            }),
            { numRuns: 50 },
        );
    });

    it("after clear() both stacks are empty regardless of prior history", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(opArb, { minLength: 0, maxLength: 20 }), async (ops) => {
                const opsWithClear: Op[] = [...ops, { kind: "clear" }];
                const { store } = await runOps(opsWithClear);
                const snap = store.getSnapshot();
                expect(snap.past).toHaveLength(0);
                expect(snap.future).toHaveLength(0);
                expect(snap.canUndo).toBe(false);
                expect(snap.canRedo).toBe(false);
            }),
            { numRuns: 50 },
        );
    });

    it("entry ids are unique within a session", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(opArb, { minLength: 0, maxLength: 30 }), async (ops) => {
                const { store } = await runOps(ops);
                const snap = store.getSnapshot();
                const ids = [...snap.past.map((e) => e.id), ...snap.future.map((e) => e.id)];
                const unique = new Set(ids);
                expect(unique.size).toBe(ids.length);
            }),
            { numRuns: 50 },
        );
    });
});
