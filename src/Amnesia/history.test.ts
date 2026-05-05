// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { describe, expect, it, vi } from "vitest";
import { createAmnesiaStore } from "./history";

function makeCounter(initial = 0) {
    let count = initial;
    return {
        get: () => count,
        increment: () => {
            count += 1;
        },
        decrement: () => {
            count -= 1;
        },
    };
}

/**
 * Wait one microtask. `onError` and Promise resolutions all settle within a
 * single microtask boundary in this implementation, so a single tick is
 * enough to drain pending side effects in tests.
 */
const flushMicrotasks = () => Promise.resolve();

describe("createAmnesiaStore — synchronous behavior", () => {
    it("applies the redo on push by default", async () => {
        const counter = makeCounter();
        const store = createAmnesiaStore();
        await store.push({
            label: "increment",
            redo: counter.increment,
            undo: counter.decrement,
        });
        expect(counter.get()).toBe(1);
        expect(store.getSnapshot().canUndo).toBe(true);
        expect(store.getSnapshot().canRedo).toBe(false);
    });

    it("skips the initial redo when applied: true", async () => {
        const counter = makeCounter();
        counter.increment();
        const store = createAmnesiaStore();
        await store.push({ redo: counter.increment, undo: counter.decrement }, { applied: true });
        expect(counter.get()).toBe(1);
        expect(store.getSnapshot().past).toHaveLength(1);
    });

    it("undo and redo round-trip", async () => {
        const counter = makeCounter();
        const store = createAmnesiaStore();
        await store.push({ redo: counter.increment, undo: counter.decrement });
        await store.push({ redo: counter.increment, undo: counter.decrement });
        expect(counter.get()).toBe(2);

        await store.undo();
        expect(counter.get()).toBe(1);
        expect(store.getSnapshot().canRedo).toBe(true);

        await store.redo();
        expect(counter.get()).toBe(2);
    });

    it("clears the redo stack on a new push", async () => {
        const counter = makeCounter();
        const store = createAmnesiaStore();
        await store.push({ redo: counter.increment, undo: counter.decrement });
        await store.undo();
        expect(store.getSnapshot().canRedo).toBe(true);

        await store.push({ redo: counter.increment, undo: counter.decrement });
        expect(store.getSnapshot().canRedo).toBe(false);
    });

    it("resolves to null from undo/redo when stacks are empty", async () => {
        const store = createAmnesiaStore();
        expect(await store.undo()).toBeNull();
        expect(await store.redo()).toBeNull();
    });

    it("enforces capacity by dropping the oldest entry", async () => {
        const counter = makeCounter();
        const store = createAmnesiaStore({ capacity: 2 });
        await store.push({ label: "a", redo: counter.increment, undo: counter.decrement });
        await store.push({ label: "b", redo: counter.increment, undo: counter.decrement });
        await store.push({ label: "c", redo: counter.increment, undo: counter.decrement });

        const snap = store.getSnapshot();
        expect(snap.past.map((entry) => entry.label)).toEqual(["b", "c"]);
    });

    it("coalesces consecutive entries that share a coalesceKey", async () => {
        let value = "";
        const store = createAmnesiaStore({ coalesceWindowMs: 1000 });
        const writeChar = async (next: string) => {
            const previous = value;
            value = next;
            await store.push(
                {
                    coalesceKey: "edit:title",
                    label: "Edit title",
                    redo: () => {
                        value = next;
                    },
                    undo: () => {
                        value = previous;
                    },
                },
                { applied: true },
            );
        };
        await writeChar("h");
        await writeChar("hi");
        await writeChar("hi!");

        const snap = store.getSnapshot();
        expect(snap.past).toHaveLength(1);
        expect(value).toBe("hi!");

        await store.undo();
        expect(value).toBe("");
    });

    it("does not coalesce after the window expires", async () => {
        let value = 0;
        const store = createAmnesiaStore({ coalesceWindowMs: 1 });
        const stamp = async (next: number) => {
            const previous = value;
            value = next;
            await store.push(
                {
                    coalesceKey: "stamp",
                    redo: () => {
                        value = next;
                    },
                    undo: () => {
                        value = previous;
                    },
                },
                { applied: true },
            );
        };

        await stamp(1);
        const before = Date.now;
        let fakeNow = before();
        Date.now = () => fakeNow;
        try {
            fakeNow = before() + 100;
            await stamp(2);
        } finally {
            Date.now = before;
        }

        expect(store.getSnapshot().past).toHaveLength(2);
    });

    it("notifies subscribers exactly once per synchronous mutation", async () => {
        const store = createAmnesiaStore();
        const listener = vi.fn();
        store.subscribe(listener);

        await store.push({ redo: () => undefined, undo: () => undefined });
        await store.undo();
        await store.redo();
        store.clear();

        expect(listener).toHaveBeenCalledTimes(4);
    });

    it("freezes snapshots so consumers cannot mutate state", async () => {
        const store = createAmnesiaStore();
        await store.push({ redo: () => undefined, undo: () => undefined });
        const snap = store.getSnapshot();
        expect(Object.isFrozen(snap)).toBe(true);
        expect(Object.isFrozen(snap.past)).toBe(true);
    });

    it("returns the same snapshot reference until a mutation occurs", async () => {
        const store = createAmnesiaStore();
        const a = store.getSnapshot();
        const b = store.getSnapshot();
        expect(a).toBe(b);
        await store.push({ redo: () => undefined, undo: () => undefined });
        expect(store.getSnapshot()).not.toBe(a);
    });

    it("exposes epoch=0 and pending=false on a fresh store", () => {
        const store = createAmnesiaStore();
        const snap = store.getSnapshot();
        expect(snap.epoch).toBe(0);
        expect(snap.pending).toBe(false);
    });

    it("bumps epoch on clear() but not on push/undo/redo", async () => {
        const store = createAmnesiaStore();
        const startEpoch = store.getSnapshot().epoch;

        await store.push({ redo: () => undefined, undo: () => undefined });
        await store.push({ redo: () => undefined, undo: () => undefined });
        await store.undo();
        await store.redo();
        expect(store.getSnapshot().epoch).toBe(startEpoch);

        store.clear();
        expect(store.getSnapshot().epoch).toBe(startEpoch + 1);
    });
});

