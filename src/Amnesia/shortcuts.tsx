// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Keyboard shortcut binding for Amnesia.
 *
 * Renders no DOM. Mounts a `keydown` listener on `window` (or a supplied
 * element) that maps the standard Undo / Redo chords to the surrounding
 * `AmnesiaProvider`.
 */

import { useEffect } from "react";
import { useAmnesiaStore } from "./provider";

/**
 * Props for `AmnesiaShortcuts`.
 */
export interface AmnesiaShortcutsProps {
    /**
     * DOM element to attach the listener to. Defaults to `window`. Pass a
     * specific element when you only want shortcuts active inside a
     * particular surface (e.g. a canvas region).
     */
    target?: HTMLElement | Document | Window | null;

    /**
     * When `true`, shortcuts are ignored while focus is on a native editable
     * surface (`<input>`, `<textarea>`, `contenteditable`). Browsers ship
     * their own undo stack for those, and stealing the chord usually breaks
     * user expectations.
     *
     * Defaults to `true`.
     */
    skipEditableTargets?: boolean;

    /**
     * When `true`, the handler calls `event.preventDefault()` after a
     * successful undo or redo. Defaults to `true`.
     */
    preventDefault?: boolean;

    /**
     * When `false`, completely disables the shortcut binding without
     * unmounting the component. Useful for temporarily silencing Amnesia
     * while a modal owns its own keybindings. Defaults to `true`.
     */
    enabled?: boolean;
}

/**
 * Mounts a global Undo / Redo keyboard handler.
 *
 * Bindings:
 * - Undo: `Ctrl+Z` / `Cmd+Z`
 * - Redo: `Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y`
 *
 * Render a single `<AmnesiaShortcuts />` somewhere inside the
 * `<AmnesiaProvider>` tree.
 */
export function AmnesiaShortcuts(props: AmnesiaShortcutsProps): null {
    const store = useAmnesiaStore();
    const { target, skipEditableTargets = true, preventDefault = true, enabled = true } = props;

    useEffect(() => {
        if (!enabled) return;
        const element = resolveTarget(target);
        if (!element) return;

        const handleKeyDown = (event: Event): void => {
            const ke = event as KeyboardEvent;
            if (skipEditableTargets && isEditableTarget(ke.target)) return;
            const mod = ke.metaKey || ke.ctrlKey;
            if (!mod) return;

            const key = ke.key.toLowerCase();
            const isUndoChord = key === "z" && !ke.shiftKey;
            const isRedoChord = (key === "z" && ke.shiftKey) || key === "y";

            if (isUndoChord) {
                const id = store.undo();
                if (id !== null && preventDefault) ke.preventDefault();
            } else if (isRedoChord) {
                const id = store.redo();
                if (id !== null && preventDefault) ke.preventDefault();
            }
        };

        element.addEventListener("keydown", handleKeyDown);
        return () => {
            element.removeEventListener("keydown", handleKeyDown);
        };
    }, [store, target, skipEditableTargets, preventDefault, enabled]);

    return null;
}

function resolveTarget(target: AmnesiaShortcutsProps["target"]): EventTarget | null {
    if (target === null) return null;
    if (target !== undefined) return target;
    if (typeof window === "undefined") return null;
    return window;
}

function isEditableTarget(node: EventTarget | null): boolean {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (node.isContentEditable) return true;
    return false;
}
