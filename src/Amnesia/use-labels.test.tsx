// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { fireEvent, render, screen } from "../test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AmnesiaProvider, useAmnesiaProviderApi } from "./provider";
import { useAmnesiaFocusClaim } from "./use-scopes";
import { useAmnesia } from "./use";
import { useAmnesiaLabels } from "./use-labels";

describe("useAmnesiaLabels", () => {
    it("derives menu labels and enablement from the current scope", async () => {
        function App() {
            const { push, undo, redo } = useAmnesia();
            const labels = useAmnesiaLabels();
            return (
                <div>
                    <output data-testid="undo-label">{labels.undoLabel}</output>
                    <output data-testid="redo-label">{labels.redoLabel}</output>
                    <output data-testid="can-undo">{labels.canUndo ? "y" : "n"}</output>
                    <output data-testid="can-redo">{labels.canRedo ? "y" : "n"}</output>
                    <button
                        onClick={() =>
                            void push(
                                {
                                    label: "Edit title",
                                    redo: () => undefined,
                                    undo: () => undefined,
                                },
                                { applied: true },
                            )
                        }
                    >
                        push
                    </button>
                    <button onClick={() => void undo()}>undo</button>
                    <button onClick={() => void redo()}>redo</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        expect(screen.getByTestId("undo-label").textContent).toBe("Undo");
        expect(screen.getByTestId("redo-label").textContent).toBe("Redo");
        expect(screen.getByTestId("can-undo").textContent).toBe("n");
        expect(screen.getByTestId("can-redo").textContent).toBe("n");

        await user.click(screen.getByText("push"));
        expect(screen.getByTestId("undo-label").textContent).toBe("Undo Edit title");
        expect(screen.getByTestId("redo-label").textContent).toBe("Redo");
        expect(screen.getByTestId("can-undo").textContent).toBe("y");
        expect(screen.getByTestId("can-redo").textContent).toBe("n");

        await user.click(screen.getByText("undo"));
        expect(screen.getByTestId("undo-label").textContent).toBe("Undo");
        expect(screen.getByTestId("redo-label").textContent).toBe("Redo Edit title");
        expect(screen.getByTestId("can-undo").textContent).toBe("n");
        expect(screen.getByTestId("can-redo").textContent).toBe("y");

        await user.click(screen.getByText("redo"));
        expect(screen.getByTestId("undo-label").textContent).toBe("Undo Edit title");
        expect(screen.getByTestId("redo-label").textContent).toBe("Redo");
        expect(screen.getByTestId("can-undo").textContent).toBe("y");
        expect(screen.getByTestId("can-redo").textContent).toBe("n");
    });

    it("tracks active scope when called without scopeId", () => {
        function CanvasRegion() {
            const claim = useAmnesiaFocusClaim("canvas");
            return (
                <section data-testid="canvas" tabIndex={-1} {...claim}>
                    canvas
                </section>
            );
        }

        function PropsRegion() {
            const claim = useAmnesiaFocusClaim("props");
            return (
                <section data-testid="props" tabIndex={-1} {...claim}>
                    props
                </section>
            );
        }

        function App() {
            const labels = useAmnesiaLabels();
            return (
                <div>
                    <output data-testid="scope-id">{labels.scopeId}</output>
                    <CanvasRegion />
                    <PropsRegion />
                </div>
            );
        }

        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        expect(screen.getByTestId("scope-id").textContent).toBe("default");

        fireEvent.pointerDown(screen.getByTestId("canvas"));
        expect(screen.getByTestId("scope-id").textContent).toBe("canvas");

        fireEvent.pointerDown(screen.getByTestId("props"));
        expect(screen.getByTestId("scope-id").textContent).toBe("props");
    });

    it("avoids re-rendering when derived label state is unchanged", async () => {
        let renders = 0;
        function LabelsProbe() {
            renders += 1;
            const labels = useAmnesiaLabels();
            return <output data-testid="undo-label">{labels.undoLabel}</output>;
        }

        function PushControls() {
            const api = useAmnesiaProviderApi();
            return (
                <button
                    onClick={() =>
                        void api.getScope("default").push(
                            {
                                label: "Edit title",
                                coalesceKey: "edit:title",
                                redo: () => undefined,
                                undo: () => undefined,
                            },
                            { applied: true },
                        )
                    }
                >
                    push
                </button>
            );
        }

        function App() {
            return (
                <div>
                    <LabelsProbe />
                    <PushControls />
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("push"));
        expect(screen.getByTestId("undo-label").textContent).toBe("Undo Edit title");
        const afterFirstPush = renders;

        // Coalesced push keeps undo label and enablement unchanged; selector
        // should preserve reference and skip a re-render.
        await user.click(screen.getByText("push"));
        expect(renders).toBe(afterFirstPush);
    });
});
