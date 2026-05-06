---
sidebar_position: 2
title: Invariants
description: Deterministic runtime guarantees for provider scope, push, undo, redo, coalescing, capacity, and error handling.
---

# Invariants

This page is the shortest authoritative statement of what `react-amnesia`
guarantees.

## Supported React Versions

- React `^18.0.0 || ^19.0.0`. The full test suite runs under React 18.3 and React 19.2.
- Component tests are wrapped in `<StrictMode>` by default, so every component path exercises React's dev double-mount cycle.
- `AmnesiaProvider` does not auto-dispose its store on unmount. This is intentional: auto-dispose conflicts with StrictMode's simulated effect cleanup. Call `store.dispose()` manually when sharing a store with non-React code.

## Core Runtime Invariants

- `useAmnesia(...)`, `useUndoableState(...)`, `useAmnesiaFocusClaim(...)`, `useAmnesiaScopes(...)`, and `<AmnesiaShortcuts />` must run inside an `AmnesiaProvider`.
- The history store is in-memory only. Closures are never serialized and the stack does not survive a reload.
- `Command.redo` and `Command.undo` are required and may be synchronous or return a `Promise<void>`.
- `Command.do` is optional. When present, it runs once at push time instead of `redo`; it is consumed there and never stored on the entry.
- `push` / `amend` / `undo` / `redo` always return `Promise<number | null>`. Synchronous handlers resolve in the same microtask with no observable `pending: true` window.
- `push(command)` invokes `command.do ?? command.redo` exactly once on insertion unless `{ applied: true }` is passed.
- `push(...)` always clears the future (redo) stack. No branching is supported in v0.
- `amend(patch)` updates only the last past entry. Omitted fields preserve previous values; default behavior keeps the previous `undo` and replaces only what the patch supplies.
- `undo()` pops the most recent past entry, calls its `undo()`, and pushes it onto the future stack. Resolves to the entry id, or `null` when the past stack is empty.
- `redo()` pops the most recent future entry, calls its `redo()`, and pushes it onto the past stack. Resolves to the entry id, or `null` when the future stack is empty.
- `clear()` is synchronous. It drops both stacks, bumps `epoch`, empties the pending set, and notifies subscribers exactly once.
- `dispose()` is synchronous and idempotent. It bumps `epoch`, clears state, and disconnects listeners. `AmnesiaProvider` does **not** call it automatically — consumers who share a store with non-React code may invoke it themselves.
- Snapshots are referentially stable until the next mutation. `getSnapshot()` returns the same reference for identical state.
- Snapshots and their `past` and `future` arrays are frozen with `Object.freeze`. Consumers cannot mutate them.
- Synchronous mutations notify subscribers exactly once. Asynchronous mutations notify twice: once when the await begins (`pending: true`) and once on commit (`pending: false`). A stale-dropped op (epoch mismatch) does not notify; `clear()` already did.
- The listener list is snapshotted before dispatch, so callbacks added or removed during a notify cycle do not affect the current tick.
- Capacity defaults to `100` and is clamped to a minimum of `1`. When exceeded, the oldest past entry is dropped silently on the next push. Eviction happens at commit, not at schedule.
- Scope-level `coalesceWindowMs` defaults to `400` and is clamped to a minimum of `0`. Coalescing timestamps are taken at commit. Coalescing across async commands is supported but fragile — recommend against it.
- Two consecutive pushes coalesce when they share the same non-empty `coalesceKey` and the second arrives within the effective coalescing window. Window resolution is per push: `command.coalesceWindowMs` (when defined) overrides the scope value; `Number.POSITIVE_INFINITY` removes the time bound; `<= 0` disables coalescing for that push; non-finite values other than `+Infinity` do not coalesce. The merged entry keeps the earlier `undo` and the latest `redo` so a single undo reverts the whole burst. Each push's `do` is invoked at its own push time; the merged entry never stores a `do`.
- A throwing `redo()` or `undo()` leaves the entry in place and surfaces via `onError({ phase: "undo" | "redo", recoverable: true })`. The application is responsible for retry or recovery.
- Concurrent operations while `pending === true` resolve to `null` and surface as `onError({ phase: "busy" })`. The store is single-flight.
- An async op whose `await` outlasts a `clear()` or `dispose()` resolves to `null` and surfaces as `onError({ phase: "stale" })`. State has already been cleared by the racing call.
- `onError` invocations are deferred until `pendingTokens` is empty so a handler that calls `push` / `undo` / `redo` re-entrantly always sees a quiescent store.
- The default `onError` handler logs to `console.error` with the prefix `[Amnesia]`. A custom handler that itself throws is caught and ignored.
- Provider options (`capacity`, `coalesceWindowMs`, `onError`) are read once at mount. Subsequent prop changes are ignored. Remount the provider with a `key` to apply new settings.

