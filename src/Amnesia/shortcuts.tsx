// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Keyboard shortcut binding for Amnesia.
 *
 * Renders no DOM. Mounts a `keydown` listener on `window` (or a supplied
 * element) that maps the standard Undo / Redo chords to the surrounding
 * `AmnesiaProvider`. By default the chords route to whichever scope is
 * currently active (the most recently focused claim). Pass `scopeId` to pin
 * the binding to a single scope.
 */

import { useEffect } from "react";
import { useAmnesiaProviderApi } from "./provider";

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
     * Pin the binding to a specific scope. When omitted, the chord routes
     * to whichever scope is currently active (the most recently focused
     * claim, or the default scope when no claim is held).
     */
    scopeId?: string;

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
     * When `true`, the handler calls `event.preventDefault()` whenever the
     * chord matches and shortcuts are not skipped — regardless of whether
     * an undo / redo entry actually existed. This is the right default
     * because async `undo` / `redo` cannot synchronously decide whether to
     * suppress the browser's native chord. Defaults to `true`.
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
 * Mounts an Undo / Redo keyboard handler.
 *
 * Bindings:
 * - Undo: `Ctrl+Z` / `Cmd+Z`
 * - Redo: `Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y`
 *
 * Render exactly one `<AmnesiaShortcuts />` per provider for app-wide
 * routing. Render multiple, each with a `scopeId` and a different `target`,
 * to pin chords to specific surfaces.
 */
export function AmnesiaShortcuts(props: AmnesiaShortcutsProps): null {
    const api = useAmnesiaProviderApi();
    const { target, scopeId, skipEditableTargets = true, preventDefault = true, enabled = true } = props;

    useEffect(() => {
        if (!enabled) return;
        const element = resolveTarget(target);
        if (!element) return;

        const handleKeyDown = (event: Event): void => {
            const ke = event as KeyboardEvent;
            if (ke.defaultPrevented) return;
            if (ke.altKey) return;
            if (skipEditableTargets && isEditableTarget(ke.target)) return;
            const mod = ke.metaKey || ke.ctrlKey;
            if (!mod) return;

            const key = ke.key.toLowerCase();
            const isUndoChord = key === "z" && !ke.shiftKey;
            const isRedoChord = (key === "z" && ke.shiftKey) || key === "y";

            if (!isUndoChord && !isRedoChord) return;

            // Resolve the scope at handler time so live focus claims route
            // correctly without a re-render of this component.
            const targetScopeId = scopeId ?? api.getActiveScopeId();
            const store = api.getScope(targetScopeId);

            if (preventDefault) ke.preventDefault();
            if (isUndoChord) {
                void store.undo();
            } else {
                void store.redo();
            }
        };

        element.addEventListener("keydown", handleKeyDown);
        return () => {
            element.removeEventListener("keydown", handleKeyDown);
        };
    }, [api, scopeId, target, skipEditableTargets, preventDefault, enabled]);

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
