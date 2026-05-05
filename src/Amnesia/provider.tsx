// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview React context provider for the Amnesia undo/redo store.
 *
 * Wrap your application (or the subtree that owns a single document) in
 * `<AmnesiaProvider>`. The provider owns a multi-scope orchestration object
 * (`AmnesiaProviderApi`) that lazily creates an independent `Amnesia` store
 * for each named scope. Components inside can then call:
 *
 * - `useAmnesia()` / `useAmnesia(scopeId)` for state + actions
 * - `useUndoableState(...)` for history-aware single-value state
 * - `useAmnesiaFocusClaim(scopeId)` to mark a focusable surface as the
 *   active scope while it owns focus
 * - `useAmnesiaScopes()` for provider-level orchestration
 */

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type JSX, type ReactNode } from "react";
import {
    createAmnesiaProviderApi,
    DEFAULT_SCOPE_ID,
    type AmnesiaProviderApi,
    type ScopeOptions,
} from "./provider-api";
import { generateDevToolsId, registerDevToolsProvider, type AmnesiaDevToolsProviderApi } from "./devtools";
import type { Amnesia, AmnesiaProviderOptions } from "./types";

const AmnesiaContext = createContext<AmnesiaProviderApi | null>(null);

const noopSubscribe = (): (() => void) => () => undefined;

/**
 * Props for `AmnesiaProvider`. Extends {@link AmnesiaProviderOptions}.
 */
export interface AmnesiaProviderProps extends Readonly<AmnesiaProviderOptions> {
    /** Child tree that should share this history store. */
    children: ReactNode;

    /**
     * Use a pre-built store as the default scope's backing instance instead
     * of letting the provider create one. Other scopes are still created
     * lazily on demand.
     *
     * Useful for tests and for sharing a store with non-React code (e.g. a
     * canvas controller). When supplied, this store keeps its capacity /
     * coalesce settings.
     */
    store?: Amnesia;

    /**
     * Per-scope option overrides keyed by scope id. Each entry merges over
     * the provider-level defaults at scope-creation time. Settings are
     * frozen once a scope is first accessed.
     *
     * @example
     * ```tsx
     * <AmnesiaProvider scopes={{ canvas: { capacity: 1000 } }}>
     *     ...
     * </AmnesiaProvider>
     * ```
     */
    scopes?: Record<string, ScopeOptions>;

    /**
     * Register the provider with the global devtools registry under
     * `window.__REACT_AMNESIA_DEVTOOLS__`. Off by default; opt in for
     * debugging, browser-extension integration, or AI-agent introspection.
     *
     * The registry is **lazy-installed**: when no provider sets
     * `enableDevTools={true}` anywhere in the tree, no global is created.
     */
    enableDevTools?: boolean;

    /**
     * Stable id under which to register with the devtools registry. When
     * omitted, an auto-generated `amnesia-N` id is assigned on first mount
     * and reused across re-renders. Pin a known id if you want external
     * tooling to find the provider by name.
     */
    devToolsId?: string;
}

/**
 * Provides an Amnesia history orchestration api to descendants.
 *
 * The api is created once on mount. Provider-level options are read at
 * scope-creation time (lazy); changing the prop after a scope has been
 * created has no effect. Remount the provider with a `key` to reset.
 */
export function AmnesiaProvider(props: AmnesiaProviderProps): JSX.Element {
    const { children, store: providedStore, capacity, coalesceWindowMs, onError, scopes, enableDevTools, devToolsId } =
        props;

    // Lazy ref so the api is created exactly once per component instance,
    // including under React 18 StrictMode (which double-invokes effect
    // cleanups in dev).
    const apiRef = useRef<AmnesiaProviderApi | null>(null);
    if (apiRef.current === null) {
        apiRef.current = createAmnesiaProviderApi({
            ...(providedStore !== undefined ? { defaultStore: providedStore } : {}),
            ...(capacity !== undefined ? { capacity } : {}),
            ...(coalesceWindowMs !== undefined ? { coalesceWindowMs } : {}),
            ...(onError !== undefined ? { onError } : {}),
            ...(scopes !== undefined ? { scopes } : {}),
        });
    }
    const api = apiRef.current;

    // Generated devtools id sticks across re-renders. The user may pin a
    // specific id via the prop; we honor that. Generated only when needed.
    const generatedIdRef = useRef<string | null>(null);
    const resolvedDevToolsId =
        devToolsId ?? (generatedIdRef.current ?? (generatedIdRef.current = generateDevToolsId()));

    useEffect(() => {
        if (!enableDevTools) return undefined;
        const devToolsApi: AmnesiaDevToolsProviderApi = {
            id: resolvedDevToolsId,
            getActiveScopeId: () => api.getActiveScopeId(),
            scopes: () => api.getScopeIds(),
            getSnapshot: (scopeId) => api.getScope(scopeId ?? api.getActiveScopeId()).getSnapshot(),
            pastSnapshot: (scopeId) => api.getScope(scopeId ?? api.getActiveScopeId()).getSnapshot().past,
            futureSnapshot: (scopeId) => api.getScope(scopeId ?? api.getActiveScopeId()).getSnapshot().future,
            dump: () => {
                const out: Record<string, ReturnType<Amnesia["getSnapshot"]>> = {};
                for (const id of api.getScopeIds()) {
                    out[id] = api.getScope(id).getSnapshot();
                }
                return out;
            },
            triggerUndo: (scopeId) => api.getScope(scopeId ?? api.getActiveScopeId()).undo(),
            triggerRedo: (scopeId) => api.getScope(scopeId ?? api.getActiveScopeId()).redo(),
            clear: (scopeId) => api.clear(scopeId),
        };
        return registerDevToolsProvider(devToolsApi);
    }, [api, enableDevTools, resolvedDevToolsId]);

    return <AmnesiaContext.Provider value={api}>{children}</AmnesiaContext.Provider>;
}

/**
 * Internal hook returning the provider api, throwing when called outside a
 * provider.
 */
export function useAmnesiaProviderApi(): AmnesiaProviderApi {
    const ctx = useContext(AmnesiaContext);
    if (!ctx) {
        throw new Error("useAmnesia must be used within an AmnesiaProvider");
    }
    return ctx;
}

/**
 * Returns the api when one is mounted; otherwise `null`. Use this when a
 * reusable component should silently degrade outside a provider.
 */
export function useAmnesiaProviderApiOptional(): AmnesiaProviderApi | null {
    return useContext(AmnesiaContext);
}

/**
 * Resolve an `Amnesia` store from the provider api. With an explicit
 * `scopeId`, pins to that scope and never re-renders on active-scope
 * changes. Without one, tracks the current active scope and re-renders
 * when it changes.
 */
export function useAmnesiaScope(scopeId?: string): Amnesia {
    const api = useAmnesiaProviderApi();
    const subscribe = scopeId !== undefined ? noopSubscribe : api.subscribeActive;
    const getSnapshot = useMemo(() => {
        if (scopeId !== undefined) return () => scopeId;
        return api.getActiveScopeId;
    }, [api, scopeId]);
    const resolvedId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return api.getScope(resolvedId);
}

/**
 * Returns the active-scope-tracking store when a provider is mounted;
 * otherwise `null`.
 */
export function useAmnesiaScopeOptional(): Amnesia | null {
    const api = useAmnesiaProviderApiOptional();
    const subscribe = api?.subscribeActive ?? noopSubscribe;
    const getSnapshot = useMemo(() => {
        if (!api) return () => DEFAULT_SCOPE_ID;
        return api.getActiveScopeId;
    }, [api]);
    const resolvedId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return api ? api.getScope(resolvedId) : null;
}
