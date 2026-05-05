---
sidebar_position: 1
title: AI Overview
description: Canonical entry point for coding assistants and advanced users working with react-amnesia.
---

# AI Overview

This section is the authoritative, high-signal contract for humans and coding
assistants using `react-amnesia`.

Use it when you need:

- application undo/redo semantics without reading the whole repo
- a reliable rule for `push`, `undo`, `redo`, `clear`, and coalescing
- the shortest correct explanation of capacity, error handling, and keyboard binding
- guidance for combining `react-amnesia` with `react-mnemonic` for persisted-yet-undoable state
- copy-pastable patterns that stay aligned with the public API

## Quick Start

The minimum correct shape is: mount an `AmnesiaProvider` above every component
that calls `useAmnesia(...)`, `useUndoableState(...)`, or
`usePersistedUndoableState(...)`. Render exactly one `<AmnesiaShortcuts />` per
provider for keyboard bindings.

```tsx
// main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { AmnesiaProvider, AmnesiaShortcuts } from "react-amnesia";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AmnesiaProvider capacity={200}>
            <AmnesiaShortcuts />
            <App />
        </AmnesiaProvider>
    </React.StrictMode>,
);
```

Any descendant of `App` can now call `useUndoableState(...)` for reversible
single-value state, `useAmnesia()` for direct access to the history store, or
`push({ redo, undo, label })` for imperative commands.

## Start Here

Read these pages in order when context is tight:

1. [Invariants](./ai/invariants)
2. [Decision Matrix](./ai/decision-matrix)
3. [Recipes](./ai/recipes)
4. [Anti-Patterns](./ai/anti-patterns)
5. [AI Assistant Setup](./ai/assistant-setup)

## Quick Rules

