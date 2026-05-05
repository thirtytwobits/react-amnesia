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
import type { Amnesia, AmnesiaErrorHandler, AmnesiaProviderOptions, AmnesiaStoreOptions, HistoryEntry } from "./types";

/** Reserved id for the implicit default scope. */
export const DEFAULT_SCOPE_ID = "default";

/**
 * Per-scope option overrides. Each entry merges over the provider-level
 * default at scope-creation time (lazy). Settings are frozen once a scope
 * is first accessed.
 */
export interface ScopeOptions {
    capacity?: number;
    coalesceWindowMs?: number;
    onError?: AmnesiaErrorHandler;
    onPush?: (entry: HistoryEntry, scopeId: string) => void;
    onUndo?: (entry: HistoryEntry, scopeId: string) => void;
    onRedo?: (entry: HistoryEntry, scopeId: string) => void;
    onClear?: (scopeId: string) => void;
    metaTransform?: (meta: Record<string, unknown>) => Record<string, unknown> | undefined;
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

    /**
     * Synchronously clear past + future. With no argument, every registered
     * scope is cleared. With a `scopeId`, only that scope is cleared (lazily
     * creating it if it does not yet exist, so a subsequent `getScope` call
     * sees a consistent empty store).
     */
    clear: (scopeId?: string) => void;
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

    /**
     * Build the store-level options for a scope. Merges scope override over
     * the provider-level default, then binds every scopeId-aware hook so
     * the underlying store sees plain `(entry) => void` / `() => void`
     * signatures.
     */
    const buildOptionsFor = (scopeId: string): AmnesiaStoreOptions => {
        const override = scopeOverrides?.[scopeId];

        const merged: AmnesiaStoreOptions = {};

        const capacity = override?.capacity !== undefined ? override.capacity : providerDefaults.capacity;
        if (capacity !== undefined) merged.capacity = capacity;

        const coalesceWindowMs =
            override?.coalesceWindowMs !== undefined ? override.coalesceWindowMs : providerDefaults.coalesceWindowMs;
        if (coalesceWindowMs !== undefined) merged.coalesceWindowMs = coalesceWindowMs;

        const onError = override?.onError !== undefined ? override.onError : providerDefaults.onError;
        if (onError !== undefined) merged.onError = onError;

        const onPush = override?.onPush !== undefined ? override.onPush : providerDefaults.onPush;
        if (onPush !== undefined) {
            const bound = onPush;
            merged.onPush = (entry: HistoryEntry) => bound(entry, scopeId);
        }

        const onUndo = override?.onUndo !== undefined ? override.onUndo : providerDefaults.onUndo;
        if (onUndo !== undefined) {
            const bound = onUndo;
            merged.onUndo = (entry: HistoryEntry) => bound(entry, scopeId);
        }

        const onRedo = override?.onRedo !== undefined ? override.onRedo : providerDefaults.onRedo;
        if (onRedo !== undefined) {
            const bound = onRedo;
            merged.onRedo = (entry: HistoryEntry) => bound(entry, scopeId);
        }

        const onClear = override?.onClear !== undefined ? override.onClear : providerDefaults.onClear;
        if (onClear !== undefined) {
            const bound = onClear;
            merged.onClear = () => bound(scopeId);
        }

        const metaTransform =
            override?.metaTransform !== undefined ? override.metaTransform : providerDefaults.metaTransform;
        if (metaTransform !== undefined) merged.metaTransform = metaTransform;

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

    const clear = (scopeId?: string): void => {
        if (scopeId === undefined) {
            for (const store of stores.values()) {
                store.clear();
            }
            return;
        }
        getScope(scopeId).clear();
    };

    return {
        getScope,
        getScopeIds,
        getActiveScopeId,
        subscribeActive,
        claim,
        release,
        clear,
    };
}
