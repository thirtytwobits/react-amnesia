// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview `useUndoableState` — a `useState`-like hook that records
 * every change as an undoable command on the surrounding Amnesia store.
 */

import { useCallback, useRef, useState } from "react";
import { useAmnesiaScope } from "./provider";
import { DEFAULT_SCOPE_ID } from "./provider-api";
import type { UseUndoableStateOptions } from "./types";

/**
 * Setter accepted by `useUndoableState`. Mirrors the React `useState`
 * setter shape, including the functional-updater form.
 */
export type UndoableSetter<T> = (next: T | ((current: T) => T)) => void;

/**
 * History-aware analogue of `useState`. Each call to the setter pushes a
 * `redo`/`undo` pair onto the surrounding Amnesia store so Ctrl+Z restores
 * the previous value.
 *
 * The hook owns the underlying React state, so undo/redo work entirely
 * through this hook's setter — no external store required. The setter
 * reference is stable across renders.
 *
 * @example
 * ```tsx
 * const [title, setTitle] = useUndoableState("Untitled", {
 *     label: "Edit title",
 *     coalesceKey: "edit:title",
 * });
 * ```
 */
export function useUndoableState<T>(
    initial: T | (() => T),
    options: UseUndoableStateOptions<T> = {},
): [T, UndoableSetter<T>] {
    // Pin to an explicit scope (default = "default") rather than tracking
    // the active scope. React state lives in this component instance, so
    // the history surface it belongs to is a stable property — not driven
    // by keyboard focus.
    const store = useAmnesiaScope(options.scopeId ?? DEFAULT_SCOPE_ID);
    const [value, setValue] = useState<T>(initial);

    // Refs let the setter stay stable while still seeing the latest value
    // and the latest options (label, coalesceKey, equals).
    const valueRef = useRef(value);
    valueRef.current = value;

    const optionsRef = useRef(options);
    optionsRef.current = options;

    const set = useCallback<UndoableSetter<T>>(
        (next) => {
            const previous = valueRef.current;
            const resolved = typeof next === "function" ? (next as (current: T) => T)(previous) : next;
            const equals = optionsRef.current.equals ?? Object.is;
            if (equals(previous, resolved)) return;

            valueRef.current = resolved;
            setValue(resolved);

            const opts = optionsRef.current;
            // `useUndoableState` is a synchronous-feeling abstraction: the
            // setter does not return the Promise that `store.push(...)` now
            // produces. Sync handlers take the store's fast path so the
            // returned Promise resolves before the next microtask, with no
            // observable `pending: true` window.
            void store.push(
                {
                    redo: () => {
                        valueRef.current = resolved;
                        setValue(resolved);
                    },
                    undo: () => {
                        valueRef.current = previous;
                        setValue(previous);
                    },
                    ...(opts.label !== undefined ? { label: opts.label } : {}),
                    ...(opts.coalesceKey !== undefined ? { coalesceKey: opts.coalesceKey } : {}),
                },
                { applied: true },
            );
        },
        [store],
    );

    return [value, set];
}
