// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview React context provider for the Amnesia undo/redo store.
 *
 * Wrap your application (or the subtree that owns a single document/scope)
 * in `<AmnesiaProvider>`. Components inside can then call `useAmnesia()` to
 * push commands and trigger undo/redo, or `useUndoableState()` to manage
 * history-aware state.
 */

import { createContext, useContext, useRef, type ReactNode } from "react";
import { createAmnesiaStore } from "./history";
import type { Amnesia, AmnesiaProviderOptions } from "./types";

const AmnesiaContext = createContext<Amnesia | null>(null);

/**
 * Props for `AmnesiaProvider`. Extends {@link AmnesiaProviderOptions}.
 */
export interface AmnesiaProviderProps extends Readonly<AmnesiaProviderOptions> {
    /** Child tree that should share this history store. */
    children: ReactNode;

    /**
     * Use a pre-built store instead of letting the provider create one.
     *
     * Useful for tests and for sharing a store with non-React code (e.g. a
     * canvas controller). When supplied, all other options are ignored — the
     * existing store keeps its capacity / coalesce settings.
     */
    store?: Amnesia;
}

/**
 * Provides an Amnesia history store to descendants.
 *
 * The store is created once on mount. Changes to `capacity`, `coalesceWindowMs`,
 * or `onError` are intentionally ignored after initial mount so the in-flight
 * history is not silently rebuilt with different rules; remount the provider
 * with a `key` to reset.
 */
export function AmnesiaProvider(props: AmnesiaProviderProps): JSX.Element {
    const { children, store: providedStore, capacity, coalesceWindowMs, onError } = props;

    // Lazy ref so the store is created exactly once per component instance,
    // including under React 18 StrictMode (which double-invokes effect
    // cleanups in dev).
    const storeRef = useRef<Amnesia | null>(null);
    if (storeRef.current === null) {
        if (providedStore) {
            storeRef.current = providedStore;
        } else {
            const opts: AmnesiaProviderOptions = {};
            if (capacity !== undefined) opts.capacity = capacity;
            if (coalesceWindowMs !== undefined) opts.coalesceWindowMs = coalesceWindowMs;
            if (onError !== undefined) opts.onError = onError;
            storeRef.current = createAmnesiaStore(opts);
        }
    }

    // Note: we intentionally do not auto-dispose the store on unmount.
    // React 18 StrictMode dev double-invokes effect cleanups, which would
    // dispose a still-rendered store. The store will be GC'd along with the
    // provider. Consumers who share a store with non-React code (passing it
    // via the `store` prop) can call `store.dispose()` themselves when
    // tearing the React tree down.

    return <AmnesiaContext.Provider value={storeRef.current}>{children}</AmnesiaContext.Provider>;
}

/**
 * Internal hook returning the raw store, throwing when called outside a
 * provider.
 */
export function useAmnesiaStore(): Amnesia {
    const ctx = useContext(AmnesiaContext);
    if (!ctx) {
        throw new Error("useAmnesia must be used within an AmnesiaProvider");
    }
    return ctx;
}

/**
 * Returns the store when one is mounted; otherwise `null`. Use this when a
 * reusable component should silently degrade outside a provider.
 */
export function useAmnesiaStoreOptional(): Amnesia | null {
    return useContext(AmnesiaContext);
}
