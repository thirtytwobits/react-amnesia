// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { describe, expect, it, vi } from "vitest";
import { createAmnesiaStore } from "./history";
import { createAmnesiaProviderApi } from "./provider-api";

describe("createAmnesiaStore — lifecycle hooks", () => {
    it("fires onPush exactly once for a single push", async () => {
        const onPush = vi.fn();
        const store = createAmnesiaStore({ onPush });

        await store.push({
            label: "increment",
            redo: () => undefined,
            undo: () => undefined,
        });

        expect(onPush).toHaveBeenCalledTimes(1);
        expect(onPush.mock.calls[0]![0]).toMatchObject({ label: "increment" });
    });

    it("does NOT fire onPush on coalesce-merge — once per logical user action", async () => {
        const onPush = vi.fn();
        const store = createAmnesiaStore({ coalesceWindowMs: 1000, onPush });

        const stamp = (next: string) =>
            store.push(
                {
                    coalesceKey: "edit:title",
                    label: `title=${next}`,
                    redo: () => undefined,
                    undo: () => undefined,
                },
                { applied: true },
            );

        await stamp("h");
        await stamp("hi");
        await stamp("hi!");

        // 3 pushes, 1 logical user action (the burst).
        expect(onPush).toHaveBeenCalledTimes(1);
        expect(store.getSnapshot().past).toHaveLength(1);
    });

    it("fires onUndo and onRedo on round-trip", async () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const store = createAmnesiaStore({ onUndo, onRedo });

        await store.push({
            label: "first",
            redo: () => undefined,
            undo: () => undefined,
        });
        await store.undo();
        await store.redo();

        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onUndo.mock.calls[0]![0]).toMatchObject({ label: "first" });
        expect(onRedo).toHaveBeenCalledTimes(1);
        expect(onRedo.mock.calls[0]![0]).toMatchObject({ label: "first" });
    });

    it("fires onClear once when clear() actually clears something", async () => {
        const onClear = vi.fn();
        const store = createAmnesiaStore({ onClear });

        // No-op clear → no firing.
        store.clear();
        expect(onClear).not.toHaveBeenCalled();

        await store.push({ redo: () => undefined, undo: () => undefined });
        store.clear();
        expect(onClear).toHaveBeenCalledTimes(1);

        // After clear, another no-op clear should not fire.
        store.clear();
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("fires hooks AFTER subscribers see the updated snapshot", async () => {
        const sequence: string[] = [];
        const store = createAmnesiaStore({
            onPush: (entry) => sequence.push(`onPush:past=${entry.id}`),
        });
        store.subscribe(() => sequence.push(`subscriber:past=${store.getSnapshot().past.length}`));

        await store.push({ redo: () => undefined, undo: () => undefined });

        // Subscribers see the new past length first; the hook fires afterward.
        expect(sequence).toEqual(["subscriber:past=1", "onPush:past=1"]);
    });

    it("a throwing hook does not poison the store", async () => {
        const onPush = vi.fn(() => {
            throw new Error("hook blew up");
        });
        const store = createAmnesiaStore({ onPush });

        await store.push({ redo: () => undefined, undo: () => undefined });
        await store.push({ redo: () => undefined, undo: () => undefined });

        expect(onPush).toHaveBeenCalledTimes(2);
        expect(store.getSnapshot().past).toHaveLength(2);
        expect(store.getSnapshot().pending).toBe(false);
    });

    it("fires exactly one onPush for a transaction commit, not one per buffered push", async () => {
        const onPush = vi.fn();
        const store = createAmnesiaStore({ onPush });

        await store.transaction("preset", async (tx) => {
            await tx.push({ redo: () => undefined, undo: () => undefined });
            await tx.push({ redo: () => undefined, undo: () => undefined });
            await tx.push({ redo: () => undefined, undo: () => undefined });
        });

        expect(onPush).toHaveBeenCalledTimes(1);
        expect(onPush.mock.calls[0]![0]).toMatchObject({ label: "preset" });
    });

    it("does NOT fire onPush when a transaction throws and rolls back", async () => {
        const onPush = vi.fn();
        const store = createAmnesiaStore({ onPush });

        await expect(
            store.transaction(async (tx) => {
                await tx.push({ redo: () => undefined, undo: () => undefined });
                throw new Error("nope");
            }),
        ).rejects.toThrow();

        expect(onPush).not.toHaveBeenCalled();
    });

    it("does NOT fire onPush when a transaction stales mid-await", async () => {
        const onPush = vi.fn();
        const store = createAmnesiaStore({ onPush });

        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });

        const tx = store.transaction(async (txApi) => {
            await txApi.push({ redo: () => undefined, undo: () => undefined });
            await blocker;
        });

        store.clear();
        release();
        await tx;

        expect(onPush).not.toHaveBeenCalled();
    });

    it("metaTransform redacts meta in both the snapshot and hook payloads", async () => {
        const onPush = vi.fn();
        const store = createAmnesiaStore({
            onPush,
            metaTransform: (meta) => {
                const { secret: _secret, ...rest } = meta;
                return rest;
            },
        });

        await store.push({
            label: "with secret",
            meta: { secret: "shh", visible: 42 },
            redo: () => undefined,
            undo: () => undefined,
        });

        // Snapshot is sanitized.
        const entry = store.getSnapshot().past[0]!;
        expect(entry.meta).toEqual({ visible: 42 });
        expect(entry.meta).not.toHaveProperty("secret");

        // Hook payload is sanitized.
        expect(onPush).toHaveBeenCalledTimes(1);
        const hookEntry = onPush.mock.calls[0]![0];
        expect(hookEntry.meta).toEqual({ visible: 42 });
    });

    it("metaTransform returning undefined strips meta entirely", async () => {
        const store = createAmnesiaStore({
            metaTransform: () => undefined,
        });

        await store.push({
            meta: { sensitive: true },
            redo: () => undefined,
            undo: () => undefined,
        });

        const entry = store.getSnapshot().past[0]!;
        expect(entry.meta).toBeUndefined();
    });

    it("a throwing metaTransform strips meta safely without breaking the store", async () => {
        const store = createAmnesiaStore({
            metaTransform: () => {
                throw new Error("transform blew up");
            },
        });

        await store.push({
            meta: { anything: 1 },
            redo: () => undefined,
            undo: () => undefined,
        });

        const entry = store.getSnapshot().past[0]!;
        expect(entry.meta).toBeUndefined();
        expect(store.getSnapshot().past).toHaveLength(1);
    });

    it("hook re-entrancy: calling store.push from inside onPush is safe and produces an additional entry", async () => {
        const seen: string[] = [];
        let store!: ReturnType<typeof createAmnesiaStore>;
        let pushed = false;
        store = createAmnesiaStore({
            onPush: (entry) => {
                seen.push(entry.label ?? "?");
                if (!pushed) {
                    pushed = true;
                    void store.push({
                        label: "from-hook",
                        redo: () => undefined,
                        undo: () => undefined,
                    });
                }
            },
        });

        await store.push({ label: "first", redo: () => undefined, undo: () => undefined });
        // Drain microtasks for the re-entrant push.
        await Promise.resolve();
        await Promise.resolve();

        expect(seen).toEqual(["first", "from-hook"]);
        expect(store.getSnapshot().past).toHaveLength(2);
    });
});