describe("createAmnesiaStore — async behavior", () => {
    it("commits async push after the await resolves", async () => {
        const store = createAmnesiaStore();
        let applied = false;
        const promise = store.push({
            label: "async",
            redo: async () => {
                await Promise.resolve();
                applied = true;
            },
            undo: async () => {
                applied = false;
            },
        });
        // Pending is observable before the await resolves.
        expect(store.getSnapshot().pending).toBe(true);
        const id = await promise;
        expect(id).not.toBeNull();
        expect(applied).toBe(true);
        expect(store.getSnapshot().pending).toBe(false);
        expect(store.getSnapshot().canUndo).toBe(true);
    });

    it("undoes via an async handler and pushes the entry to the future stack", async () => {
        const store = createAmnesiaStore();
        let value = 0;
        await store.push({
            redo: async () => {
                await Promise.resolve();
                value = 1;
            },
            undo: async () => {
                await Promise.resolve();
                value = 0;
            },
        });
        await store.undo();
        expect(value).toBe(0);
        expect(store.getSnapshot().canUndo).toBe(false);
        expect(store.getSnapshot().canRedo).toBe(true);
    });

    it("rejects concurrent push with phase=busy and resolves the second call to null", async () => {
        const store = createAmnesiaStore();
        const onError = vi.fn();
        const storeWithErr = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const first = storeWithErr.push({
            redo: () => blocker,
            undo: () => undefined,
        });
        // Second call arrives while the first is still pending.
        const second = await storeWithErr.push({
            redo: () => undefined,
            undo: () => undefined,
        });
        expect(second).toBeNull();

        release();
        await first;
        await flushMicrotasks();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "busy", recoverable: true });

        // Use the unrelated `store` to assert that the busy-error path doesn't
        // leak into the snapshot of an unrelated store.
        expect(store.getSnapshot().pending).toBe(false);
    });

    it("drops in-flight pushes when clear() runs during the await (phase=stale)", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const pending = store.push({
            label: "racing",
            redo: () => blocker,
            undo: () => undefined,
        });

        store.clear();
        // Snapshot reflects the cleared state immediately.
        expect(store.getSnapshot().pending).toBe(false);

        release();
        const id = await pending;
        await flushMicrotasks();

        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "stale", recoverable: false });
    });

    it("leaves the entry in place when undo throws and reports phase=undo", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        await store.push({
            label: "boom",
            redo: () => undefined,
            undo: () => {
                throw new Error("nope");
            },
        });

        const result = await store.undo();
        expect(result).toBeNull();
        // Entry should remain in `past` so the application can retry.
        expect(store.getSnapshot().canUndo).toBe(true);
        expect(store.getSnapshot().canRedo).toBe(false);

        await flushMicrotasks();
        expect(onError).toHaveBeenCalledTimes(1);
        const [error, context] = onError.mock.calls[0]!;
        expect((error as Error).message).toBe("nope");
        expect(context).toMatchObject({ phase: "undo", label: "boom", recoverable: true });
    });

    it("re-throws on synchronous push failure but does not add the entry", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        await expect(
            store.push({
                redo: () => {
                    throw new Error("redo blew up");
                },
                undo: () => undefined,
            }),
        ).rejects.toThrow(/redo blew up/);

        expect(store.getSnapshot().canUndo).toBe(false);
        await flushMicrotasks();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "push", recoverable: false });
    });

    it("re-throws on async push failure but does not add the entry", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        await expect(
            store.push({
                redo: async () => {
                    await Promise.resolve();
                    throw new Error("async kaboom");
                },
                undo: () => undefined,
            }),
        ).rejects.toThrow(/async kaboom/);

        expect(store.getSnapshot().canUndo).toBe(false);
        expect(store.getSnapshot().pending).toBe(false);
        await flushMicrotasks();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "push", recoverable: false });
    });

    it("notifies subscribers twice per async mutation: pending=true then commit", async () => {
        const store = createAmnesiaStore();
        const events: boolean[] = [];
        store.subscribe(() => {
            events.push(store.getSnapshot().pending);
        });

        await store.push({
            redo: async () => {
                await Promise.resolve();
            },
            undo: () => undefined,
        });

        // Two notifications: announce pending, then commit.
        expect(events).toEqual([true, false]);
    });

    it("defers onError to a microtask so handlers may safely re-enter the store", async () => {
        const seen: string[] = [];
        let store!: ReturnType<typeof createAmnesiaStore>;
        store = createAmnesiaStore({
            onError: (_error, context) => {
                seen.push(context.phase);
                if (context.phase === "busy") {
                    // Re-enter the store from inside the handler. Should
                    // succeed because pending is empty by the time onError
                    // fires (microtask deferral).
                    void store.push({ redo: () => undefined, undo: () => undefined });
                }
            },
        });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const first = store.push({
            redo: () => blocker,
            undo: () => undefined,
        });
        // Second push hits busy.
        await store.push({ redo: () => undefined, undo: () => undefined });

        release();
        await first;
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        expect(seen).toEqual(["busy"]);
        // Handler-initiated push committed cleanly.
        expect(store.getSnapshot().past).toHaveLength(2);
    });
});

