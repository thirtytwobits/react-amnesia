// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { useEffect, useRef } from "react";
import { fireEvent, render, screen } from "../test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AmnesiaProvider } from "./provider";
import { AmnesiaShortcuts } from "./shortcuts";
import { useUndoableState } from "./use-undoable-state";

const flush = () => Promise.resolve();

function Counter({ shortcuts }: { shortcuts: React.ReactNode }) {
    const [count, setCount] = useUndoableState(0);
    return (
        <div>
            <output data-testid="count">{count}</output>
            <button onClick={() => setCount((n) => n + 1)}>inc</button>
            {shortcuts}
        </div>
    );
}

describe("AmnesiaShortcuts — Workstream G polish", () => {
    it("ignores chords whose event.defaultPrevented is true", async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter shortcuts={<AmnesiaShortcuts skipEditableTargets={false} />} />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("count").textContent).toBe("2");

        // A capture-phase listener calls preventDefault before our binding
        // (which is a regular bubble-phase listener) gets the event.
        const blocker = (event: Event) => event.preventDefault();
        window.addEventListener("keydown", blocker, true);
        try {
            fireEvent.keyDown(window, { key: "z", ctrlKey: true });
            await flush();
        } finally {
            window.removeEventListener("keydown", blocker, true);
        }
        // Our binding observed defaultPrevented=true and stayed out of the way.
        expect(screen.getByTestId("count").textContent).toBe("2");
    });

    it("ignores chords with the Alt modifier", async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter shortcuts={<AmnesiaShortcuts skipEditableTargets={false} />} />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        // Ctrl+Alt+Z — Alt makes it a different chord; we must not consume it.
        fireEvent.keyDown(window, { key: "z", ctrlKey: true, altKey: true });
        await flush();
        expect(screen.getByTestId("count").textContent).toBe("1");
    });

    it('attaches to document when target="document"', async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter shortcuts={<AmnesiaShortcuts target="document" skipEditableTargets={false} />} />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));

        // Dispatch on document, not window — the listener should fire.
        fireEvent.keyDown(document, { key: "z", ctrlKey: true });
        await flush();
        expect(screen.getByTestId("count").textContent).toBe("1");
    });

    it('attaches to window when target="window" (default behavior, made explicit)', async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter shortcuts={<AmnesiaShortcuts target="window" skipEditableTargets={false} />} />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
        await flush();
        expect(screen.getByTestId("count").textContent).toBe("0");
    });

    it("does not attach when target is null", async () => {
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter shortcuts={<AmnesiaShortcuts target={null} skipEditableTargets={false} />} />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
        await flush();
        // No listener was attached, so the chord is a no-op.
        expect(screen.getByTestId("count").textContent).toBe("1");
    });
});

describe("AmnesiaShortcuts — shadow-DOM editable detection", () => {
    /**
     * Mounts a host element with an open shadow root containing an `<input>`
     * inside. Returns refs to the host and the input so tests can dispatch
     * events from inside the shadow boundary.
     */
    function ShadowHost({ inputRef }: { inputRef: React.MutableRefObject<HTMLInputElement | null> }) {
        const hostRef = useRef<HTMLDivElement | null>(null);
        useEffect(() => {
            const host = hostRef.current;
            if (!host) return;
            if (host.shadowRoot) return;
            const root = host.attachShadow({ mode: "open" });
            const input = document.createElement("input");
            input.setAttribute("data-testid", "shadow-input");
            root.appendChild(input);
            inputRef.current = input;
        }, [inputRef]);
        return <div ref={hostRef} data-testid="shadow-host" />;
    }

    it("skips chords originating inside a shadow-DOM editable when skipEditableTargets=true", async () => {
        const inputRef: React.MutableRefObject<HTMLInputElement | null> = { current: null };
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter
                    shortcuts={
                        <>
                            <AmnesiaShortcuts skipEditableTargets={true} />
                            <ShadowHost inputRef={inputRef} />
                        </>
                    }
                />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));
        expect(screen.getByTestId("count").textContent).toBe("2");

        const input = inputRef.current;
        expect(input).not.toBeNull();
        // Bubble + composed so it reaches the window listener with the
        // correct composedPath including the shadow-DOM input.
        const event = new KeyboardEvent("keydown", {
            key: "z",
            ctrlKey: true,
            bubbles: true,
            composed: true,
        });
        input!.dispatchEvent(event);
        await flush();

        // Editable inside a shadow root is recognized; chord is skipped.
        expect(screen.getByTestId("count").textContent).toBe("2");
    });

    it("fires through a shadow-DOM editable when skipEditableTargets=false", async () => {
        const inputRef: React.MutableRefObject<HTMLInputElement | null> = { current: null };
        const user = userEvent.setup();
        render(
            <AmnesiaProvider>
                <Counter
                    shortcuts={
                        <>
                            <AmnesiaShortcuts skipEditableTargets={false} />
                            <ShadowHost inputRef={inputRef} />
                        </>
                    }
                />
            </AmnesiaProvider>,
        );

        await user.click(screen.getByText("inc"));
        await user.click(screen.getByText("inc"));

        const input = inputRef.current;
        expect(input).not.toBeNull();
        const event = new KeyboardEvent("keydown", {
            key: "z",
            ctrlKey: true,
            bubbles: true,
            composed: true,
        });
        input!.dispatchEvent(event);
        await flush();

        // skipEditableTargets disabled → undo runs.
        expect(screen.getByTestId("count").textContent).toBe("1");
    });
});