describe("AmnesiaProviderApi — scopeId-bound hooks", () => {
    it("binds the scopeId before invoking the user-supplied hooks", async () => {
        const onPush = vi.fn();
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onClear = vi.fn();

        const api = createAmnesiaProviderApi({ onPush, onUndo, onRedo, onClear });
        const a = api.getScope("a");
        const b = api.getScope("b");

        await a.push({ label: "a-1", redo: () => undefined, undo: () => undefined });
        await b.push({ label: "b-1", redo: () => undefined, undo: () => undefined });

        expect(onPush).toHaveBeenCalledTimes(2);
        const calls = onPush.mock.calls.map(([entry, scopeId]) => ({ label: entry.label, scopeId }));
        expect(calls).toEqual([
            { label: "a-1", scopeId: "a" },
            { label: "b-1", scopeId: "b" },
        ]);

        await a.undo();
        expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ label: "a-1" }), "a");

        await a.redo();
        expect(onRedo).toHaveBeenCalledWith(expect.objectContaining({ label: "a-1" }), "a");

        a.clear();
        b.clear();
        expect(onClear).toHaveBeenCalledTimes(2);
        expect(onClear.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    });

    it("scope-level hook overrides win over provider-level hooks", async () => {
        const providerOnPush = vi.fn();
        const scopeOnPush = vi.fn();

        const api = createAmnesiaProviderApi({
            onPush: providerOnPush,
            scopes: { canvas: { onPush: scopeOnPush } },
        });

        await api.getScope("canvas").push({ redo: () => undefined, undo: () => undefined });
        await api.getScope("default").push({ redo: () => undefined, undo: () => undefined });

        expect(scopeOnPush).toHaveBeenCalledTimes(1);
        expect(scopeOnPush.mock.calls[0]![1]).toBe("canvas");
        expect(providerOnPush).toHaveBeenCalledTimes(1);
        expect(providerOnPush.mock.calls[0]![1]).toBe("default");
    });

    it("clearing all scopes fires onClear once per scope that had something to clear", async () => {
        const onClear = vi.fn();
        const api = createAmnesiaProviderApi({ onClear });

        await api.getScope("a").push({ redo: () => undefined, undo: () => undefined });
        await api.getScope("b").push({ redo: () => undefined, undo: () => undefined });
        api.getScope("c"); // never written; will not fire onClear

        api.clear();

        expect(onClear).toHaveBeenCalledTimes(2);
        const cleared = new Set(onClear.mock.calls.map((c) => c[0]));
        expect(cleared).toEqual(new Set(["a", "b"]));
    });
});
