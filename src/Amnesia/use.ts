// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Public React hook for interacting with the Amnesia store.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useAmnesiaStore } from "./provider";
import type { Amnesia, AmnesiaState, Command, PushOptions } from "./types";

/**
 * Hook returning the current Amnesia state plus stable action callbacks.
 *
 * The returned object is reconstructed on every store mutation but the
 * action functions (`push`, `undo`, `redo`, `clear`) remain referentially
 * stable across renders, so they can be used in `useEffect` deps without
 * causing re-runs.
 */
export interface UseAmnesiaResult extends AmnesiaState {
    /** Push a new command. See {@link Amnesia.push}. */
    push: (command: Command, options?: PushOptions) => Promise<number | null>;
    /** Undo the most recent past entry. See {@link Amnesia.undo}. */
    undo: () => Promise<number | null>;
    /** Redo the most recent future entry. See {@link Amnesia.redo}. */
    redo: () => Promise<number | null>;
    /** Drop both stacks. See {@link Amnesia.clear}. */
    clear: () => void;
}

/**
 * Subscribe to the Amnesia store and receive both state and actions.
 *
 * Must be called inside an `AmnesiaProvider`.
 */
export function useAmnesia(): UseAmnesiaResult {
    const store = useAmnesiaStore();
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    const push = useCallback<Amnesia["push"]>((command, options) => store.push(command, options), [store]);
    const undo = useCallback<Amnesia["undo"]>(() => store.undo(), [store]);
    const redo = useCallback<Amnesia["redo"]>(() => store.redo(), [store]);
    const clear = useCallback<Amnesia["clear"]>(() => store.clear(), [store]);

    return {
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
