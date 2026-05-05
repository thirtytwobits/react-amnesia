// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Shared testing helpers.
 *
 * The `render` re-export here wraps every test render in `<StrictMode>` so
 * the dev double-mount cycle (React 18+) is exercised on every component
 * test. If a test passes here, it passes outside StrictMode too.
 *
 * Tests that explicitly need to render outside StrictMode (e.g. when
 * proving that a strict-mode-only behavior would otherwise differ) can
 * import the underlying `render` from `@testing-library/react` directly.
 */

import { StrictMode, type ReactElement } from "react";
import { render as rtlRender, type RenderOptions, type RenderResult } from "@testing-library/react";

export * from "@testing-library/react";

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
    return rtlRender(ui, {
        ...options,
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
}
