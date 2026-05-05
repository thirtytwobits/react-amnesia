---
sidebar_position: 2
title: Invariants
description: Deterministic runtime guarantees for provider scope, push, undo, redo, coalescing, capacity, and error handling.
---

# Invariants

This page is the shortest authoritative statement of what `react-amnesia`
guarantees.

## Core Runtime Invariants

- `useAmnesia(...)`, `useUndoableState(...)`, and `<AmnesiaShortcuts />` must run inside an `AmnesiaProvider`.
- The history store is in-memory only. Closures are never serialized and the stack does not survive a reload.
- `Command.redo` and `Command.undo` may be synchronous or return a `Promise<void>`.
- `push` / `undo` / `redo` always return `Promise<number | null>`. Synchronous handlers resolve in the same microtask with no observable `pending: true` window.
- `push(command)` calls `command.redo()` exactly once on insertion unless `{ applied: true }` is passed.
- `push(...)` always clears the future (redo) stack. No branching is supported in v0.
- `undo()` pops the most recent past entry, calls its `undo()`, and pushes it onto the future stack. Resolves to the entry id, or `null` when the past stack is empty.
- `redo()` pops the most recent future entry, calls its `redo()`, and pushes it onto the past stack. Resolves to the entry id, or `null` when the future stack is empty.
- `clear()` is synchronous. It drops both stacks, bumps `epoch`, empties the pending set, and notifies subscribers exactly once.
- `dispose()` is synchronous and idempotent. It bumps `epoch`, clears state, and disconnects listeners. `AmnesiaProvider` does **not** call it automatically — consumers who share a store with non-React code may invoke it themselves.
- Snapshots are referentially stable until the next mutation. `getSnapshot()` returns the same reference for identical state.
- Snapshots and their `past` and `future` arrays are frozen with `Object.freeze`. Consumers cannot mutate them.
- Synchronous mutations notify subscribers exactly once. Asynchronous mutations notify twice: once when the await begins (`pending: true`) and once on commit (`pending: false`). A stale-dropped op (epoch mismatch) does not notify; `clear()` already did.
- The listener list is snapshotted before dispatch, so callbacks added or removed during a notify cycle do not affect the current tick.
- Capacity defaults to `100` and is clamped to a minimum of `1`. When exceeded, the oldest past entry is dropped silently on the next push. Eviction happens at commit, not at schedule.
- `coalesceWindowMs` defaults to `400` and is clamped to a minimum of `0`. Coalescing timestamps are taken at commit. Coalescing across async commands is supported but fragile — recommend against it.
- Two consecutive pushes coalesce when they share the same non-empty `coalesceKey` and the second arrives within `coalesceWindowMs` of the first. The merged entry keeps the earlier `undo` and the latest `redo` so a single undo reverts the whole burst.
- A throwing `redo()` or `undo()` leaves the entry in place and surfaces via `onError({ phase: "undo" | "redo", recoverable: true })`. The application is responsible for retry or recovery.
- Concurrent operations while `pending === true` resolve to `null` and surface as `onError({ phase: "busy" })`. The store is single-flight.
- An async op whose `await` outlasts a `clear()` or `dispose()` resolves to `null` and surfaces as `onError({ phase: "stale" })`. State has already been cleared by the racing call.
- `onError` invocations are deferred until `pendingTokens` is empty so a handler that calls `push` / `undo` / `redo` re-entrantly always sees a quiescent store.
- The default `onError` handler logs to `console.error` with the prefix `[Amnesia]`. A custom handler that itself throws is caught and ignored.
- Provider options (`capacity`, `coalesceWindowMs`, `onError`) are read once at mount. Subsequent prop changes are ignored. Remount the provider with a `key` to apply new settings.

## Type Sourcing Rules

- Import values from `react-amnesia` (or `react-amnesia/core` / `react-amnesia/mnemonic`), not internal package paths.
- Import exported types from `react-amnesia` with `import type`.
- Do not create local `react-amnesia.d.ts` files.
- Do not write `declare module "react-amnesia"` in consumer code.
- If a type seems missing, check `src/index.ts`, `src/core.ts`, `src/mnemonic.ts`, `package.json`, and the API docs before inventing a replacement contract.

