// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen } from "../test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createAmnesiaStore } from "./history";
import { AmnesiaProvider, useAmnesiaScope } from "./provider";
import { AmnesiaShortcuts } from "./shortcuts";
import type { Amnesia } from "./types";
import { useAmnesia } from "./use";
import { useUndoableState } from "./use-undoable-state";

function Counter() {
    const [count, setCount] = useUndoableState(0, { label: "increment" });
    const { undo, redo, canUndo, canRedo } = useAmnesia();
    return (
        <div>
            <output data-testid="count">{count}</output>
            <button onClick={() => setCount((n) => n + 1)}>inc</button>
            <button disabled={!canUndo} onClick={() => undo()}>
                undo
            </button>
            <button disabled={!canRedo} onClick={() => redo()}>
                redo
            </button>
        </div>
    );
}

describe("useUndoableState", () => {
    it("undoes and redoes through the surrounding store", async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("count").textContent).toBe("2");

        await user.click(screen.getByText("undo"));
        expect(screen.getByTestId("count").textContent).toBe("1");

        await user.click(screen.getByText("redo"));
        expect(screen.getByTestId("count").textContent).toBe("2");
    });

    it("ignores writes that produce an equal value", async () => {
        function App() {
            const [value, setValue] = useUndoableState(7);
            const { past } = useAmnesia();
            return (
                <div>
                    <output data-testid="value">{value}</output>
                    <output data-testid="depth">{past.length}</output>
                    <button onClick={() => setValue(7)}>set-same</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("set-same"));
        await user.click(screen.getByText("set-same"));
        expect(screen.getByTestId("depth").textContent).toBe("0");
    });
});

describe("useAmnesia actions", () => {
    it("exposes amend() and folds a refinement into the latest entry", async () => {
        function App() {
            const [title, setTitle] = useState("");
            const { push, amend, undo, redo, canUndo, canRedo, past } = useAmnesia();

            return (
                <div>
                    <output data-testid="title">{title}</output>
                    <output data-testid="depth">{past.length}</output>
                    <button
                        onClick={() => {
                            const previous = title;
                            const next = "a";
                            setTitle(next);
                            void push(
                                {
                                    label: "Edit title",
                                    redo: () => setTitle(next),
                                    undo: () => setTitle(previous),
                                },
                                { applied: true },
                            );
                        }}
                    >
                        first
                    </button>
                    <button
                        onClick={() => {
                            const next = "ab";
                            setTitle(next);
                            void amend({
                                label: "Edit title (refined)",
                                redo: () => setTitle(next),
                            });
                        }}
                    >
                        refine
                    </button>
                    <button disabled={!canUndo} onClick={() => undo()}>
                        undo
                    </button>
                    <button disabled={!canRedo} onClick={() => redo()}>
                        redo
                    </button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("first"));
        await user.click(screen.getByText("refine"));
        expect(screen.getByTestId("title").textContent).toBe("ab");
        expect(screen.getByTestId("depth").textContent).toBe("1");

        await user.click(screen.getByText("undo"));
        expect(screen.getByTestId("title").textContent).toBe("");

        await user.click(screen.getByText("redo"));
        expect(screen.getByTestId("title").textContent).toBe("ab");
    });
});

describe("AmnesiaShortcuts", () => {
    it("binds Ctrl+Z and Ctrl+Shift+Z", () => {
        function App() {
            const [count, setCount] = useUndoableState(0);
            return (
                <div>
                    <output data-testid="count">{count}</output>
                    <button onClick={() => setCount((n) => n + 1)}>inc</button>
                    <AmnesiaShortcuts skipEditableTargets={false} />
                </div>
            );
        }

        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        act(() => {
            screen.getByText("inc").click();
            screen.getByText("inc").click();
        });
        expect(screen.getByTestId("count").textContent).toBe("2");

        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
        expect(screen.getByTestId("count").textContent).toBe("1");

        fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId("count").textContent).toBe("2");
    });

    it("ignores chords from editable targets when skipEditableTargets is true", () => {
        function App() {
            const [count, setCount] = useUndoableState(0);
            return (
                <div>
                    <output data-testid="count">{count}</output>
                    <button onClick={() => setCount((n) => n + 1)}>inc</button>
                    <input data-testid="editor" />
                    <AmnesiaShortcuts skipEditableTargets />
                </div>
            );
        }

        render(
            <AmnesiaProvider>
                <App />
            </AmnesiaProvider>,
        );

        act(() => {
            screen.getByText("inc").click();
        });
        const editor = screen.getByTestId("editor");
        editor.focus();
        fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
        expect(screen.getByTestId("count").textContent).toBe("1");
    });
});

