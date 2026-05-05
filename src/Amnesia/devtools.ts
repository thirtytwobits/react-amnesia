// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview DevTools registry for Amnesia providers.
 *
 * When a provider is mounted with `enableDevTools`, it registers a weakly
 * held entry in `window.__REACT_AMNESIA_DEVTOOLS__`. External tooling
 * (browser extensions, CLIs, AI agents) can resolve a provider by id and
 * call its API to inspect history, trigger undo/redo, or dump scope state
 * without touching application code.
 *
 * The registry is **opt-in** at the provider level. Apps that never set
 * `enableDevTools={true}` never trigger the lazy install, so no global is
 * created and the registry-side machinery stays cold.
 */

import type { AmnesiaState, HistoryEntry } from "./types";

/**
 * The global key under which the registry lives.
 *
 * Matches the documented contract for browser extensions and external
 * tools — do not rename without bumping the major version.
 */
export const DEVTOOLS_GLOBAL_KEY = "__REACT_AMNESIA_DEVTOOLS__" as const;

/**
 * Inspection api exposed by each registered provider.
 */
export interface AmnesiaDevToolsProviderApi {
    /** Stable id under which the provider is registered. */
    id: string;
    /** The scope id currently receiving keyboard shortcuts. */
    getActiveScopeId: () => string;
    /** Snapshot of the registered scope ids. */
    scopes: () => readonly string[];
    /**
     * Read a scope's snapshot. With no argument, returns the active scope's
     * snapshot.
     */
    getSnapshot: (scopeId?: string) => AmnesiaState;
    /** Convenience: just the past entries for `scopeId` (active by default). */
    pastSnapshot: (scopeId?: string) => readonly HistoryEntry[];
    /** Convenience: just the future entries for `scopeId` (active by default). */
    futureSnapshot: (scopeId?: string) => readonly HistoryEntry[];
    /** Snapshot every registered scope keyed by id. */
    dump: () => Record<string, AmnesiaState>;
    /** Trigger `undo()` on `scopeId` (active by default). Returns the entry id, or `null`. */
    triggerUndo: (scopeId?: string) => Promise<number | null>;
    /** Trigger `redo()` on `scopeId` (active by default). */
    triggerRedo: (scopeId?: string) => Promise<number | null>;
    /** Clear `scopeId`, or every scope when omitted. */
    clear: (scopeId?: string) => void;
}

/**
 * Weak-ref holder used by registry entries. Defined as a structural type so
 * the runtime can fall back to a strong-ref shim when `WeakRef` is missing.
 */
export interface AmnesiaDevToolsWeakRef<T extends object> {
    deref: () => T | undefined;
}

/**
 * Internal registry entry. One per registered provider.
 */
export interface AmnesiaDevToolsProviderEntry {
    id: string;
    weakRef: AmnesiaDevToolsWeakRef<AmnesiaDevToolsProviderApi>;
    registeredAt: number;
}

/**
 * Lightweight provider summary returned by `list()`.
 */
export interface AmnesiaDevToolsProviderDescriptor {
    id: string;
    available: boolean;
    registeredAt: number;
}

/**
 * Runtime capabilities reported by the registry.
 */
export interface AmnesiaDevToolsCapabilities {
    weakRef: boolean;
    finalizationRegistry: boolean;
}

/**
 * Polling metadata for extension synchronization. Bumped on every
 * register / unregister event.
 */
export interface AmnesiaDevToolsMeta {
    version: number;
    lastUpdated: number;
    lastChange: string;
}

/**
 * Global registry contract. Available via
 * `window.__REACT_AMNESIA_DEVTOOLS__` whenever at least one provider has
 * been registered.
 */
export interface AmnesiaDevToolsRegistry {
    /** All known provider entries keyed by id. */
    providers: Record<string, AmnesiaDevToolsProviderEntry>;
    /**
     * Resolve a provider by id. Returns the live api or `null` if the
     * provider has been GC'd or unregistered.
     */
    resolve: (id: string) => AmnesiaDevToolsProviderApi | null;
    /** List provider availability without strengthening weak references manually. */
    list: () => AmnesiaDevToolsProviderDescriptor[];
    capabilities: AmnesiaDevToolsCapabilities;
    __meta: AmnesiaDevToolsMeta;
}

interface DevToolsHost {
    [DEVTOOLS_GLOBAL_KEY]?: AmnesiaDevToolsRegistry;
}

function getHost(): DevToolsHost | null {
    if (typeof globalThis === "undefined") return null;
    return globalThis as unknown as DevToolsHost;
}

function buildCapabilities(): AmnesiaDevToolsCapabilities {
    return {
        weakRef: typeof WeakRef !== "undefined",
        finalizationRegistry: typeof FinalizationRegistry !== "undefined",
    };
}

function bumpMeta(registry: AmnesiaDevToolsRegistry, change: string): void {
    registry.__meta.version += 1;
    registry.__meta.lastUpdated = Date.now();
    registry.__meta.lastChange = change;
}

/**
 * Lazy-install the global registry. Idempotent — repeated calls return
 * the existing instance.
 *
 * Returns `null` only when no global object is reachable (which should not
 * happen in any modern runtime).
 */
export function getDevToolsRegistry(): AmnesiaDevToolsRegistry | null {
    const host = getHost();
    if (!host) return null;
    const existing = host[DEVTOOLS_GLOBAL_KEY];
    if (existing) return existing;
    const registry: AmnesiaDevToolsRegistry = {
        providers: {},
        resolve(id) {
            const entry = registry.providers[id];
            if (!entry) return null;
            return entry.weakRef.deref() ?? null;
        },
        list() {
            return Object.values(registry.providers).map((entry) => ({
                id: entry.id,
                available: entry.weakRef.deref() !== undefined,
                registeredAt: entry.registeredAt,
            }));
        },
        capabilities: buildCapabilities(),
        __meta: {
            version: 0,
            lastUpdated: Date.now(),
            lastChange: "init",
        },
    };
    host[DEVTOOLS_GLOBAL_KEY] = registry;
    return registry;
}

/**
 * Build a weak-ref holder for `value`. Falls back to a strong reference
 * when `WeakRef` is not available — devtools entries never leak app data
 * directly because they only hold the inspection api object, which is a
 * thin facade over the real provider.
 */
function buildWeakRef<T extends object>(value: T): AmnesiaDevToolsWeakRef<T> {
    if (typeof WeakRef !== "undefined") {
        return new WeakRef(value);
    }
    return { deref: () => value };
}

let nextGeneratedId = 1;

/**
 * Generate a fresh id for a provider that did not declare its own.
 *
 * Ids are namespaced (`amnesia-N`) and monotonic within the process.
 */
export function generateDevToolsId(): string {
    return `amnesia-${nextGeneratedId++}`;
}

/**
 * Register a provider's inspection api with the global registry.
 *
 * Returns an unregister function. Calling the unregister fn after the
 * provider has already been replaced (e.g. by a re-register with the same
 * id) is a no-op.
 */
export function registerDevToolsProvider(api: AmnesiaDevToolsProviderApi): () => void {
    const registry = getDevToolsRegistry();
    if (!registry) return () => undefined;
    const entry: AmnesiaDevToolsProviderEntry = {
        id: api.id,
        weakRef: buildWeakRef(api),
        registeredAt: Date.now(),
    };
    registry.providers[api.id] = entry;
    bumpMeta(registry, `register:${api.id}`);
    return () => {
        if (registry.providers[api.id] === entry) {
            delete registry.providers[api.id];
            bumpMeta(registry, `unregister:${api.id}`);
        }
    };
}
