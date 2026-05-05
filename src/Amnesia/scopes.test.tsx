// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AmnesiaProvider, useAmnesiaProviderApi } from "./provider";
import { AmnesiaShortcuts } from "./shortcuts";
import { useUndoableState } from "./use-undoable-state";
import { useAmnesiaFocusClaim, useAmnesiaScopes } from "./use-scopes";

/**
 * Two side-by-side undoable values, each pinned to its own scope. A single
 * `<AmnesiaShortcuts />` should route Ctrl+Z to whichever scope owns the
 * active claim.
 */
function TwoScopeApp() {
    const [canvas, setCanvas] = useUndoableState(0, { scopeId: "canvas", label: "canvas" });
    const [props, setProps] = useUndoableState(0, { scopeId: "props", label: "props" });
    const canvasClaim = useAmnesiaFocusClaim("canvas");
    const propsClaim = useAmnesiaFocusClaim("props");
    const { activeScopeId } = useAmnesiaScopes();
    return (
        <div>
            <output data-testid="active">{activeScopeId}</output>
            <section data-testid="canvas-region" tabIndex={-1} {...canvasClaim}>
                <output data-testid="canvas-value">{canvas}</output>
                <button onClick={() => setCanvas((n) => n + 1)}>inc-canvas</button>
            </section>
            <section data-testid="props-region" tabIndex={-1} {...propsClaim}>
                <output data-testid="props-value">{props}</output>
                <button onClick={() => setProps((n) => n + 1)}>inc-props</button>
            </section>
            <AmnesiaShortcuts skipEditableTargets={false} />
        </div>
    );
}

