// SPDX-License-Identifier: MIT
// Copyright Scott Dixon

/**
 * @fileoverview Public entrypoint for the Amnesia core runtime.
 *
 * `react-amnesia/core` exposes the provider, hooks, and types needed to
 * implement application-level undo/redo. It does not depend on
 * `react-mnemonic`. For the persistence-aware bridge, import from
 * `react-amnesia/mnemonic`.
 */

export {
    AmnesiaProvider,
    useAmnesiaProviderApi,
    useAmnesiaProviderApiOptional,
    useAmnesiaScope,
    useAmnesiaScopeOptional,
} from "./Amnesia/provider";
export type { AmnesiaProviderProps } from "./Amnesia/provider";
export { DEFAULT_SCOPE_ID } from "./Amnesia/provider-api";
export type { AmnesiaProviderApi, ScopeOptions } from "./Amnesia/provider-api";
export {
    DEVTOOLS_GLOBAL_KEY,
    generateDevToolsId,
    getDevToolsRegistry,
    registerDevToolsProvider,
} from "./Amnesia/devtools";
export type {
    AmnesiaDevToolsCapabilities,
    AmnesiaDevToolsMeta,
    AmnesiaDevToolsProviderApi,
    AmnesiaDevToolsProviderDescriptor,
    AmnesiaDevToolsProviderEntry,
    AmnesiaDevToolsRegistry,
    AmnesiaDevToolsWeakRef,
} from "./Amnesia/devtools";
export { useAmnesia } from "./Amnesia/use";
export type { UseAmnesiaResult } from "./Amnesia/use";
export { useAmnesiaLabels } from "./Amnesia/use-labels";
export type { AmnesiaLabels } from "./Amnesia/use-labels";
export { useUndoableState } from "./Amnesia/use-undoable-state";
export type { UndoableReset, UndoableSetter } from "./Amnesia/use-undoable-state";
export { useAmnesiaFocusClaim, useAmnesiaScopes } from "./Amnesia/use-scopes";
export type { AmnesiaFocusClaimHandlers, UseAmnesiaScopesResult } from "./Amnesia/use-scopes";
export { AmnesiaShortcuts } from "./Amnesia/shortcuts";
export type { AmnesiaShortcutsProps, AmnesiaShortcutsTarget } from "./Amnesia/shortcuts";
export { createAmnesiaStore } from "./Amnesia/history";
export type {
    AmendPatch,
    Amnesia,
    AmnesiaErrorContext,
    AmnesiaErrorHandler,
    AmnesiaProviderOptions,
    AmnesiaState,
    AmnesiaStoreOptions,
    Command,
    HistoryEntry,
    PushOptions,
    TransactionApi,
    UseUndoableStateOptions,
} from "./Amnesia/types";
