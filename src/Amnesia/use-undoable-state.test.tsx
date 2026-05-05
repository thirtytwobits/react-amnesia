// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AmnesiaProvider } from "./provider";
import { useAmnesia } from "./use";
import { useUndoableState } from "./use-undoable-state";

describe("useUndoableState — reset (Workstream F)", () => {
    it("returns a [value, set, reset] tuple", async () => {
        function App() {
            const [value, setValue, reset] = useUndoableState(0);
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <button onClick={() => setValue((n) => n + 1)}>inc</button>
                    <button onClick={() => reset()}>reset</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("value").textContent).toBe("2");

        await user.click(screen.getByText("reset"));
        expect(screen.getByTestId("value").textContent).toBe("0");
    });

    it("reset() with no argument restores the initial value captured on first render", async () => {
        function App() {
            const [value, setValue, reset] = useUndoableState(() => 42);
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <button onClick={() => setValue(100)}>set-100</button>
                    <button onClick={() => reset()}>reset</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("set-100"));
        expect(screen.getByTestId("value").textContent).toBe("100");

        await user.click(screen.getByText("reset"));
        expect(screen.getByTestId("value").textContent).toBe("42");
    });

    it("reset(next) overwrites with a specific value", async () => {
        function App() {
            const [value, setValue, reset] = useUndoableState("a");
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <button onClick={() => setValue("b")}>set-b</button>
                    <button onClick={() => reset("z")}>reset-z</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("set-b"));
        await user.click(screen.getByText("reset-z"));
        expect(screen.getByTestId("value").textContent).toBe("z");
    });

    it("reset(() => factory) computes the next value lazily", async () => {
        let counter = 0;
        function App() {
            const [value, setValue, reset] = useUndoableState(0);
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <button onClick={() => setValue(99)}>bump</button>
                    <button onClick={() => reset(() => ++counter * 10)}>reset</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("bump"));
        await user.click(screen.getByText("reset"));
        expect(screen.getByTestId("value").textContent).toBe("10");

        await user.click(screen.getByText("bump"));
        await user.click(screen.getByText("reset"));
        expect(screen.getByTestId("value").textContent).toBe("20");
    });

    it("reset clears canUndo and canRedo and does not push an entry", async () => {
        function App() {
            const [value, setValue, reset] = useUndoableState(0);
            const { canUndo, canRedo, past } = useAmnesia();
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <output data-testid="depth">{past.length}</output>
                    <output data-testid="canUndo">{canUndo ? "y" : "n"}</output>
                    <output data-testid="canRedo">{canRedo ? "y" : "n"}</output>
                    <button onClick={() => setValue((n) => n + 1)}>inc</button>
                    <button onClick={() => reset()}>reset</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("depth").textContent).toBe("3");
        expect(screen.getByTestId("canUndo").textContent).toBe("y");

        await user.click(screen.getByText("reset"));
        expect(screen.getByTestId("depth").textContent).toBe("0");
        expect(screen.getByTestId("canUndo").textContent).toBe("n");
        expect(screen.getByTestId("canRedo").textContent).toBe("n");
    });

    it("reset on one scope does not affect another scope", async () => {
        function App() {
            const [a, setA, resetA] = useUndoableState(0, { scopeId: "a" });
            const [b, setB] = useUndoableState(0, { scopeId: "b" });
            return (
                <div>
                    <output data-testid="a">{a}</output>
                    <output data-testid="b">{b}</output>
                    <button onClick={() => setA((n) => n + 1)}>inc-a</button>
                    <button onClick={() => setB((n) => n + 1)}>inc-b</button>
                    <button onClick={() => resetA()}>reset-a</button>
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
        await user.click(screen.getByText("inc-b"));
        await user.click(screen.getByText("reset-a"));

        expect(screen.getByTestId("a").textContent).toBe("0");
        expect(screen.getByTestId("b").textContent).toBe("1");
    });

    it("the captured initial survives strict-mode double-invocation", async () => {
        // The initializer is allowed to be called twice in dev; reset()
        // should always return to the value the FIRST mount stored, not a
        // freshly-computed one.
        const seen: number[] = [];
        function App() {
            const [value, setValue, reset] = useUndoableState(() => {
                const next = seen.length + 1;
                seen.push(next);
                return next;
            });
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <button onClick={() => setValue(99)}>bump</button>
                    <button onClick={() => reset()}>reset</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        const captured = Number(screen.getByTestId("value").textContent);
        await user.click(screen.getByText("bump"));
        await user.click(screen.getByText("reset"));
        expect(Number(screen.getByTestId("value").textContent)).toBe(captured);
    });
});
