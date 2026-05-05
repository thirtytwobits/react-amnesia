// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { render, screen } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { MnemonicProvider } from "react-mnemonic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AmnesiaProvider } from "./Amnesia/provider";
import { useAmnesia } from "./Amnesia/use";
import { usePersistedUndoableState } from "./mnemonic";

function App() {
    const { value, set } = usePersistedUndoableState<number>("count", { defaultValue: 0, label: "count" });
    const { undo, redo, canUndo, canRedo } = useAmnesia();
    return (
        <div>
            <output data-testid="count">{value}</output>
            <button onClick={() => set((n) => n + 1)}>inc</button>
            <button disabled={!canUndo} onClick={() => undo()}>
                undo
            </button>
            <button disabled={!canRedo} onClick={() => redo()}>
                redo
            </button>
        </div>
    );
}

describe("usePersistedUndoableState", () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        localStorage.clear();
    });

    it("persists the latest value via react-mnemonic and undoes through the Amnesia store", async () => {
        const user = userEvent.setup();
        render(
            <MnemonicProvider namespace="test">
                <AmnesiaProvider>
                    <App />
                </AmnesiaProvider>
            </MnemonicProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("count").textContent).toBe("2");
        expect(localStorage.getItem("test.count")).toContain("2");

        await user.click(screen.getByText("undo"));
        expect(screen.getByTestId("count").textContent).toBe("1");
        expect(localStorage.getItem("test.count")).toContain("1");

        await user.click(screen.getByText("redo"));
        expect(screen.getByTestId("count").textContent).toBe("2");
    });

    it("reads the persisted value on remount and starts with an empty history", async () => {
        const user = userEvent.setup();
        const { unmount } = render(
            <MnemonicProvider namespace="test">
                <AmnesiaProvider>
                    <App />
                </AmnesiaProvider>
            </MnemonicProvider>,
        );
        await user.click(screen.getByText("inc"));
        unmount();

        render(
            <MnemonicProvider namespace="test">
                <AmnesiaProvider>
                    <App />
                </AmnesiaProvider>
            </MnemonicProvider>,
        );
        expect(screen.getByTestId("count").textContent).toBe("1");
        expect((screen.getByText("undo") as HTMLButtonElement).disabled).toBe(true);
    });

    it("reset() restores the persisted defaultValue and clears the history scope", async () => {
        function ResetApp() {
            const { value, set, reset } = usePersistedUndoableState<number>("count", {
                defaultValue: 0,
                label: "count",
            });
            const { canUndo } = useAmnesia();
            return (
                <div>
                    <output data-testid="count">{value}</output>
                    <output data-testid="canUndo">{canUndo ? "y" : "n"}</output>
                    <button onClick={() => set((n) => n + 1)}>inc</button>
                    <button onClick={() => reset()}>reset</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <MnemonicProvider namespace="test">
                <AmnesiaProvider>
                    <ResetApp />
                </AmnesiaProvider>
            </MnemonicProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("count").textContent).toBe("2");
        expect(localStorage.getItem("test.count")).toContain("2");

        await user.click(screen.getByText("reset"));
        expect(screen.getByTestId("count").textContent).toBe("0");
        // Persisted value rewritten to defaultValue.
        expect(localStorage.getItem("test.count")).toContain("0");
        // History was wiped — no undo available.
        expect(screen.getByTestId("canUndo").textContent).toBe("n");
    });

    it("reset(next) writes a specific value through the persistence layer", async () => {
        function ResetApp() {
            const { value, set, reset } = usePersistedUndoableState<number>("count", { defaultValue: 0 });
            return (
                <div>
                    <output data-testid="count">{value}</output>
                    <button onClick={() => set((n) => n + 1)}>inc</button>
                    <button onClick={() => reset(99)}>reset-99</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <MnemonicProvider namespace="test">
                <AmnesiaProvider>
                    <ResetApp />
                </AmnesiaProvider>
            </MnemonicProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("reset-99"));
        expect(screen.getByTestId("count").textContent).toBe("99");
        expect(localStorage.getItem("test.count")).toContain("99");
    });

    it("remove() deletes the persisted key AND clears the history scope", async () => {
        function RemoveApp() {
            const { value, set, remove } = usePersistedUndoableState<number>("count", {
                defaultValue: 0,
            });
            const { canUndo } = useAmnesia();
            return (
                <div>
                    <output data-testid="count">{value}</output>
                    <output data-testid="canUndo">{canUndo ? "y" : "n"}</output>
                    <button onClick={() => set((n) => n + 1)}>inc</button>
                    <button onClick={() => remove()}>remove</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <MnemonicProvider namespace="test">
                <AmnesiaProvider>
                    <RemoveApp />
                </AmnesiaProvider>
            </MnemonicProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(localStorage.getItem("test.count")).toContain("2");

        await user.click(screen.getByText("remove"));
        // Storage entry gone; next read falls back to defaultValue.
        expect(localStorage.getItem("test.count")).toBeNull();
        expect(screen.getByTestId("count").textContent).toBe("0");
        expect(screen.getByTestId("canUndo").textContent).toBe("n");
    });
});