- React 18 or 19 are supported peers (`^18.0.0 || ^19.0.0`); both are exercised in CI under `<StrictMode>`.
- `useAmnesia(...)`, `useUndoableState(...)`, `useAmnesiaFocusClaim(...)`, `useAmnesiaScopes(...)`, and `<AmnesiaShortcuts />` must run inside an `AmnesiaProvider`.
- `usePersistedUndoableState(...)` from `react-amnesia/mnemonic` must run inside both an `AmnesiaProvider` and a `MnemonicProvider`.
- A provider owns multiple **scopes**, each an independent `Amnesia` store. The implicit `"default"` scope exists; named scopes are created lazily on first reference.
- `useAmnesia()` (no arg) tracks the currently active scope and re-renders when active changes. `useAmnesia("canvas")` pins to a named scope.
- `useUndoableState(initial, { scopeId })` and `usePersistedUndoableState(...)` pin to a named scope (default `"default"`); they do **not** float to the active claim.
- `useAmnesiaFocusClaim(scopeId)` returns capture-phase focus / pointer-down handlers that mark a surface as the active claimant. The handlers go on a focusable container element.
- At most one focused-child claim is held at a time. The most recently claimed scope wins; on claim-component unmount, the active falls back to default if the unmounting component held the claim.
- `<AmnesiaShortcuts />` routes Ctrl+Z / Cmd+Z to the active scope by default. Pin with `<AmnesiaShortcuts scopeId="canvas" />` to ignore claim changes.
- `<AmnesiaShortcuts />` calls `event.preventDefault()` whenever the chord matches outside an editable target — even when there is nothing to undo. This is required because async `undo` / `redo` cannot synchronously decide whether the browser's native handler should run.
- Per-scope option overrides go on the provider: `<AmnesiaProvider scopes={{ canvas: { capacity: 1000 } }}>`. Settings are read at scope-creation time (lazy).
- `useAmnesiaScopes()` returns `{ activeScopeId, scopeIds, clear(scopeId?) }` for provider-level UI (breadcrumbs, document-switch reset). `clear()` with no arg clears every scope; `clear("canvas")` clears one.
- The undo stack is **in-memory only**. Closures are not serialized and the history does not survive a reload.
- To survive reloads, persist the underlying value (e.g. via `react-mnemonic`) and let the history start fresh per session.
- `Command.redo` and `Command.undo` may be synchronous or return `Promise<void>`. `push` / `undo` / `redo` always return `Promise<number | null>`.
- `push({ redo, undo, label })` calls `redo()` once on insertion. Pass `{ applied: true }` when the call site has already mutated state.
- `Command.do` is optional. When supplied, it runs once at push time instead of `redo` and is **not stored** on the entry — every subsequent redo invokes `command.redo`. Use `do` when first-apply requires setup that re-apply does not.
- `useAmnesia(scopeId?).transaction(label?, work)` collapses N pushes into one composite entry. `tx.push(command)` runs `command.do ?? command.redo` immediately and buffers `command.redo` / `command.undo`. On commit the past stack gains exactly one composite entry whose redo/undo replay all buffered handlers in order / reverse order.
- A throw inside a transaction's `work` rolls back every buffered undo in reverse and re-throws to the caller. `clear()` / `dispose()` during the await stales the transaction and rolls back instead. Empty transactions resolve to `null` with no entry.
- Nested `transaction(...)` calls flatten into the outermost; the nested `label` argument is ignored, the outermost label or any `tx.label(...)` call wins.
- Composite entries never coalesce with stack neighbors. Inside a transaction, individual `tx.push` calls do not coalesce with each other either.
- Lifecycle hooks (`onPush` / `onUndo` / `onRedo` / `onClear`) are provider-level options. They fire once per logical action — coalesce-merges and rollback-due-to-throw do not fire `onPush`. A transaction commit fires exactly one `onPush` for the composite entry.
- Hook payloads carry `(entry, scopeId)`; `onClear` carries `(scopeId)`. Hooks fire after subscribers have been notified, so handlers see a quiescent store and may safely re-enter `push` / `undo` / `redo`. A throwing hook is caught and ignored.
- `metaTransform: (meta) => meta | undefined` redacts `meta` before it reaches the snapshot or any hook. Use this to strip secrets / PII without forcing every call site to remember the rule. Returning `undefined` strips meta entirely; a throwing transform also strips it.
- `useUndoableState` returns `[value, set, reset]`. `reset()` restores the value captured on first render and clears the bound scope's history. `reset(next)` overrides with a specific value. Reset is **not undoable** — the scope is wiped.
- `usePersistedUndoableState` returns `{ value, set, reset, remove }`. `reset(next?)` is composite: it clears the history scope AND restores the persisted value via `react-mnemonic` (calling `mnemonic.reset()` with no arg, `mnemonic.set(next)` otherwise). `remove()` deletes the persisted key AND clears the history scope.
- `reset` and `remove` clear the **entire scope** the hook is bound to — including entries from sibling hooks or imperative pushes that share the same scope. Pin sensitive history to its own `scopeId` when that boundary matters.
- `<AmnesiaProvider enableDevTools devToolsId="my-app">` registers the provider with `window.__REACT_AMNESIA_DEVTOOLS__`. The registry is opt-in and lazy-installed: when no provider sets `enableDevTools`, no global is created.
- The devtools api exposes `id`, `getActiveScopeId()`, `scopes()`, `getSnapshot(scopeId?)`, `pastSnapshot(scopeId?)`, `futureSnapshot(scopeId?)`, `dump()`, `triggerUndo(scopeId?)`, `triggerRedo(scopeId?)`, and `clear(scopeId?)`. External tooling and AI agents can introspect or drive a live store without touching application code.
- Provider entries are held weakly via `WeakRef` when available, so a long-lived registry never prevents an unmounted provider from being garbage-collected.
- Every command handler (`do` / `redo` / `undo`) and every transaction `work` function receives an `AbortSignal` argument. The signal aborts when `clear()` or `dispose()` runs while the handler is in flight. Pass it to `fetch` (which cancels the network call) or check `signal.aborted` in long loops. A rejection thrown after `signal.aborted === true` is treated as a silent no-op — no `onError` event fires and the entry is dropped.
- Handlers that ignore the signal still drop the commit via the existing epoch check; the difference is that `onError({ phase: "stale" })` fires for ignored signals and stays silent for honored ones.
- Each operation gets its own `AbortController` — sibling ops don't share signals. Nested transactions DO share the outer transaction's signal, so cancellation propagates through the whole flattened buffer.
- A new `push` clears the redo (future) stack. There is no branching in v0.
- Use `coalesceKey` (e.g. `"edit:title"`) for keystroke or drag bursts so a single Ctrl+Z reverts the whole burst. Coalescing across async commands is fragile — recommend against it.
- Two pushes coalesce only when they share the same non-empty `coalesceKey` and arrive within `coalesceWindowMs` of each other.
- Capacity defaults to `100`. When the limit is reached, the oldest past entry is dropped silently — do not rely on history for audit trails.
- `clear()` is synchronous. It drops both stacks, bumps the `epoch` counter, empties the pending set, and notifies subscribers once.
- `<AmnesiaShortcuts />` defaults to `skipEditableTargets: true` so the browser's native undo handles `<input>`, `<textarea>`, `<select>`, and `contenteditable` regions. The check walks `event.composedPath()` so editables inside open shadow roots (Lit / web components) are also recognized.
- `<AmnesiaShortcuts />` ignores chords with `event.defaultPrevented === true` (an upstream handler already claimed it) and ignores `Alt`-modified chords (`Ctrl+Alt+Z` is not Undo).
- `target` accepts `HTMLElement | Document | Window | "document" | "window" | null`. The string forms are SSR-safe — they resolve at handler-attach time inside `useEffect`, not at module load.
- The store is single-flight. Concurrent `push` / `undo` / `redo` while one is pending resolve to `null` and fire `onError({ phase: "busy" })`.
- An async op whose `await` outlasts a `clear()` resolves to `null` and fires `onError({ phase: "stale" })`. State has already been cleared.
- A throwing `redo()` / `undo()` leaves the entry in place and fires `onError({ phase: "undo" | "redo", recoverable: true })`. The application is responsible for retry or recovery.
- `onError` invocations are deferred until the pending set is empty so handlers may safely re-enter the store.
- `AmnesiaProvider` does not auto-dispose on unmount (it would conflict with React 18 StrictMode). Call `store.dispose()` yourself when sharing a store with non-React code.
- Do not put authentication tokens, refresh tokens, session IDs, or other secrets into command `meta` — snapshots are exposed to descendant components and devtools.
- Consumer code should import published values and types from `react-amnesia`, not internal paths or local ambient shims.
- Import from `react-amnesia/core` when persistence is not needed; that entrypoint does not require `react-mnemonic`.

