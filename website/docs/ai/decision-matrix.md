---
sidebar_position: 3
title: Decision Matrix
description: Decision tables for hook choice, coalescing, capacity, persistence layering, and shortcut binding.
---

# Decision Matrix

Use these tables when the code is "almost obvious" but one wrong undo choice
would change user behavior after a Ctrl+Z.

## Single Scope vs Multi-Scope

| Need                                                                            | Approach                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Whole-app undo on a single document                                             | One `<AmnesiaProvider>`, default scope only — no `scopeId` anywhere needed     |
| Authoring app with several long-lived surfaces (canvas, property panel, etc.)   | One `<AmnesiaProvider>` with named scopes; `useAmnesiaFocusClaim` per surface  |
| Multiple documents open in tabs, each with its own history                      | One `<AmnesiaProvider key={documentId}>` per document; remount on switch       |
| Undoable component library distributed independently                            | Default scope is fine; consumer apps wrap in their own provider                |
| Modal / overlay that should temporarily steal Ctrl+Z                            | Mount its content with `useAmnesiaFocusClaim("modal")`; release on close       |

## Pin to a Scope vs Track the Active Scope

| Need                                                                            | Hook                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------ |
| Component is logically tied to one surface (canvas toolbar, props breadcrumb)   | `useAmnesia("canvas")` — pinned            |
| Component reflects "whatever the user is editing right now"                     | `useAmnesia()` — tracks active             |
| `useUndoableState` for a value that lives in a component                        | `{ scopeId: "..." }` — always pinned       |
| Keyboard shortcut binding for the whole window                                  | `<AmnesiaShortcuts />` — tracks active     |
| Region-scoped shortcut binding (canvas keyboard ops only)                       | `<AmnesiaShortcuts scopeId="canvas" target={canvasRef.current} />` |
| Reading the active scope id for breadcrumbs                                     | `useAmnesiaScopes().activeScopeId`         |

## `useUndoableState` vs `push` vs `useAmnesia`

| Need                                                           | API                                | Why                                                                  |
| -------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Single reversible value, replaces a `useState`                 | `useUndoableState(initial, opts)`  | Smallest call site; the hook owns redo and undo closures             |
| Mutating something the hook can't own (lists, graphs, canvas)  | `useAmnesia().push({ redo, undo })` | Full control over the inverse; pass `{ applied: true }` after mutate |
| Reading the stack for UI (history list, breadcrumb, badges)    | `useAmnesia()` snapshot            | Already memo-stable; no need to subscribe manually                   |
| Direct programmatic undo / redo (toolbar buttons, menu items)  | `useAmnesia().undo()` / `.redo()`  | Resolves to the affected entry id, or `null` when the stack was empty |

## Lifecycle Hooks vs Subscribers

| Need                                                                            | Approach                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Telemetry (analytics, audit log)                                                | Provider-level `onPush` / `onUndo` / `onRedo` / `onClear` |
| Driving UI state ("how many entries on the stack?")                             | `useAmnesia()` snapshot — subscribers, not hooks        |
| Per-scope analytics with different fields per surface                           | Per-scope override in `scopes={{ canvas: { onPush } }}` |
| Forward errors to a tracker                                                     | `onError` (existing) — not a lifecycle hook             |
| Redact secrets / PII before they leave the store                                | `metaTransform`                                         |
| Need to fire side effects synchronously with the mutation                       | NOT a hook — wrap the mutation; hooks are post-notify   |

## `transaction` vs Many `push`es

| Need                                                                            | Approach                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------- |
| One user action mutates several places; one Ctrl+Z should undo all of them      | `useAmnesia().transaction("Apply preset", ...)` |
| Each mutation should remain individually undoable                               | Several `push(...)` calls                       |
| Multi-step async work (call API, then update UI, then write to disk) atomic     | `transaction(async (tx) => { ... })`           |
| Handlers might fail; want all-or-nothing                                        | `transaction` — rollback runs on throw         |
| Want a "dry-run, then commit if happy" pattern                                  | `transaction` and throw to abort                |
| Just one mutation                                                               | Plain `push` — transaction would only add notify-pair overhead |

## `Command.do` vs `redo`-only

| Situation                                                                            | Recommendation                       |
| ------------------------------------------------------------------------------------ | ------------------------------------ |
| First-apply and re-apply share identical closures (the common case)                  | Omit `do`; rely on `redo` only       |
| First-apply mutates state in-place; re-apply restores by reference (e.g. inserting a freshly-created node vs. re-inserting it after undo) | Define both `do` and `redo`          |
| Caller already mutated state and just wants to record the inverse                    | `push(cmd, { applied: true })`; `do` is skipped |
| Need different telemetry on first-apply vs replay                                    | `do` for the original, `redo` for replays |
| Want to coalesce a burst into one entry                                              | `coalesceKey`; each push's `do` runs at its own push time, the merged entry stores the latest `redo` |