describe("createAmnesiaStore — dispose", () => {
    it("dispose clears state and prevents subsequent mutations", async () => {
        const store = createAmnesiaStore();
        await store.push({ redo: () => undefined, undo: () => undefined });
        expect(store.getSnapshot().canUndo).toBe(true);

        store.dispose();
        expect(store.getSnapshot().canUndo).toBe(false);
        expect(store.getSnapshot().pending).toBe(false);

        const id = await store.push({ redo: () => undefined, undo: () => undefined });
        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
    });

    it("dispose is idempotent", () => {
        const store = createAmnesiaStore();
        expect(() => {
            store.dispose();
            store.dispose();
        }).not.toThrow();
    });

    it("dispose during in-flight push drops the entry without committing", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const pending = store.push({
            redo: () => blocker,
            undo: () => undefined,
        });
        store.dispose();
        release();
        const id = await pending;
        await flushMicrotasks();

        expect(id).toBeNull();
        expect(store.getSnapshot().canUndo).toBe(false);
        // Stale phase fires for the dropped op.
        expect(onError).toHaveBeenCalledWith(undefined, expect.objectContaining({ phase: "stale" }));
    });
});

describe("createAmnesiaStore — Command.do (Workstream B)", () => {
    it("invokes do on initial push and redo on every replay", async () => {
        const events: string[] = [];
        const store = createAmnesiaStore();
        await store.push({
            label: "insert",
            do: () => {
                events.push("do");
            },
            redo: () => {
                events.push("redo");
            },
            undo: () => {
                events.push("undo");
            },
        });
        expect(events).toEqual(["do"]);

        await store.undo();
        expect(events).toEqual(["do", "undo"]);

        await store.redo();
        expect(events).toEqual(["do", "undo", "redo"]);

        await store.undo();
        await store.redo();
        expect(events).toEqual(["do", "undo", "redo", "undo", "redo"]);
    });

    it("falls back to redo when do is omitted", async () => {
        const events: string[] = [];
        const store = createAmnesiaStore();
        await store.push({
            redo: () => {
                events.push("redo");
            },
            undo: () => {
                events.push("undo");
            },
        });
        // No `do` — `redo` runs on the initial push.
        expect(events).toEqual(["redo"]);
    });

    it("skips do when applied: true is passed", async () => {
        const events: string[] = [];
        const store = createAmnesiaStore();
        await store.push(
            {
                do: () => {
                    events.push("do");
                },
                redo: () => {
                    events.push("redo");
                },
                undo: () => undefined,
            },
            { applied: true },
        );
        expect(events).toEqual([]);

        await store.undo();
        await store.redo();
        // First replay uses `redo`, never `do`.
        expect(events).toEqual(["redo"]);
    });

    it("supports async do", async () => {
        const events: string[] = [];
        const store = createAmnesiaStore();
        await store.push({
            do: async () => {
                await Promise.resolve();
                events.push("do");
            },
            redo: () => {
                events.push("redo");
            },
            undo: () => undefined,
        });
        expect(events).toEqual(["do"]);
        await store.undo();
        await store.redo();
        expect(events).toEqual(["do", "redo"]);
    });

    it("re-throws an async do failure and does not push the entry", async () => {
        const onError = vi.fn();
        const store = createAmnesiaStore({ onError });

        await expect(
            store.push({
                do: async () => {
                    await Promise.resolve();
                    throw new Error("do blew up");
                },
                redo: () => undefined,
                undo: () => undefined,
            }),
        ).rejects.toThrow(/do blew up/);

        expect(store.getSnapshot().canUndo).toBe(false);
        await flushMicrotasks();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]![1]).toMatchObject({ phase: "push" });
    });

    it("coalesces by replacing redo, not do, so subsequent replays see the latest redo", async () => {
        const events: string[] = [];
        const store = createAmnesiaStore({ coalesceWindowMs: 1000 });

        // First push of a coalescing burst: `do` performs the initial mutation,
        // `redo` performs the equivalent replay.
        await store.push({
            coalesceKey: "burst",
            do: () => {
                events.push("do(1)");
            },
            redo: () => {
                events.push("redo(1)");
            },
            undo: () => {
                events.push("undo(1)");
            },
        });
        // Second push merges into the same entry. Its `do` runs once at push
        // time; the merged entry's stored `redo` becomes redo(2).
        await store.push({
            coalesceKey: "burst",
            do: () => {
                events.push("do(2)");
            },
            redo: () => {
                events.push("redo(2)");
            },
            undo: () => {
                events.push("undo(should-not-fire)");
            },
        });
        expect(events).toEqual(["do(1)", "do(2)"]);
        // Past has exactly one merged entry.
        expect(store.getSnapshot().past).toHaveLength(1);

        await store.undo();
        // Merged entry preserves the original undo.
        expect(events).toEqual(["do(1)", "do(2)", "undo(1)"]);

        await store.redo();
        // Merged entry's redo is the LATEST one, not do(2) and not redo(1).
        expect(events).toEqual(["do(1)", "do(2)", "undo(1)", "redo(2)"]);
    });
});