## Decision Checklist

Before adding a new history entry or making state reversible, answer these
questions explicitly:

1. Should this state be reversible from the keyboard, or is it transient UI state where CMD|Ctrl+Z would be surprising?
2. Should rapid bursts collapse into a single undo? If yes, give them a shared `coalesceKey`.
3. Does the change need to survive reloads? If yes, layer `usePersistedUndoableState` (or use `useMnemonicKey` directly and push commands manually).
4. Can the inverse be expressed cheaply? If `undo()` would require recomputing or re-fetching, capture the previous value at the call site instead of recomputing it inside the closure.
5. Is this entry safe to drop? With the default `capacity: 100`, the oldest entries are silently discarded — anything that must be reversible forever should be modeled differently (e.g. an audit log).

## Canonical Retrieval Surfaces

These AI-oriented surfaces are intentionally layered:

- `/docs/ai/*` is the canonical prose source.
- `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*`, `.cursor/rules/*`, `.github/copilot-instructions.md`, and `.github/instructions/*` are generated instruction-pack projections over the same canonical source.

## What To Read In Code

When prose is not enough, these source files define the runtime contract:

- [`src/Amnesia/history.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/history.ts) for the framework-agnostic store, capacity rules, and coalescing
- [`src/Amnesia/provider.tsx`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/provider.tsx) for context wiring
- [`src/Amnesia/use.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/use.ts) and [`use-undoable-state.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/use-undoable-state.ts) for hook semantics
- [`src/Amnesia/shortcuts.tsx`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/shortcuts.tsx) for the keyboard binding contract
- [`src/Amnesia/types.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/Amnesia/types.ts) for public types
- [`src/mnemonic.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/mnemonic.ts) for the optional persistence bridge
- [`src/index.ts`](https://github.com/thirtytwobits/react-amnesia/blob/main/src/index.ts) for the published public surface

## High-Risk Areas

These are the places where agents are most likely to be "almost right" while
still shipping incorrect undo behavior:

- expecting the undo stack itself to survive a page reload
- replaying old commands against new application state without checking that the inverse is still meaningful
- pushing commands inside a render path instead of an event handler or effect
- swallowing the browser's native undo by binding shortcuts globally without `skipEditableTargets`
- forgetting that a new `push` clears the redo stack, so "undo, edit, redo" is not a no-op
- using `clear()` as a substitute for `undo()` and losing legitimately reversible work
- relying on capacity-bounded history as an audit trail
- storing closures that capture stale React state across renders without using a ref

If the task involves any of those areas, go straight to the linked AI pages
instead of extrapolating from a single example.
