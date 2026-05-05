// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Public React hook for interacting with the Amnesia store.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useAmnesiaProviderApi, useAmnesiaStore } from "./provider";
import type { Amnesia, AmnesiaState, Command, PushOptions } from "./types";

/**
 * Hook returning the current Amnesia state plus stable action callbacks.
 *
 * The returned object is reconstructed on every store mutation but the
 * action functions (`push`, `undo`, `redo`, `clear`) remain referentially
 * stable across renders, so they can be used in `useEffect` deps without
 * causing re-runs.
 *
 * The result also carries `scopeId` so consumers can render which scope a
 * snapshot describes (useful for "Undo (canvas)" toolbar labels).
 */
export interface UseAmnesiaResult extends AmnesiaState {
    /** The scope id this snapshot is bound to. */
    scopeId: string;
    /** Push a new command. See {@link Amnesia.push}. */
    push: (command: Command, options?: PushOptions) => Promise<number | null>;
    /** Undo the most recent past entry. See {@link Amnesia.undo}. */
    undo: () => Promise<number | null>;
    /** Redo the most recent future entry. See {@link Amnesia.redo}. */
    redo: () => Promise<number | null>;
    /** Drop both stacks of this scope. See {@link Amnesia.clear}. */
    clear: () => void;
}

/**
 * Subscribe to the Amnesia store and receive both state and actions.
 *
 * - `useAmnesia()` (no arg) — tracks the currently active scope and
 *   re-renders both when its state changes and when the active scope id
 *   itself changes (via focus claims). Use this when the component should
 *   reflect "whatever the user is editing right now."
 * - `useAmnesia("canvas")` — pins to a specific scope. Re-renders only on
 *   that scope's state changes. Use this when the component is logically
 *   tied to a specific surface (a canvas toolbar, a property-panel
 *   breadcrumb, etc.).
 *
 * Must be called inside an `AmnesiaProvider`.
 */
export function useAmnesia(scopeId?: string): UseAmnesiaResult {
    const api = useAmnesiaProviderApi();
    const store = useAmnesiaStore(scopeId);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    const push = useCallback<Amnesia["push"]>((command, options) => store.push(command, options), [store]);
    const undo = useCallback<Amnesia["undo"]>(() => store.undo(), [store]);
    const redo = useCallback<Amnesia["redo"]>(() => store.redo(), [store]);
    const clear = useCallback<Amnesia["clear"]>(() => store.clear(), [store]);

    // Resolve the scope id we're currently bound to. When `scopeId` is
    // omitted the store may be the active scope's; in that case we need to
    // surface the active-scope id so consumers can render it.
    const resolvedScopeId = scopeId ?? api.getActiveScopeId();

    return {
        scopeId: resolvedScopeId,
        past: state.past,
        future: state.future,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        version: state.version,
        epoch: state.epoch,
        pending: state.pending,
        push,
        undo,
        redo,
        clear,
    };
}
