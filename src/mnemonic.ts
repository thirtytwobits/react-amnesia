// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Optional bridge between `react-amnesia` and `react-mnemonic`.
 *
 * The undo stack itself is intentionally **not** persisted — closures aren't
 * serializable, and replaying old commands against new application state is
 * usually wrong. Instead, this bridge persists the **value** of an undoable
 * piece of state via `react-mnemonic`, so reloads survive the data while the
 * undo history starts fresh on each session.
 *
 * Importing this module pulls in `react-mnemonic` as a peer dependency. If
 * you are not using persistence, import from `react-amnesia/core` instead
 * to keep the bundle lean.
 */

import { useCallback, useRef } from "react";
import { useMnemonicKey, type UseMnemonicKeyOptions } from "react-mnemonic";
import { useAmnesiaScope } from "./Amnesia/provider";
import { DEFAULT_SCOPE_ID } from "./Amnesia/provider-api";
import type { UndoableReset, UndoableSetter } from "./Amnesia/use-undoable-state";
import type { UseUndoableStateOptions } from "./Amnesia/types";

/**
 * Options for {@link usePersistedUndoableState}.
 *
 * Combines the persistence options accepted by `react-mnemonic`'s
 * `useMnemonicKey` with the history-aware metadata accepted by
 * `useUndoableState`.
 */
export type UsePersistedUndoableStateOptions<T> = UseMnemonicKeyOptions<T> & UseUndoableStateOptions<T>;

/**
 * Result of {@link usePersistedUndoableState}.
 *
 * `set` records each change as an undo entry.
 *
 * `reset(next?)` is **composite**: it clears the bound Amnesia scope's
 * history AND restores the persisted value via `react-mnemonic`. With no
 * argument it falls back to `mnemonic.reset()` (which writes the
 * `defaultValue` back to storage); with an explicit `next` it calls
 * `mnemonic.set(next)` instead. Either way the past + future stacks are
 * dropped — a reset is intentionally not undoable.
 *
 * `remove()` is also composite: it removes the persisted key entirely
 * (next read returns `defaultValue`) AND clears the bound Amnesia scope.
 * Stale undo entries that would try to restore a now-removed key are
 * dropped as part of the operation.
 */
export interface UsePersistedUndoableStateResult<T> {
    value: T;
    set: UndoableSetter<T>;
    reset: UndoableReset<T>;
    remove: () => void;
}

/**
 * Persisted, history-aware state. Reads and writes the value via
 * `react-mnemonic`, and records each user-initiated change as a command on
 * the surrounding `AmnesiaProvider`.
 *
 * Must be called inside both an `AmnesiaProvider` (for the history store)
 * and a `MnemonicProvider` (for persistence).
 *
 * @example
 * ```tsx
 * const { value: title, set } = usePersistedUndoableState("title", {
 *     defaultValue: "Untitled",
 *     label: "Edit title",
 *     coalesceKey: "edit:title",
 * });
 * ```
 */
export function usePersistedUndoableState<T>(
    key: string,
    options: UsePersistedUndoableStateOptions<T>,
): UsePersistedUndoableStateResult<T> {
    const { label, coalesceKey, equals, scopeId, ...mnemonicOptions } = options;
    // Pin to an explicit scope (default = "default") to keep the persisted
    // value's history bound to a stable surface, just like `useUndoableState`.
    const store = useAmnesiaScope(scopeId ?? DEFAULT_SCOPE_ID);
    const mnemonic = useMnemonicKey<T>(key, mnemonicOptions);

    const valueRef = useRef(mnemonic.value);
    valueRef.current = mnemonic.value;

    const metaRef = useRef({ label, coalesceKey, equals });
    metaRef.current = { label, coalesceKey, equals };

    const mnemonicSetRef = useRef(mnemonic.set);
    mnemonicSetRef.current = mnemonic.set;

    const mnemonicResetRef = useRef(mnemonic.reset);
    mnemonicResetRef.current = mnemonic.reset;

    const mnemonicRemoveRef = useRef(mnemonic.remove);
    mnemonicRemoveRef.current = mnemonic.remove;

    const set = useCallback<UndoableSetter<T>>(
        (next) => {
            const previous = valueRef.current;
            const resolved = typeof next === "function" ? (next as (current: T) => T)(previous) : next;
            const eq = metaRef.current.equals ?? Object.is;
            if (eq(previous, resolved)) return;

            valueRef.current = resolved;
            mnemonicSetRef.current(resolved);

            const meta = metaRef.current;
            void store.push(
                {
                    redo: () => {
                        valueRef.current = resolved;
                        mnemonicSetRef.current(resolved);
                    },
                    undo: () => {
                        valueRef.current = previous;
                        mnemonicSetRef.current(previous);
                    },
                    ...(meta.label !== undefined ? { label: meta.label } : {}),
                    ...(meta.coalesceKey !== undefined ? { coalesceKey: meta.coalesceKey } : {}),
                },
                { applied: true },
            );
        },
        [store],
    );

    const reset = useCallback<UndoableReset<T>>(
        (next) => {
            // Clear the history scope first so an intermediate stale undo
            // cannot race with the value rewrite.
            store.clear();
            if (next === undefined) {
                mnemonicResetRef.current();
                return;
            }
            const resolved = typeof next === "function" ? (next as () => T)() : next;
            valueRef.current = resolved;
            mnemonicSetRef.current(resolved);
        },
        [store],
    );

    const remove = useCallback<() => void>(() => {
        store.clear();
        mnemonicRemoveRef.current();
    }, [store]);

    return { value: mnemonic.value, set, reset, remove };
}