## Sync vs Async Command Handlers

| Need                                                                       | Recommendation                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Mutating local component state (the common case)                           | Sync `redo` / `undo`; subscribers see one notify per mutation        |
| Calling a server before committing (theme apply, server URL change)        | Async `redo` / `undo`; subscribers see `pending: true` during await  |
| `useUndoableState` setter                                                  | Stays sync-feeling — internal handlers are sync, no `pending` window |
| Need to coalesce rapid bursts                                              | Sync handlers — coalescing across async commands is fragile          |
| Mid-command another `push` arrives                                         | Second call resolves to `null`, fires `onError({ phase: "busy" })`   |
| `clear()` runs while an async command is awaiting                          | Command resolves to `null`, fires `onError({ phase: "stale" })`      |
| In-flight async command's own `redo` rejects                               | Promise rejects to caller; `onError({ phase: "push" })`; entry not added |
| `undo` / `redo` handler throws (sync or async)                             | Resolves to `null`; entry stays in place; `onError({ phase: "undo" \| "redo", recoverable: true })` |

## `coalesceKey` vs Separate Entries

| Situation                                              | Recommendation                              | Why                                                            |
| ------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------- |
| Each keystroke in a text field                         | Shared `coalesceKey: "edit:<field>"`        | A single Ctrl+Z reverts the whole burst                        |
| Slider drag updating a value 60 times per second       | Shared `coalesceKey: "drag:<control>"`      | Otherwise capacity is consumed by intermediate frames          |
| Discrete clicks (Add item, Delete item)                | No `coalesceKey`                            | Each action should be reversible on its own                    |
| Distinct fields edited in alternation                  | Different `coalesceKey` per field           | Coalescing is keyed; bursts on field A do not absorb field B   |
| Pause longer than `coalesceWindowMs` between keystrokes | Same `coalesceKey` but separate entries     | Time-based gap signals a logical pause                         |

## Capacity Choice

| Use case                                              | Recommended `capacity`               |
| ----------------------------------------------------- | ------------------------------------ |
| Casual UI (preferences, toggles)                      | Default (`100`)                      |
| Document editor with frequent typing and undo bursts  | `300` – `1000`                       |
| Canvas / drawing tool with high-frequency commands    | `1000`+, but rely on `coalesceKey`   |
| Audit log or compliance trail                         | Not appropriate — model separately   |

## Persisting Undoable State

| Need                                                           | Choose                                              | Result after reload                                  |
| -------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Reversible only within a session                               | `useUndoableState(...)`                             | Value resets, history starts empty                   |
| Value should survive reload, history may reset                 | `usePersistedUndoableState(...)`                    | Value persists via `react-mnemonic`, history empty   |
| Value persisted, but writes should not push undo entries       | `useMnemonicKey(...)` directly                      | Persistence-only path, no undo                       |
| Reversible bulk action that touches multiple persisted keys    | `useAmnesia().push(...)` + manual `useMnemonicKey`  | Caller controls the inverse for each persisted key   |

## `clear()` vs `undo()` All The Way Down

| Need                                                | Recommendation                       |
| --------------------------------------------------- | ------------------------------------ |
| Undo recent edit only                               | `undo()`                             |
| Undo to a known earlier checkpoint                  | Loop `undo()` while `canUndo`        |
| Document switch, route change, "open new file"      | `clear()` after switching state      |
| User pressed "Discard changes"                      | `clear()` after restoring saved state |
| Logout                                              | `clear()`; closures may capture user-scoped data |

## Keyboard Binding Surface

| Need                                                               | Recommendation                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| App-wide undo / redo                                               | One `<AmnesiaShortcuts />` inside the provider                       |
| Modal that owns its own undo                                       | `<AmnesiaShortcuts enabled={false} />` while the modal is open       |
| Custom Vim-style chord (e.g. `u` and `Ctrl+R`)                     | Skip `<AmnesiaShortcuts />`; call `useAmnesia().undo()` from your handler |
| Surface-scoped undo (canvas region only)                           | `<AmnesiaShortcuts target={canvasRef.current} skipEditableTargets={false} />` |
| Native `<input>` undo should keep working                          | Default — `skipEditableTargets` is `true`                            |

## Error Reporting Choice

| Need                                              | Configure                                              |
| ------------------------------------------------- | ------------------------------------------------------ |
| Default behavior (log via `console.error`)        | Omit `onError`                                         |
| Forward to error tracker (Sentry, Datadog, etc.)  | `onError={(error, ctx) => tracker.capture(error, ctx)}` |
| Silence noisy expected failures                   | `onError={(error, ctx) => { if (!isExpected(error)) defaultLog(error, ctx); }}` |
| Halt undo on first failure                        | Re-throw inside `onError` — but expect React to surface it |