describe("AmnesiaProvider error boundary", () => {
    it("throws when useAmnesia is called outside a provider", () => {
        function Orphan() {
            useAmnesia();
            return null;
        }
        const original = console.error;
        console.error = () => {};
        try {
            expect(() => render(<Orphan />)).toThrow(/AmnesiaProvider/);
        } finally {
            console.error = original;
        }
    });
});

describe("AmnesiaProvider — strict mode + lifecycle", () => {
    it("a single button click pushes exactly one entry under StrictMode", async () => {
        function App() {
            const [count, setCount] = useUndoableState(0);
            const { past } = useAmnesia();
            return (
                <div>
                    <output data-testid="count">{count}</output>
                    <output data-testid="depth">{past.length}</output>
                    <button onClick={() => setCount((n) => n + 1)}>inc</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <StrictMode>
                <AmnesiaProvider>
                    <App />
                </AmnesiaProvider>
            </StrictMode>,
        );

        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("count").textContent).toBe("1");
        expect(screen.getByTestId("depth").textContent).toBe("1");
    });

    it("does not auto-dispose the store on unmount", () => {
        // Auto-dispose-on-unmount conflicts with React 18 StrictMode dev's
        // simulated effect cleanup-then-setup cycle, which would dispose a
        // still-rendered store. Consumers who share a store with non-React
        // code should call store.dispose() themselves when tearing down.
        const store = createAmnesiaStore();
        const disposeSpy = vi.spyOn(store, "dispose");
        const { unmount } = render(
            <AmnesiaProvider store={store}>
                <div />
            </AmnesiaProvider>,
        );
        unmount();
        expect(disposeSpy).not.toHaveBeenCalled();

        const ownedRef: { current: Amnesia | null } = { current: null };
        function Probe() {
            ownedRef.current = useAmnesiaScope();
            return null;
        }
        const owned = render(
            <AmnesiaProvider>
                <Probe />
            </AmnesiaProvider>,
        );
        expect(ownedRef.current).not.toBeNull();
        const ownedDispose = vi.spyOn(ownedRef.current!, "dispose");
        owned.unmount();
        expect(ownedDispose).not.toHaveBeenCalled();
    });
});

describe("AmnesiaProvider option forwarding", () => {
    it("forwards provider-level hooks and metaTransform to the underlying default scope", async () => {
        const onPush = vi.fn();
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onClear = vi.fn();
        const onAmend = vi.fn();

        function App() {
            const { push, amend, undo, redo, clear, canUndo, canRedo } = useAmnesia();
            return (
                <div>
                    <button
                        onClick={() =>
                            void push(
                                {
                                    label: "With meta",
                                    meta: { secret: "shh", visible: 1 },
                                    redo: () => undefined,
                                    undo: () => undefined,
                                },
                                { applied: true },
                            )
                        }
                    >
                        push
                    </button>
                    <button onClick={() => void amend({ label: "With meta (amended)" })}>amend</button>
                    <button disabled={!canUndo} onClick={() => void undo()}>
                        undo
                    </button>
                    <button disabled={!canRedo} onClick={() => void redo()}>
                        redo
                    </button>
                    <button onClick={() => clear()}>clear</button>
                </div>
            );
        }

        const user = userEvent.setup();
        render(
            <AmnesiaProvider
                onPush={onPush}
                onAmend={onAmend}
                onUndo={onUndo}
                onRedo={onRedo}
                onClear={onClear}
                metaTransform={(meta) => {
                    const { secret: _secret, ...rest } = meta;
                    return rest;
                }}
            >
                <App />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("push"));
        expect(onPush).toHaveBeenCalledTimes(1);
        expect(onPush.mock.calls[0]?.[0]).toMatchObject({
            label: "With meta",
            meta: { visible: 1 },
        });

        await user.click(screen.getByText("amend"));
        expect(onAmend).toHaveBeenCalledTimes(1);
        expect(onAmend.mock.calls[0]?.[0]).toMatchObject({
            label: "With meta (amended)",
            meta: { visible: 1 },
        });

        await user.click(screen.getByText("undo"));
        expect(onUndo).toHaveBeenCalledTimes(1);
        await user.click(screen.getByText("redo"));
        expect(onRedo).toHaveBeenCalledTimes(1);

        await user.click(screen.getByText("clear"));
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(onClear.mock.calls[0]?.[0]).toBe("default");
    });
});
