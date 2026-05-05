// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "../test-utils";
import { DEVTOOLS_GLOBAL_KEY, type AmnesiaDevToolsRegistry } from "./devtools";
import { AmnesiaProvider } from "./provider";
import { useUndoableState } from "./use-undoable-state";

function getRegistry(): AmnesiaDevToolsRegistry | undefined {
    return (globalThis as unknown as { [DEVTOOLS_GLOBAL_KEY]?: AmnesiaDevToolsRegistry })[DEVTOOLS_GLOBAL_KEY];
}

function clearRegistry(): void {
    delete (globalThis as unknown as Record<string, unknown>)[DEVTOOLS_GLOBAL_KEY];
}

describe("AmnesiaProvider — devtools registry (Workstream I)", () => {
    afterEach(() => {
        clearRegistry();
    });

    it("does not install the global registry when enableDevTools is omitted", () => {
        clearRegistry();
        render(
            <AmnesiaProvider>
                <div />
            </AmnesiaProvider>,
        );
        expect(getRegistry()).toBeUndefined();
    });

    it("installs the global registry when enableDevTools is true", () => {
        clearRegistry();
        render(
            <AmnesiaProvider enableDevTools>
                <div />
            </AmnesiaProvider>,
        );
        const registry = getRegistry();
        expect(registry).toBeDefined();
        const list = registry!.list();
        expect(list).toHaveLength(1);
        expect(list[0]!.available).toBe(true);
    });

    it("registers under a stable id when devToolsId is supplied", () => {
        clearRegistry();
        render(
            <AmnesiaProvider enableDevTools devToolsId="canvas-app">
                <div />
            </AmnesiaProvider>,
        );
        const registry = getRegistry()!;
        const api = registry.resolve("canvas-app");
        expect(api).not.toBeNull();
        expect(api!.id).toBe("canvas-app");
    });

    it("auto-generates a stable id when devToolsId is omitted", () => {
        clearRegistry();
        const { rerender } = render(
            <AmnesiaProvider enableDevTools>
                <div />
            </AmnesiaProvider>,
        );
        const idAfterMount = getRegistry()!.list()[0]!.id;
        expect(idAfterMount).toMatch(/^amnesia-\d+$/);

        rerender(
            <AmnesiaProvider enableDevTools>
                <div data-testid="bump" />
            </AmnesiaProvider>,
        );
        // Re-render does not re-register under a new id.
        expect(getRegistry()!.list()[0]!.id).toBe(idAfterMount);
    });

    it("resolves to a working api: scopes / snapshots / triggers / clear", async () => {
        clearRegistry();

        function Counter() {
            const [count, setCount] = useUndoableState(0, { label: "tick" });
            return (
                <div>
                    <output data-testid="count">{count}</output>
                    <button onClick={() => setCount((n) => n + 1)}>inc</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider enableDevTools devToolsId="probe">
                <Counter />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));

        const api = getRegistry()!.resolve("probe")!;
        expect(api.getActiveScopeId()).toBe("default");
        expect(api.scopes()).toContain("default");
        expect(api.pastSnapshot()).toHaveLength(3);
        expect(api.futureSnapshot()).toHaveLength(0);

        // Trigger undo through the registry. Wrap in `act` because the
        // trigger fires outside any React event handler.
        let undoneId: number | null = null;
        await act(async () => {
            undoneId = await api.triggerUndo();
        });
        expect(undoneId).not.toBeNull();
        expect(screen.getByTestId("count").textContent).toBe("2");

        // dump() returns every scope.
        const dumped = api.dump();
        expect(Object.keys(dumped)).toContain("default");
        expect(dumped["default"]!.canUndo).toBe(true);

        // Clear the active scope through the registry.
        await act(async () => {
            api.clear("default");
        });
        expect(api.pastSnapshot()).toHaveLength(0);
    });

    it("supports multiple providers under different ids", () => {
        clearRegistry();
        render(
            <div>
                <AmnesiaProvider enableDevTools devToolsId="alpha">
                    <div />
                </AmnesiaProvider>
                <AmnesiaProvider enableDevTools devToolsId="beta">
                    <div />
                </AmnesiaProvider>
            </div>,
        );
        const list = getRegistry()!.list();
        expect(list.map((entry) => entry.id).sort()).toEqual(["alpha", "beta"]);
        expect(getRegistry()!.resolve("alpha")).not.toBeNull();
        expect(getRegistry()!.resolve("beta")).not.toBeNull();
    });

    it("unregisters on provider unmount", () => {
        clearRegistry();
        const { unmount } = render(
            <AmnesiaProvider enableDevTools devToolsId="goer">
                <div />
            </AmnesiaProvider>,
        );
        expect(getRegistry()!.resolve("goer")).not.toBeNull();
        unmount();
        expect(getRegistry()!.resolve("goer")).toBeNull();
        expect(getRegistry()!.list()).toHaveLength(0);
    });

    it("survives StrictMode's simulated cleanup-then-setup cycle", async () => {
        // StrictMode runs effect cleanup then setup. Our effect should
        // unregister and re-register under the same id. After the dev cycle
        // the provider must be discoverable.
        clearRegistry();
        const user = userEvent.setup();

        function App() {
            const [count, setCount] = useUndoableState(0);
            return (
                <div>
                    <output data-testid="count">{count}</output>
                    <button onClick={() => setCount((n) => n + 1)}>inc</button>
                </div>
            );
        }

        render(
            <AmnesiaProvider enableDevTools devToolsId="strict-probe">
                <App />
            </AmnesiaProvider>,
        );

        // After the dev double-cycle, the registry should still have a
        // single live entry for "strict-probe".
        const list = getRegistry()!.list();
        expect(list.filter((entry) => entry.id === "strict-probe")).toHaveLength(1);

        await user.click(screen.getByText("inc"));
        const api = getRegistry()!.resolve("strict-probe")!;
        expect(api.pastSnapshot()).toHaveLength(1);
    });

    it("__meta bumps version on every register / unregister", () => {
        clearRegistry();
        const { unmount } = render(
            <AmnesiaProvider enableDevTools devToolsId="meta-test">
                <div />
            </AmnesiaProvider>,
        );
        const versionAfterMount = getRegistry()!.__meta.version;
        expect(versionAfterMount).toBeGreaterThan(0);

        unmount();
        expect(getRegistry()!.__meta.version).toBeGreaterThan(versionAfterMount);
        expect(getRegistry()!.__meta.lastChange).toContain("unregister");
    });

    it("capabilities reports WeakRef availability accurately", () => {
        clearRegistry();
        render(
            <AmnesiaProvider enableDevTools>
                <div />
            </AmnesiaProvider>,
        );
        const caps = getRegistry()!.capabilities;
        // Node 18+ and modern browsers have WeakRef; jsdom in our test
        // environment should as well.
        expect(caps.weakRef).toBe(typeof WeakRef !== "undefined");
        expect(caps.finalizationRegistry).toBe(typeof FinalizationRegistry !== "undefined");
    });
});
