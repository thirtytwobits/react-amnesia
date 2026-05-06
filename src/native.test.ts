// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchNativeUndo, isNativeEditableElement } from "./native";

const doc = document as Document & { execCommand?: (commandId: string) => boolean };
const originalExecCommand = doc.execCommand;

describe("isNativeEditableElement", () => {
    it("returns true for text-like native editables", () => {
        const text = document.createElement("input");
        text.type = "text";
        const number = document.createElement("input");
        number.type = "number";
        const textarea = document.createElement("textarea");
        const select = document.createElement("select");
        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "true");

        expect(isNativeEditableElement(text)).toBe(true);
        expect(isNativeEditableElement(number)).toBe(true);
        expect(isNativeEditableElement(textarea)).toBe(true);
        expect(isNativeEditableElement(select)).toBe(true);
        expect(isNativeEditableElement(editable)).toBe(true);
    });

    it("returns false for non-text input types", () => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        const radio = document.createElement("input");
        radio.type = "radio";
        const range = document.createElement("input");
        range.type = "range";
        const button = document.createElement("input");
        button.type = "button";

        expect(isNativeEditableElement(checkbox)).toBe(false);
        expect(isNativeEditableElement(radio)).toBe(false);
        expect(isNativeEditableElement(range)).toBe(false);
        expect(isNativeEditableElement(button)).toBe(false);
    });

    it("traverses ancestors so descendants of contenteditable count as editable", () => {
        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "true");
        const child = document.createElement("span");
        editable.appendChild(child);

        expect(isNativeEditableElement(child)).toBe(true);
    });

    it("is shadow-DOM transparent for open roots by following shadowRoot.activeElement", () => {
        const host = document.createElement("div");
        const root = host.attachShadow({ mode: "open" });
        const input = document.createElement("input");
        input.type = "text";
        root.appendChild(input);
        document.body.appendChild(host);
        try {
            input.focus();
            expect(isNativeEditableElement(host)).toBe(true);
        } finally {
            input.blur();
            host.remove();
        }
    });

    it("returns false for non-editable targets", () => {
        const div = document.createElement("div");
        expect(isNativeEditableElement(div)).toBe(false);
        expect(isNativeEditableElement(null)).toBe(false);
    });
});

describe("dispatchNativeUndo", () => {
    it("dispatches undo/redo through document.execCommand when available", () => {
        const spy = vi.fn((command: string) => command === "undo");
        doc.execCommand = spy;

        expect(dispatchNativeUndo("undo")).toBe(true);
        expect(dispatchNativeUndo("redo")).toBe(false);
        expect(spy).toHaveBeenNthCalledWith(1, "undo");
        expect(spy).toHaveBeenNthCalledWith(2, "redo");
    });

    it("returns false when execCommand throws", () => {
        doc.execCommand = () => {
            throw new Error("not supported");
        };
        expect(dispatchNativeUndo("undo")).toBe(false);
    });

    it("returns false when execCommand is unavailable", () => {
        (doc as unknown as { execCommand: unknown }).execCommand = undefined;
        expect(dispatchNativeUndo("undo")).toBe(false);
    });
});

afterEach(() => {
    doc.execCommand = originalExecCommand;
});