describe("multi-scope routing", () => {
    it("pushes from useUndoableState pin to their declared scopes", async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <TwoScopeApp />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc-canvas"));
        await user.click(screen.getByText("inc-canvas"));
        await user.click(screen.getByText("inc-props"));

        expect(screen.getByTestId("canvas-value").textContent).toBe("2");
        expect(screen.getByTestId("props-value").textContent).toBe("1");
    });

    it("focus claim routes Ctrl+Z to the active scope", async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <TwoScopeApp />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc-canvas"));
        await user.click(screen.getByText("inc-canvas"));
        await user.click(screen.getByText("inc-props"));

        // Claim the props region by clicking it.
        fireEvent.pointerDown(screen.getByTestId("props-region"));
        expect(screen.getByTestId("active").textContent).toBe("props");

        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
        // We have to give the async undo a microtask to settle.
        await Promise.resolve();
        expect(screen.getByTestId("props-value").textContent).toBe("0");
        expect(screen.getByTestId("canvas-value").textContent).toBe("2");

        // Now claim canvas. Ctrl+Z should route there.
        fireEvent.pointerDown(screen.getByTestId("canvas-region"));
        expect(screen.getByTestId("active").textContent).toBe("canvas");

        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
        await Promise.resolve();
        expect(screen.getByTestId("canvas-value").textContent).toBe("1");
        expect(screen.getByTestId("props-value").textContent).toBe("0");
    });

    it("releases the claim when the scoped region unmounts", () => {
        function PropsRegion() {
            const claim = useAmnesiaFocusClaim("props");
            return (
                <div data-testid="props-region" tabIndex={-1} {...claim}>
                    child
                </div>
            );
        }
        function Controller() {
            const [mounted, setMounted] = useState(true);
            const { activeScopeId } = useAmnesiaScopes();
            return (
                <div>
                    <output data-testid="active">{activeScopeId}</output>
                    {mounted ? <PropsRegion /> : null}
                    <button onClick={() => setMounted(false)}>unmount</button>
                </div>
            );
        }

        render(
            <AmnesiaProvider>
                <Controller />
            </AmnesiaProvider>,
        );

        // Initially default since no claim has been made yet.
        expect(screen.getByTestId("active").textContent).toBe("default");

        fireEvent.pointerDown(screen.getByTestId("props-region"));
        expect(screen.getByTestId("active").textContent).toBe("props");

        // Unmount the region. The release on cleanup should fall back to
        // the default scope.
        fireEvent.click(screen.getByText("unmount"));
        expect(screen.getByTestId("active").textContent).toBe("default");
    });

    it("AmnesiaShortcuts with a pinned scopeId ignores the active claim", async () => {
        function App() {
            const [canvas, setCanvas] = useUndoableState(0, { scopeId: "canvas" });
            const [props, setProps] = useUndoableState(0, { scopeId: "props" });
            const propsClaim = useAmnesiaFocusClaim("props");
            return (
                <div>
                    <output data-testid="canvas-value">{canvas}</output>
                    <output data-testid="props-value">{props}</output>
                    <button onClick={() => setCanvas((n) => n + 1)}>inc-canvas</button>
                    <button onClick={() => setProps((n) => n + 1)}>inc-props</button>
                    <section data-testid="props-region" tabIndex={-1} {...propsClaim} />
                    <AmnesiaShortcuts scopeId="canvas" skipEditableTargets={false} />
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc-canvas"));
        await user.click(screen.getByText("inc-props"));

        // Claim props — but the shortcut is pinned to canvas.
        fireEvent.pointerDown(screen.getByTestId("props-region"));

        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
        await Promise.resolve();

        // Canvas was undone; props was not.
        expect(screen.getByTestId("canvas-value").textContent).toBe("0");
        expect(screen.getByTestId("props-value").textContent).toBe("1");
    });

    it("clear() clears every scope; clear(scopeId) clears one", async () => {
        let externalApi: ReturnType<typeof useAmnesiaProviderApi> | null = null;
        function Probe() {
            externalApi = useAmnesiaProviderApi();
            return null;
        }
        function App() {
            const [a, setA] = useUndoableState(0, { scopeId: "a" });
            const [b, setB] = useUndoableState(0, { scopeId: "b" });
            return (
                <div>
                    <output data-testid="a">{a}</output>
                    <output data-testid="b">{b}</output>
                    <button onClick={() => setA((n) => n + 1)}>inc-a</button>
                    <button onClick={() => setB((n) => n + 1)}>inc-b</button>
                    <Probe />
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc-a"));
        await user.click(screen.getByText("inc-a"));
        await user.click(screen.getByText("inc-b"));

        expect(externalApi).not.toBeNull();
        const api = externalApi!;
        expect(api.getScope("a").getSnapshot().canUndo).toBe(true);
        expect(api.getScope("b").getSnapshot().canUndo).toBe(true);

        // Clear only "a" via the scope-targeted form.
        api.clear("a");
        expect(api.getScope("a").getSnapshot().canUndo).toBe(false);
        expect(api.getScope("b").getSnapshot().canUndo).toBe(true);

        // Now clear() with no arg clears the rest.
        api.clear();
        expect(api.getScope("b").getSnapshot().canUndo).toBe(false);
    });

    it("applies per-scope option overrides via the provider's `scopes` prop", async () => {
        let externalApi: ReturnType<typeof useAmnesiaProviderApi> | null = null;
        function Probe() {
            externalApi = useAmnesiaProviderApi();
            return null;
        }
        function App() {
            const [_, setA] = useUndoableState(0, { scopeId: "small" });
            return (
                <div>
                    <output data-testid="value">{_}</output>
                    <button onClick={() => setA((n) => n + 1)}>inc</button>
                    <Probe />
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider scopes={{ small: { capacity: 2 } }}>
                <App />
            </AmnesiaProvider>,
        );

        // Fire 5 clicks. Capacity is 2 — the past stack should hold only the
        // last two entries.
        for (let i = 0; i < 5; i++) {
            await user.click(screen.getByText("inc"));
        }

        const snap = externalApi!.getScope("small").getSnapshot();
        expect(snap.past.length).toBe(2);
    });
});
