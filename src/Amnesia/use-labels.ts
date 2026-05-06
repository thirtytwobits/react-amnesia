// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Selector-style hook for undo/redo menu and toolbar labels.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAmnesiaProviderApi, useAmnesiaScope } from "./provider";
import type { AmnesiaState } from "./types";

/**
 * Compact label-oriented view of a scope's undo/redo state.
 *
 * Intended for menu/toolbar bindings that only need enablement + labels and
 * should not re-render on unrelated snapshot changes (for example `version`
 * bumps that keep labels unchanged).
 */
export interface AmnesiaLabels {
    /** Whether Undo should be enabled for this scope right now. */
    canUndo: boolean;
    /** Whether Redo should be enabled for this scope right now. */
    canRedo: boolean;
    /** `"Undo"` or `"Undo {entry label}"` when a labeled entry exists. */
    undoLabel: string;
    /** `"Redo"` or `"Redo {entry label}"` when a labeled entry exists. */
    redoLabel: string;
    /** Mirrors store pending state for disabling controls during async ops. */
    pending: boolean;
    /** Scope id this selector is currently bound to. */
    scopeId: string;
}

function formatActionLabel(action: "Undo" | "Redo", label: string | undefined): string {
    const trimmed = label?.trim();
    return trimmed ? `${action} ${trimmed}` : action;
}

function selectLabels(state: AmnesiaState, scopeId: string): AmnesiaLabels {
    const undoTop = state.past[state.past.length - 1];
    const redoTop = state.future[state.future.length - 1];
    const pending = state.pending;

    return {
        canUndo: state.past.length > 0 && !pending,
        canRedo: state.future.length > 0 && !pending,
        undoLabel: formatActionLabel("Undo", undoTop?.label),
        redoLabel: formatActionLabel("Redo", redoTop?.label),
        pending,
        scopeId,
    };
}

function sameLabels(a: AmnesiaLabels, b: AmnesiaLabels): boolean {
    return (
        a.canUndo === b.canUndo &&
        a.canRedo === b.canRedo &&
        a.undoLabel === b.undoLabel &&
        a.redoLabel === b.redoLabel &&
        a.pending === b.pending &&
        a.scopeId === b.scopeId
    );
}

/**
 * Selector-style snapshot for menu / toolbar bindings.
 *
 * Scope resolution semantics match {@link useAmnesia}:
 * - `useAmnesiaLabels()` tracks the currently active scope.
 * - `useAmnesiaLabels("canvas")` pins to a specific scope.
 *
 * The returned object is referentially stable when none of its fields change.
 */
export function useAmnesiaLabels(scopeId?: string): AmnesiaLabels {
    const api = useAmnesiaProviderApi();
    const store = useAmnesiaScope(scopeId);
    const resolvedScopeId = scopeId ?? api.getActiveScopeId();
    const cacheRef = useRef<AmnesiaLabels | null>(null);

    const getSnapshot = useCallback((): AmnesiaLabels => {
        const next = selectLabels(store.getSnapshot(), resolvedScopeId);
        const cached = cacheRef.current;
        if (cached && sameLabels(cached, next)) return cached;
        cacheRef.current = next;
        return next;
    }, [resolvedScopeId, store]);

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