## Exact Push Lifecycle

`push(command, options?)` follows this order:

1. If the store is disposed, resolve to `null`.
2. If `pendingTokens` is non-empty (another op is in flight), schedule `onError({ phase: "busy" })` and resolve to `null`.
3. If `options.applied` is not `true`, invoke `command.redo()`. A synchronous throw is scheduled as `onError({ phase: "push" })` and re-thrown to the caller; the entry is not added.
4. If `command.redo()` returned a Promise, notify subscribers (so `pending: true` is observable), then `await` it. A rejection schedules `onError({ phase: "push" })` and re-throws.
5. After resume, if the store's `epoch` has changed (a `clear()` or `dispose()` raced the await), schedule `onError({ phase: "stale" })` and resolve to `null` without committing.
6. Read the most recent past entry. If it shares a non-empty `coalesceKey` with the new command and the elapsed wall-clock time at commit is within `coalesceWindowMs`, replace it with a merged entry (latest `redo`, original `undo`, latest label / coalesceKey / meta) and clear the future stack.
7. Otherwise, append a new entry with a fresh monotonic id. If the past stack now exceeds `capacity`, drop the oldest entry. Clear the future stack.
8. Increment `version`, remove the pending token, rebuild the frozen snapshot, and notify subscribers. Drain any deferred `onError` calls now that `pendingTokens` is empty.

## Exact Undo / Redo Lifecycle

`undo()` follows this order:

1. If the store is disposed, resolve to `null`.
2. If `pendingTokens` is non-empty, schedule `onError({ phase: "busy" })` and resolve to `null`.
3. Read the last past entry. If none exists, resolve to `null` without notifying.
4. Call the entry's `undo()`. If it returned a Promise, notify (`pending: true`), then `await`.
5. A throw schedules `onError({ phase: "undo", recoverable: true })`, leaves the entry in place, and resolves to `null`.
6. After resume, if `epoch` changed, schedule `onError({ phase: "stale" })` and resolve to `null`.
7. On success, pop the entry from past and append it to future. Increment `version`, remove the pending token, rebuild the snapshot, and notify subscribers. Drain any deferred `onError` calls.

`redo()` follows the symmetric order against the future stack with `phase: "redo"`.

## Keyboard Shortcut Boundaries

`<AmnesiaShortcuts />` is the only built-in keyboard binding. Its contract is:

- Mounts a `keydown` listener on `target` (defaults to `window`). When `target === null`, no listener is attached.
- Bindings: `Ctrl+Z` / `Cmd+Z` for undo; `Ctrl+Shift+Z`, `Cmd+Shift+Z`, and `Ctrl+Y` for redo.
- When `skipEditableTargets` is `true` (default), chords whose `event.target` is an `<input>`, `<textarea>`, `<select>`, or `contenteditable` element are ignored so the browser's native undo handles them.
- When `preventDefault` is `true` (default), `event.preventDefault()` is called only after a successful undo or redo.
- When `enabled` is `false`, the listener is detached. Toggle this rather than unmounting the component if a modal needs to own the chord temporarily.

## Persistence Bridge Boundaries

The optional `react-amnesia/mnemonic` entrypoint is a thin layer over both
libraries. Its contract is:

- `usePersistedUndoableState(key, options)` calls `useMnemonicKey<T>(key, mnemonicOptions)` for the value path and pushes one command per change for the history path.
- `set(...)` always writes through the `react-mnemonic` setter and then pushes a command with `{ applied: true }`.
- `reset()` and `remove()` from the returned object pass straight through to `react-mnemonic` and **bypass the undo stack**. Wrap them with `useAmnesia().push(...)` if your app needs them reversible.
- The undo stack itself is not persisted. On reload the value is recovered from `react-mnemonic` and the history starts empty.

## Source Files

- [`src/Amnesia/history.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/history.ts)
- [`src/Amnesia/provider.tsx`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/provider.tsx)
- [`src/Amnesia/use.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/use.ts)
- [`src/Amnesia/use-undoable-state.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/use-undoable-state.ts)
- [`src/Amnesia/shortcuts.tsx`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/shortcuts.tsx)
- [`src/Amnesia/types.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/types.ts)
- [`src/mnemonic.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/mnemonic.ts)