## Cancellation (AbortSignal)

- Every `Command` handler (`do`, `redo`, `undo`) and every `transaction` `work` function receives an `AbortSignal` as its (first / second) argument.
- One `AbortController` is created per operation. The signal is **aborted** when `clear()` or `dispose()` runs on that scope while the operation is in flight.
- Sibling operations on the same scope don't share signals; each gets its own controller.
- Nested transactions share the outer transaction's signal — they flatten into the same buffer, so a single cancellation propagates through nested work.
- Synchronous handlers receive a signal too, but it is never aborted before they return.
- Handler treatment of cancellation:
    - **Honored**: handler observes `signal.aborted` and rejects (any error). The op resolves to `null`, no entry is committed, no `onError` fires. This is the silent path.
    - **Ignored**: handler completes normally despite the abort. The epoch check still drops the commit, and `onError({ phase: "stale", recoverable: false })` fires.
    - **Real failure** (signal not aborted): handler throws. Same behavior as before — `onError` with the appropriate phase, `push` rejects to caller, `undo` / `redo` leave the entry in place.
- Transaction rollback uses a fresh `AbortSignal` (the original was already aborted), so buffered undos can do their own cleanup work even during a cancellation.
- The composite entry's `redo` and `undo` (built from a transaction) propagate their caller's signal to every buffered handler in the order they were pushed (redo) or reverse order (undo).

## DevTools Registry

