// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview DOM-native helpers for editable-surface detection and
 * browser undo/redo dispatch.
 *
 * Exported from `react-amnesia/native` for shell/menu integrations
 * (Electron/Tauri) that need to route Undo/Redo to the browser when focus is
 * inside a native editable surface.
 */

const NON_TEXT_INPUT_TYPES = new Set<string>([
    "button",
    "checkbox",
    "color",
    "date",
    "datetime-local",
    "file",
    "hidden",
    "image",
    "month",
    "radio",
    "range",
    "reset",
    "submit",
    "time",
    "week",
]);

function isTextLikeInput(element: HTMLInputElement): boolean {
    const rawType = (element.getAttribute("type") ?? element.type ?? "text").trim().toLowerCase();
    const normalized = rawType === "" ? "text" : rawType;
    return !NON_TEXT_INPUT_TYPES.has(normalized);
}

function nextElementInChain(start: Element): Element | null {
    if (start.parentElement) return start.parentElement;
    const root = typeof start.getRootNode === "function" ? start.getRootNode() : null;
    if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) return root.host;
    return null;
}

function resolveOpenShadowActiveElement(start: Element): Element {
    let current: Element = start;
    while (true) {
        if (!(current instanceof HTMLElement)) return current;
        const root = current.shadowRoot;
        if (!root?.activeElement) return current;
        current = root.activeElement;
    }
}

function resolveInitialElement(target: EventTarget | null): Element | null {
    if (!target || typeof Element === "undefined") return null;
    if (target instanceof Element) return target;
    if (typeof Document !== "undefined" && target instanceof Document) return target.activeElement;
    if (typeof ShadowRoot !== "undefined" && target instanceof ShadowRoot) return target.activeElement;
    if (typeof Node !== "undefined" && target instanceof Node) return target.parentElement;
    return null;
}

function isNativeEditableSelf(element: Element): boolean {
    if (typeof HTMLTextAreaElement !== "undefined" && element instanceof HTMLTextAreaElement) return true;
    if (typeof HTMLSelectElement !== "undefined" && element instanceof HTMLSelectElement) return true;
    if (typeof HTMLInputElement !== "undefined" && element instanceof HTMLInputElement) return isTextLikeInput(element);
    if (typeof HTMLElement !== "undefined" && element instanceof HTMLElement) {
        if (element.isContentEditable) return true;
        const contentEditable = element.getAttribute("contenteditable")?.toLowerCase();
        return contentEditable === "" || contentEditable === "true" || contentEditable === "plaintext-only";
    }
    return false;
}

/**
 * Returns true when `target` resolves to a native editable surface where the
 * browser ships its own undo stack.
 *
 * Rules:
 * - `textarea`, `select`, and contenteditable regions are editable.
 * - `input` is editable only for text-like types (e.g. `text`, `email`,
 *   `search`, `tel`, `url`, `password`, `number`).
 * - Traverses ancestors (including across open shadow-root boundaries) so
 *   descendants inside contenteditable regions are recognized.
 * - If passed a host element with an open shadow root, follows the deep
 *   active element via `shadowRoot.activeElement`.
 */
export function isNativeEditableElement(target: EventTarget | null): boolean {
    const initial = resolveInitialElement(target);
    if (!initial) return false;
    for (let current: Element | null = resolveOpenShadowActiveElement(initial); current; current = nextElementInChain(current)) {
        if (isNativeEditableSelf(current)) return true;
    }
    return false;
}

/**
 * Fire the browser's native undo/redo via `document.execCommand`.
 *
 * Returns `true` if the browser accepted the command. Returns `false` when no
 * DOM is available, `execCommand` is unavailable, or the command throws.
 */
export function dispatchNativeUndo(action: "undo" | "redo"): boolean {
    if (typeof document === "undefined") return false;
    const doc = document as Document & { execCommand?: (commandId: string) => boolean };
    if (typeof doc.execCommand !== "function") return false;
    try {
        return doc.execCommand(action);
    } catch {
        return false;
    }
}
