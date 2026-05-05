// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Hooks for multi-scope orchestration:
 *
 * - `useAmnesiaFocusClaim(scopeId)` — focus-capture handlers that mark a
 *   surface as the active scope while it owns focus.
 * - `useAmnesiaScopes()` — provider-level view of registered scopes plus a
 *   `clearAll()` helper.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore, type FocusEventHandler, type PointerEventHandler } from "react";
import { useAmnesiaProviderApi } from "./provider";

/**
 * Handlers returned by `useAmnesiaFocusClaim`. Spread onto a focusable
 * element (or an outer container with `tabIndex={-1}`) to mark the scope
 * as active whenever the element or any descendant gains focus.
 */
export interface AmnesiaFocusClaimHandlers {
    /**
     * Capture-phase focus handler. Claims `scopeId` whenever any element in
     * the subtree receives focus.
     */
    onFocusCapture: FocusEventHandler<Element>;

    /**
     * Capture-phase pointer-down handler. Claims `scopeId` on the first
     * pointer interaction even before `focus` fires (e.g. on click into a
     * non-focusable region styled as the active surface).
     */
    onPointerDownCapture: PointerEventHandler<Element>;
}

/**
 * Returns capture-phase focus handlers that claim `scopeId` as the active
 * scope while this surface is in use. Must be called inside an
 * `AmnesiaProvider`.
 *
 * @example
 * ```tsx
 * function PropertyPanel() {
 *     const claim = useAmnesiaFocusClaim("props");
 *     return (
 *         <section tabIndex={-1} {...claim}>
 *             <input />
 *         </section>
 *     );
 * }
 * ```
 *
 * The hook also releases the claim on unmount: if `scopeId` is the active
 * claimant when the component tears down, the active scope falls back to
 * the default. The release is a no-op when another scope was claimed in
 * the meantime.
 *
 * Single-flight: at most one claim is held at a time. The most recently
 * claimed scope wins.
 */
export function useAmnesiaFocusClaim(scopeId: string): AmnesiaFocusClaimHandlers {
    const api = useAmnesiaProviderApi();

    const claim = useCallback(() => {
        api.claim(scopeId);
    }, [api, scopeId]);

    useEffect(() => {
        return () => {
            api.release(scopeId);
        };
    }, [api, scopeId]);

    return useMemo<AmnesiaFocusClaimHandlers>(
        () => ({
            onFocusCapture: claim,
            onPointerDownCapture: claim,
        }),
        [claim],
    );
}

/**
 * View of the multi-scope provider. Re-renders when the active scope id
 * changes. `scopeIds` is a snapshot of the currently-known scopes; new
 * scopes created lazily via `useAmnesia(...)` calls will not appear until
 * the next active-scope change forces a re-render.
 */
export interface UseAmnesiaScopesResult {
    /** Currently active scope id. */
    activeScopeId: string;
    /**
     * Snapshot of registered scope ids in insertion order. Includes the
     * default scope only after it has been instantiated (lazy creation).
     */
    scopeIds: readonly string[];
    /** Clear past + future of every registered scope. */
    clearAll: () => void;
}

/**
 * Provider-level orchestration view. Use this when a component needs to
 * render the active-scope id (for breadcrumbs / labels) or trigger a
 * full-history reset across scopes (e.g. document switch).
 */
export function useAmnesiaScopes(): UseAmnesiaScopesResult {
    const api = useAmnesiaProviderApi();
    const activeScopeId = useSyncExternalStore(api.subscribeActive, api.getActiveScopeId, api.getActiveScopeId);
    const clearAll = useCallback(() => api.clearAll(), [api]);
    return {
        activeScopeId,
        scopeIds: api.getScopeIds(),
        clearAll,
    };
}