- `<AmnesiaProvider enableDevTools>` lazily installs `window.__REACT_AMNESIA_DEVTOOLS__` on first mount and registers the provider's inspection api under `devToolsId` (auto-generated `amnesia-N` if omitted).
- When no provider sets `enableDevTools`, the registry is never created — no global, no overhead.
- Registry shape:
    - `providers: Record<id, AmnesiaDevToolsProviderEntry>`
    - `resolve(id) -> AmnesiaDevToolsProviderApi | null` (returns `null` for GC'd or unregistered providers)
    - `list() -> AmnesiaDevToolsProviderDescriptor[]` (id, available, registeredAt)
    - `capabilities -> { weakRef, finalizationRegistry }`
    - `__meta -> { version, lastUpdated, lastChange }` (bumps on every register / unregister)
- Provider entries are stored as `WeakRef`s when available; `deref()` returns the live api or `undefined`. A strong-reference fallback keeps the registry usable on runtimes without `WeakRef`.
- The provider's inspection api exposes `id`, `getActiveScopeId()`, `scopes()`, `getSnapshot(scopeId?)`, `pastSnapshot(scopeId?)`, `futureSnapshot(scopeId?)`, `dump()`, `triggerUndo(scopeId?)`, `triggerRedo(scopeId?)`, `clear(scopeId?)`. Methods that take an optional `scopeId` resolve to the active scope when omitted.
- Triggers (`triggerUndo`, `triggerRedo`) are async and obey the same single-flight / busy / stale rules as direct store calls.
- The provider's `useEffect` re-registers under the same id across StrictMode's simulated cleanup-then-setup cycle. External listeners may observe a brief gap; `__meta.version` records each transition.

## Reset Semantics

- `useUndoableState` returns `[value, set, reset]`. The reset reference is stable across renders.
- `reset(next?)` resolves the new value as: `next` (or `next()` for a factory) when supplied, otherwise the value captured on first render. Strict-mode double-invocation does not change the captured initial — it is set once via `useState`'s initializer contract.
- `reset` calls `store.clear()` on the bound scope FIRST, then writes the resolved value. The clear bumps `epoch` so any in-flight async op stales out cleanly; the rewrite lands in the same microtask.
- `reset` does not push an entry. It is intentionally not undoable — the wipe is the point.
- `useUndoableState` clears the **entire scope**, not just the value owned by this hook. Sibling hooks and imperative `useAmnesia(scopeId).push(...)` calls in the same scope are also dropped.
- `usePersistedUndoableState`'s `reset(next?)` is composite: scope clear THEN either `mnemonic.reset()` (no arg) or `mnemonic.set(next)` (with arg). The persistence layer's defaultValue is whatever was passed to `useMnemonicKey`.
- `usePersistedUndoableState`'s `remove()` is composite: scope clear THEN `mnemonic.remove()` (deletes the key from storage; subsequent reads return `defaultValue`).

## Lifecycle Hooks

- Provider options accept `onPush(entry, scopeId)`, `onAmend(entry, scopeId)`, `onUndo(entry, scopeId)`, `onRedo(entry, scopeId)`, `onClear(scopeId)`. Per-scope overrides via `scopes={{ x: { onPush } }}` win over provider-level handlers.
- The store-level shape (`AmnesiaStoreOptions`) takes the scopeId-free form: `onPush(entry)`, `onAmend(entry)`, `onUndo(entry)`, `onRedo(entry)`, `onClear()`. The provider api binds scopeId before forwarding.
- Hook events are queued during a mutation and dispatched from `notify()` after subscribers fire. They never run before the snapshot is updated.
- A re-entrancy guard prevents a hook that calls `push` / `undo` / `redo` from causing nested drains: the inner mutation queues its own hook event, and the outer drain picks it up.
- `onPush` fires exactly once per logical user action: never on coalesce-merge, never on rollback, exactly once per transaction commit.
- `onAmend` fires once per successful amend.
- `onClear` fires only when `clear()` actually mutated state. Empty/no-op clears do not fire. Provider-level `clear()` (no arg) fires `onClear` once for each scope that was non-empty.
- A hook that throws is caught and ignored; the rest of the queue still drains. `metaTransform` failures also do not poison the store — the failing entry's `meta` is stripped before the hook sees it.
- `metaTransform(meta)` runs every time `meta` is exposed: in the public snapshot's `past` / `future` entries AND in hook payloads. Returning `undefined` strips `meta` from the public form.

## Transactions

- `transaction(label?, work)` is per-scope. The store is single-flight while the transaction runs; concurrent `push` / `undo` / `redo` from outside the work function hit `phase: "busy"` and resolve to `null`.
- `tx.push(command)` invokes `command.do ?? command.redo` synchronously (or awaits if it returns a Promise) and appends `command.redo` and `command.undo` to the buffer. The composite entry stores `redo` (not `do`) for replay.
- The composite's `redo` runs every buffered `redo` in original order; its `undo` runs every buffered `undo` in **reverse** order. Both await async handlers.
- Sync `work` commits with a single notify (no observable `pending: true`). Async `work` notifies twice: at await-start and at commit / rollback / stale-resolution.
- A synchronous throw from `work` rolls back synchronously then re-throws. An asynchronous rejection rolls back asynchronously then re-throws. `clear()` / `dispose()` during the await rolls back and resolves to `null` with `phase: "stale"`.
- Per-buffered-undo failures during rollback fire `phase: "rollback"` errors, one per failure. The original `work` rejection (when applicable) still propagates to the caller.
- `tx.push` and `tx.label` throw synchronously when called after the surrounding `transaction(...)` resolves.
- Nested `transaction(...)` calls flatten: the inner call's `label` is ignored, its `work` runs against the outer's buffer, and it resolves to `null` immediately when its own work completes. There is no separate nested commit.
- The composite entry's `coalesceKey` is undefined; it never coalesces with neighbors. Individual `tx.push` calls do not coalesce within the buffer either.
- `transaction(...)` on a disposed store resolves to `null` without invoking `work`.
- `transaction(label)` with no `work` function rejects synchronously with a `TypeError`.

## Multi-Scope Routing

- A provider owns a `Map<scopeId, Amnesia>`. Named scopes are created lazily on first reference. The reserved `"default"` scope is created on first reference like any other.
- Scopes are isolated: each has its own past, future, version, epoch, pending set, capacity, and coalesce window. Cross-scope undo / redo is not possible.
- **All hooks bound to the same scopeId share that scope's stack.** Multiple `useUndoableState`, `usePersistedUndoableState`, and imperative `useAmnesia(scopeId).push(...)` calls in the same scope all push entries onto one ordered history. A single Ctrl+Z pops the most recent entry regardless of which hook produced it. This is the default behavior — no explicit coordination needed: omit `scopeId` everywhere and they all share `"default"`.
- The provider tracks at most one **focused-child claim** at a time. `claim(scopeId)` sets it; `claim("default")` clears it; `release(scopeId)` clears it only if `scopeId` currently holds it.
- The active scope is `claim ?? "default"`. `getActiveScopeId()` reads it; `subscribeActive(listener)` notifies on every change.
- Per-scope option overrides on the provider's `scopes` prop are read at scope-creation time and frozen thereafter. Updating the prop after a scope exists has no effect.
- `useUndoableState` and `usePersistedUndoableState` pin to an explicit `scopeId` (default `"default"`). They do not track the active claim — React state lives in stable component instances and should not migrate scopes when focus moves.
- `useAmnesia(scopeId?)` does the opposite: with no arg it tracks the active claim; with an arg it pins.
- `<AmnesiaShortcuts />` resolves the target scope at handler time so live focus claims always route the chord without a re-render. `<AmnesiaShortcuts scopeId="..." />` pins.
- `useAmnesiaFocusClaim(scopeId)` returns capture-phase focus / pointer-down handlers. On the component's unmount it releases its claim if it was active.
- `clear(scopeId?)` on the provider api (and `useAmnesiaScopes().clear`) iterates every registered scope when called with no argument. With a `scopeId` argument it clears only that scope (lazily creating it if needed). The per-scope store's own `clear()` (e.g. via `useAmnesia(scopeId).clear()`) clears just its own stacks and takes no argument.

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
3. If `options.applied` is not `true`, invoke `command.do ?? command.redo`. A synchronous throw is scheduled as `onError({ phase: "push" })` and re-thrown to the caller; the entry is not added.
4. If the invoked handler returned a Promise, notify subscribers (so `pending: true` is observable), then `await` it. A rejection schedules `onError({ phase: "push" })` and re-throws.
5. After resume, if the store's `epoch` has changed (a `clear()` or `dispose()` raced the await), schedule `onError({ phase: "stale" })` and resolve to `null` without committing.
6. Read the most recent past entry. If it shares a non-empty `coalesceKey` with the new command, resolve the effective coalescing window for this push (`command.coalesceWindowMs` override or scope default), then coalesce only when the effective rule allows it and the elapsed wall-clock time is within bounds. On coalesce, replace with a merged entry (latest `redo`, original `undo`, latest label / coalesceKey / meta) and clear the future stack.
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

## Exact Amend Lifecycle

`amend(patch)` follows this order:

1. If the store is disposed, resolve to `null`.
2. If `pendingTokens` is non-empty, schedule `onError({ phase: "busy" })` and resolve to `null`.
3. Read the last past entry. If none exists, resolve to `null`.
4. Replace only fields present in `patch` (`redo`, `undo`, `label`, `meta`), preserve the rest, keep the same entry id, and keep the original `pushedAt`.
5. Replace the last past entry with the amended entry, clear future, increment `version`, rebuild snapshot, and notify subscribers.

## Keyboard Shortcut Boundaries

`<AmnesiaShortcuts />` is the only built-in keyboard binding. Its contract is:

- Mounts a `keydown` listener on `target`. Defaults to `window`. Accepts an `HTMLElement | Document | Window | "document" | "window" | null`. The string forms `"document"` / `"window"` resolve inside `useEffect`, so they are SSR-safe. `target === null` attaches no listener.
- Bindings: `Ctrl+Z` / `Cmd+Z` for undo; `Ctrl+Shift+Z`, `Cmd+Shift+Z`, and `Ctrl+Y` for redo.
- Ignores any keydown whose `event.defaultPrevented === true` — an upstream handler has already claimed the chord.
- Ignores any keydown with `event.altKey === true`. Alt-modified chords are intentionally separate from Undo / Redo.
- When `skipEditableTargets` is `true` (default), chords are ignored when `event.composedPath()` contains an `<input>`, `<textarea>`, `<select>`, or `contenteditable` element. The composed-path walk is **shadow-DOM transparent**: editables inside open shadow roots are recognized even though `event.target` has been retargeted to the host. Falls back to `event.target` only when `composedPath` is unavailable.
- When `preventDefault` is `true` (default), `event.preventDefault()` is called whenever the chord matches and shortcuts are not skipped — regardless of whether an entry exists to undo / redo. This is required because async `undo` / `redo` cannot synchronously decide whether to suppress the browser's native chord.
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
