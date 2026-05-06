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
import { isNativeEditableElement } from "../native";
import { useAmnesiaProviderApi } from "./provider";

/**
 * Acceptable values for `AmnesiaShortcutsProps.target`.
 *
 * - `"window"` (the default) — listen on `window`.
 * - `"document"` — listen on `document`. Useful when something stops
 *   propagation before reaching `window`.
 * - An `HTMLElement` / `Document` / `Window` — listen on that exact target.
 *   Useful for region-scoped surfaces (canvas, custom editor).
 * - `null` — do not attach a listener at all.
 *
 * The string forms are resolved at handler-attach time inside `useEffect`,
 * so they are SSR-safe — passing `"document"` from a component that may
 * render on the server will not throw.
 */
export type AmnesiaShortcutsTarget = HTMLElement | Document | Window | "document" | "window" | null;

/**
 * Props for `AmnesiaShortcuts`.
 */
export interface AmnesiaShortcutsProps {
    /**
     * DOM target (or string alias) to attach the listener to. Defaults to
     * `"window"`. See {@link AmnesiaShortcutsTarget} for the full set of
     * acceptable values.
     */
    target?: AmnesiaShortcutsTarget;

    /**
     * Pin the binding to a specific scope. When omitted, the chord routes
     * to whichever scope is currently active (the most recently focused
     * claim, or the default scope when no claim is held).
     */
    scopeId?: string;

    /**
     * When `true`, shortcuts are ignored while focus is on a native editable
     * surface (text-like `<input>` types, `<textarea>`, `<select>`, or
     * `contenteditable`). Browsers ship their own undo stack for those, and
     * stealing the chord usually breaks user expectations.
     *
     * The check is **shadow-DOM transparent**: events that originate inside
     * an open shadow root whose deep target is editable are also skipped,
     * even though `event.target` is retargeted to the host outside the
     * shadow boundary.
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
            if (skipEditableTargets && isEditableTarget(ke)) return;
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

function resolveTarget(target: AmnesiaShortcutsTarget | undefined): EventTarget | null {
    if (target === null) return null;
    if (target === "document") return typeof document !== "undefined" ? document : null;
    if (target === "window") return typeof window !== "undefined" ? window : null;
    if (target !== undefined) return target;
    if (typeof window === "undefined") return null;
    return window;
}

/**
 * Determine whether a keydown event originated inside a native editable
 * region (text-like `<input>`, `<textarea>`, `<select>`, or
 * `contenteditable`).
 *
 * Walks `event.composedPath()` so editables inside open shadow roots are
 * detected even when `event.target` has been retargeted to the host. Falls
 * back to `event.target` only when `composedPath` is unavailable.
 */
function isEditableTarget(event: KeyboardEvent): boolean {
    const composed: EventTarget[] = typeof event.composedPath === "function" ? event.composedPath() : [];
    const candidates: ReadonlyArray<EventTarget> = composed.length > 0 ? composed : event.target ? [event.target] : [];
    for (const node of candidates) {
        if (isNativeEditableElement(node)) return true;
    }
    return false;
}
