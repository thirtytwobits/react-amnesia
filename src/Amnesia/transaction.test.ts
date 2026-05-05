// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { describe, expect, it, vi } from "vitest";
import { createAmnesiaStore } from "./history";

const flushMicrotasks = () => Promise.resolve();

describe("createAmnesiaStore — transactions (Workstream D)", () => {
    it("collapses three pushes into one composite entry on the past stack", async () => {
        let value = 0;
        const store = createAmnesiaStore();

        const id = await store.transaction("Apply preset", async (tx) => {
            await tx.push({
                redo: () => {
                    value += 1;
                },
                undo: () => {
                    value -= 1;
                },
            });
            await tx.push({
                redo: () => {
                    value += 10;
                },
                undo: () => {
                    value -= 10;
                },
            });
            await tx.push({
                redo: () => {
                    value += 100;
                },
                undo: () => {
                    value -= 100;
                },
            });
        });

        expect(id).not.toBeNull();
        expect(value).toBe(111);
        expect(store.getSnapshot().past).toHaveLength(1);
        expect(store.getSnapshot().past[0]!.label).toBe("Apply preset");
    });

    it("undoing the composite reverses every buffered undo in reverse order", async () => {
        const order: string[] = [];
        const store = createAmnesiaStore();

        await store.transaction(async (tx) => {
            await tx.push({
                redo: () => {
                    order.push("redo:a");
                },
                undo: () => {
                    order.push("undo:a");
                },
            });
            await tx.push({
                redo: () => {
                    order.push("redo:b");
                },
                undo: () => {
                    order.push("undo:b");
                },
            });
            await tx.push({
                redo: () => {
                    order.push("redo:c");
                },
                undo: () => {
                    order.push("undo:c");
                },
            });
        });

        expect(order).toEqual(["redo:a", "redo:b", "redo:c"]);

        await store.undo();
        // Reverse order: c, b, a.
        expect(order).toEqual(["redo:a", "redo:b", "redo:c", "undo:c", "undo:b", "undo:a"]);

        // Redo replays everything in original order.
        await store.redo();
        expect(order.slice(-3)).toEqual(["redo:a", "redo:b", "redo:c"]);
    });

    it("rolls back buffered undos in reverse when work throws and re-throws to the caller", async () => {
        const onError = vi.fn();
        let value = 0;
        const store = createAmnesiaStore({ onError });

        await expect(
            store.transaction("partial", async (tx) => {
                await tx.push({
                    redo: () => {
                        value += 1;
                    },
                    undo: () => {
                        value -= 1;
                    },
                });
                await tx.push({
                    redo: () => {
                        value += 10;
                    },
                    undo: () => {
                        value -= 10;
                    },
                });
                throw new Error("boom");
            }),
        ).rejects.toThrow(/boom/);

        // Both undos ran in reverse → value is back to 0.
        expect(value).toBe(0);
        // Stack is unchanged (no entry committed).
        expect(store.getSnapshot().past).toHaveLength(0);
        expect(store.getSnapshot().pending).toBe(false);

        await flushMicrotasks();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "push", recoverable: false });
    });

    it("nested transaction(...) flattens into the outer; nested label is ignored", async () => {
        const order: string[] = [];
        const store = createAmnesiaStore();

        const id = await store.transaction("outer", async (tx) => {
            await tx.push({
                redo: () => {
                    order.push("redo:a");
                },
                undo: () => {
                    order.push("undo:a");
                },
            });
            // Nested call. Returns null. Its label is ignored.
            const nestedId = await store.transaction("inner-ignored", async (innerTx) => {
                await innerTx.push({
                    redo: () => {
                        order.push("redo:b");
                    },
                    undo: () => {
                        order.push("undo:b");
                    },
                });
            });
            expect(nestedId).toBeNull();
            await tx.push({
                redo: () => {
                    order.push("redo:c");
                },
                undo: () => {
                    order.push("undo:c");
                },
            });
        });

        expect(id).not.toBeNull();
        expect(store.getSnapshot().past).toHaveLength(1);
        expect(store.getSnapshot().past[0]!.label).toBe("outer");
        expect(order).toEqual(["redo:a", "redo:b", "redo:c"]);

        await store.undo();
        expect(order).toEqual(["redo:a", "redo:b", "redo:c", "undo:c", "undo:b", "undo:a"]);
    });

    it("tx.label(...) overrides the constructor label", async () => {
        const store = createAmnesiaStore();

        const id = await store.transaction("placeholder", async (tx) => {
            await tx.push({ redo: () => undefined, undo: () => undefined });
            tx.label("renamed mid-flight");
        });

        expect(id).not.toBeNull();
        expect(store.getSnapshot().past[0]!.label).toBe("renamed mid-flight");
    });

    it("returns null and commits no entry for an empty transaction", async () => {
        const store = createAmnesiaStore();
        const id = await store.transaction(async () => {
            // No pushes.
        });
        expect(id).toBeNull();
        expect(store.getSnapshot().past).toHaveLength(0);
        expect(store.getSnapshot().canUndo).toBe(false);
    });

    it("rejects concurrent push as busy while a transaction is in flight", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const txPromise = store.transaction(async (tx) => {
            await tx.push({ redo: () => undefined, undo: () => undefined });
            await blocker;
        });

        // Concurrent external push should hit busy.
        const concurrent = await store.push({ redo: () => undefined, undo: () => undefined });
        expect(concurrent).toBeNull();

        release();
        await txPromise;
        await flushMicrotasks();

        expect(onError).toHaveBeenCalled();
        expect(onError.mock.calls.find((c) => c[1].phase === "busy")).toBeDefined();
    });

    it("rolls back when clear() runs during the transaction's await (stale)", async () => {
        const onError = vi.fn();
        let value = 0;
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const txPromise = store.transaction(async (tx) => {
            await tx.push({
                redo: () => {
                    value += 1;
                },
                undo: () => {
                    value -= 1;
                },
            });
            await blocker;
        });

        store.clear();
        release();
        const id = await txPromise;
        await flushMicrotasks();

        expect(id).toBeNull();
        // Buffered undo ran during rollback → value back to 0.
        expect(value).toBe(0);
        expect(store.getSnapshot().past).toHaveLength(0);
        expect(onError).toHaveBeenCalledWith(undefined, expect.objectContaining({ phase: "stale" }));
    });

    it("commits synchronous transactions in a single notify (no observable pending=true)", async () => {
        const store = createAmnesiaStore();
        const events: boolean[] = [];
        store.subscribe(() => {
            events.push(store.getSnapshot().pending);
        });

        await store.transaction((tx) => {
            void tx.push({ redo: () => undefined, undo: () => undefined });
            void tx.push({ redo: () => undefined, undo: () => undefined });
        });

        // Sync work: one notify at commit, pending: false.
        expect(events).toEqual([false]);
        expect(store.getSnapshot().past).toHaveLength(1);
    });

    it("notifies twice for async transactions (pending=true at start, false on commit)", async () => {
        const store = createAmnesiaStore();
        const events: boolean[] = [];
        store.subscribe(() => {
            events.push(store.getSnapshot().pending);
        });

        await store.transaction(async (tx) => {
            await Promise.resolve();
            await tx.push({ redo: () => undefined, undo: () => undefined });
        });

        expect(events).toEqual([true, false]);
    });

    it("composite entries are not coalesced with neighbors even when adjacent", async () => {
        const store = createAmnesiaStore({ coalesceWindowMs: 1000 });

        await store.transaction(async (tx) => {
            await tx.push({
                coalesceKey: "edit:title",
                redo: () => undefined,
                undo: () => undefined,
            });
        });

        // Adjacent push with the same coalesceKey would normally merge with
        // the previous entry — but the previous entry is a composite, which
        // never coalesces.
        await store.push({
            coalesceKey: "edit:title",
            redo: () => undefined,
            undo: () => undefined,
        });

        expect(store.getSnapshot().past).toHaveLength(2);
    });

    it('surfaces rollback failures as phase: "rollback" while the original error still propagates', async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        await expect(
            store.transaction(async (tx) => {
                await tx.push({
                    redo: () => undefined,
                    undo: () => {
                        throw new Error("undo-1 failed");
                    },
                });
                await tx.push({
                    redo: () => undefined,
                    undo: () => {
                        throw new Error("undo-2 failed");
                    },
                });
                throw new Error("work failed");
            }),
        ).rejects.toThrow(/work failed/);

        await flushMicrotasks();

        const phases = onError.mock.calls.map((c) => c[1].phase);
        expect(phases.filter((p: string) => p === "rollback")).toHaveLength(2);
        expect(phases).toContain("push");
    });

    it("throws synchronously from tx.push / tx.label after the transaction has resolved", async () => {
        const store = createAmnesiaStore();
        let escaped: { push: (cmd: unknown) => Promise<void>; label: (text: string) => void } | null = null;

        await store.transaction((tx) => {
            escaped = tx as unknown as typeof escaped;
            void tx.push({ redo: () => undefined, undo: () => undefined });
        });

        expect(escaped).not.toBeNull();
        await expect(escaped!.push({ redo: () => undefined, undo: () => undefined })).rejects.toThrow(
            /tx\.push after the transaction/,
        );
        expect(() => escaped!.label("late")).toThrow(/tx\.label after the transaction/);
    });

    it("rejects when transaction is called with no work function", async () => {
        const store = createAmnesiaStore();
        // @ts-expect-error — exercising the runtime guard.
        await expect(store.transaction("just a label")).rejects.toThrow(/work function is required/);
    });

    it("returns null when called on a disposed store", async () => {
        const store = createAmnesiaStore();
        store.dispose();
        const id = await store.transaction(async (tx) => {
            await tx.push({ redo: () => undefined, undo: () => undefined });
        });
        expect(id).toBeNull();
    });

    it("survives multiple consecutive transactions without leaking pending tokens", async () => {
        const store = createAmnesiaStore();

        for (let i = 0; i < 5; i++) {
            await store.transaction(`tx-${i}`, async (tx) => {
                await tx.push({ redo: () => undefined, undo: () => undefined });
            });
        }

        expect(store.getSnapshot().past).toHaveLength(5);
        expect(store.getSnapshot().pending).toBe(false);
    });
});
