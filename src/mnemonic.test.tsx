// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { render, screen } from "@testing-library/react";
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
});
