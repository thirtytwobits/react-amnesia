---
sidebar_position: 3
title: Decision Matrix
description: Decision tables for hook choice, coalescing, capacity, persistence layering, and shortcut binding.
---

# Decision Matrix

Use these tables when the code is "almost obvious" but one wrong undo choice
would change user behavior after a Ctrl+Z.

## `useUndoableState` vs `push` vs `useAmnesia`

| Need                                                           | API                                | Why                                                                  |
| -------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Single reversible value, replaces a `useState`                 | `useUndoableState(initial, opts)`  | Smallest call site; the hook owns redo and undo closures             |
| Mutating something the hook can't own (lists, graphs, canvas)  | `useAmnesia().push({ redo, undo })` | Full control over the inverse; pass `{ applied: true }` after mutate |
| Reading the stack for UI (history list, breadcrumb, badges)    | `useAmnesia()` snapshot            | Already memo-stable; no need to subscribe manually                   |
| Direct programmatic undo / redo (toolbar buttons, menu items)  | `useAmnesia().undo()` / `.redo()`  | Resolves to the affected entry id, or `null` when the stack was empty |

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
