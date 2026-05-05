// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Multi-scope orchestration for `AmnesiaProvider`.
 *
 * A provider owns a map of named scopes; each scope is an independent
 * `Amnesia` store with its own past / future / version / capacity / coalesce
 * window. Scopes are created lazily on first reference. The implicit
 * `"default"` scope is created on demand when no other scope is requested.
 *
 * The api also tracks an "active child" claim — the scope that should
 * receive keyboard shortcuts when no caller pins them explicitly. The claim
 * stack is collapsed to a single most-recently-claimed pointer, matching
 * primrosehill's `UndoRouter` model: at most one focused-child override
 * shadows the default at any time.
 */

import { createAmnesiaStore } from "./history";
import type { Amnesia, AmnesiaErrorHandler, AmnesiaProviderOptions } from "./types";

/** Reserved id for the implicit default scope. */
export const DEFAULT_SCOPE_ID = "default";

/**
 * Per-scope option overrides. Only `capacity`, `coalesceWindowMs`, and
 * `onError` are honored; provider-level defaults fill in the rest.
 */
export interface ScopeOptions {
    capacity?: number;
    coalesceWindowMs?: number;
    onError?: AmnesiaErrorHandler;
}

export interface AmnesiaProviderApiOptions extends AmnesiaProviderOptions {
    /**
     * When supplied, this `Amnesia` instance is bound to the default scope.
     * Other scopes are still created lazily.
     */
    defaultStore?: Amnesia;

    /**
     * Per-scope option overrides keyed by scope id. Each entry merges over
     * the provider-level defaults at scope-creation time.
     */
    scopes?: Record<string, ScopeOptions>;
}

/**
 * Multi-scope orchestration object exposed via React Context. Application
 * code should prefer the React hooks (`useAmnesia`, `useAmnesiaFocusClaim`,
 * `useAmnesiaScopes`) instead of consuming this directly.
 */
export interface AmnesiaProviderApi {
    /** Look up a scope by id, lazily creating it on first request. */
    getScope: (scopeId: string) => Amnesia;

    /**
     * Snapshot of the currently registered scope ids in insertion order.
     * Returns a fresh array on each call. There is no subscription path for
     * scope-set changes in this release.
     */
    getScopeIds: () => readonly string[];

    /**
     * Currently active scope id. When no claim is held, returns the default
     * scope id.
     */
    getActiveScopeId: () => string;

    /** Subscribe to active-scope changes. */
    subscribeActive: (listener: () => void) => () => void;

    /**
     * Mark `scopeId` as the active claimant. Lazily creates the scope. Pass
     * the default scope id to clear an existing claim.
     */
    claim: (scopeId: string) => void;

    /**
     * If `scopeId` is the active claimant, drop the claim and fall back to
     * default. No-op otherwise.
     */
    release: (scopeId: string) => void;

    /** Synchronously clear past + future of every registered scope. */
    clearAll: () => void;
}

/**
 * Build a new provider api. Called once per `AmnesiaProvider` instance.
 */
export function createAmnesiaProviderApi(options: AmnesiaProviderApiOptions = {}): AmnesiaProviderApi {
    const { defaultStore, scopes: scopeOverrides, ...providerDefaults } = options;

    const stores = new Map<string, Amnesia>();
    const activeListeners = new Set<() => void>();
    let activeChild: string | undefined;

    if (defaultStore) {
        stores.set(DEFAULT_SCOPE_ID, defaultStore);
    }

    const buildOptionsFor = (scopeId: string): AmnesiaProviderOptions => {
        const merged: AmnesiaProviderOptions = {};
        if (providerDefaults.capacity !== undefined) merged.capacity = providerDefaults.capacity;
        if (providerDefaults.coalesceWindowMs !== undefined) merged.coalesceWindowMs = providerDefaults.coalesceWindowMs;
        if (providerDefaults.onError !== undefined) merged.onError = providerDefaults.onError;
        const override = scopeOverrides?.[scopeId];
        if (override) {
            if (override.capacity !== undefined) merged.capacity = override.capacity;
            if (override.coalesceWindowMs !== undefined) merged.coalesceWindowMs = override.coalesceWindowMs;
            if (override.onError !== undefined) merged.onError = override.onError;
        }
        return merged;
    };

    const getScope = (scopeId: string): Amnesia => {
        const existing = stores.get(scopeId);
        if (existing) return existing;
        const created = createAmnesiaStore(buildOptionsFor(scopeId));
        stores.set(scopeId, created);
        return created;
    };

    const getScopeIds = (): readonly string[] => Array.from(stores.keys());

    const getActiveScopeId = (): string => activeChild ?? DEFAULT_SCOPE_ID;

    const notifyActiveChange = (): void => {
        // Snapshot listeners so a callback that subscribes/unsubscribes
        // during dispatch does not affect the current tick.
        const dispatch = Array.from(activeListeners);
        for (const listener of dispatch) {
            try {
                listener();
            } catch {
                // Subscriber failures are isolated.
            }
        }
    };

    const claim = (scopeId: string): void => {
        if (scopeId === DEFAULT_SCOPE_ID) {
            // Claiming the default is equivalent to clearing the child claim.
            if (activeChild === undefined) return;
            activeChild = undefined;
            notifyActiveChange();
            return;
        }
        if (scopeId === activeChild) return;
        // Lazy-create so a hook that returns from `getScope(scopeId)` later
        // sees a consistent store.
        getScope(scopeId);
        activeChild = scopeId;
        notifyActiveChange();
    };

    const release = (scopeId: string): void => {
        if (scopeId === DEFAULT_SCOPE_ID) return;
        if (activeChild !== scopeId) return;
        activeChild = undefined;
        notifyActiveChange();
    };

    const subscribeActive = (listener: () => void): (() => void) => {
        activeListeners.add(listener);
        return () => {
            activeListeners.delete(listener);
        };
    };

    const clearAll = (): void => {
        for (const store of stores.values()) {
            store.clear();
        }
    };

    return {
        getScope,
        getScopeIds,
        getActiveScopeId,
        subscribeActive,
        claim,
        release,
        clearAll,
    };
}
