---
sidebar_position: 5
title: Anti-Patterns
description: Common mistakes that produce incorrect undo/redo semantics even when the app appears to work.
---

# Anti-Patterns

These patterns often "work" at runtime but still encode the wrong undo
contract.

## Persisting The Undo Stack

The history stack is in-memory only. Closures cannot be serialized and old
commands are usually wrong against fresh application state.

Wrong:

- serializing `useAmnesia().past` and rehydrating it on the next session
- writing every `push()` to `localStorage` so reloads "remember" undo

Prefer:

- persisting the underlying _value_ via `react-mnemonic` (or any other store)
- letting the history start empty on each reload — that is the documented contract

## Replaying Stale Closures Across Document Switches

Switching documents leaves entries on the stack whose closures reference the
prior document's data.

Wrong:

- relying on accumulated history when the user opens a different document
- expecting Ctrl+Z to "undo across documents"

Prefer:

- calling `clear()` after switching state
- scoping providers per document with a `key` prop so the provider remounts cleanly

## Pushing During Render

Pushing inside a render path produces unbounded history and React warnings.

Wrong:

- calling `push(...)` directly in a component body
- calling `push(...)` inside `useMemo` or a derived selector

Prefer:

- calling `push(...)` from event handlers, effects, or commands
- using `useUndoableState(...)` for the common single-value path so the hook owns the call site

## Capturing Stale React State Inside Closures

React state captured by a closure goes stale across re-renders.

Wrong:

```tsx
const [value, setValue] = useState(initial);
push({
    redo: () => setValue("next"),
    undo: () => setValue(value), // ← `value` is stale on later renders
});
```

Prefer:

- capturing the previous value at the call site as a local constant
- using a ref kept in sync with state, then reading `ref.current` in the closure
- using `useUndoableState(...)`, which already does this correctly

## Treating Capacity-Bounded History As An Audit Log

`react-amnesia` silently drops the oldest entries when capacity is reached.

Wrong:

- expecting the stack to retain every action ever performed
- using history snapshots as evidence of what the user did

Prefer:

- a separate, append-only log for compliance or analytics
- treating the undo stack as a UX affordance only

## Stealing The Browser's Native Undo Inside Inputs

The browser ships its own undo for `<input>`, `<textarea>`, and
`contenteditable`. Stealing it usually breaks user expectations.

Wrong:

- `<AmnesiaShortcuts skipEditableTargets={false} />` while the app contains regular form fields
- pushing undo entries on every keystroke and then preventing default for native chord behavior

Prefer:

- the default `skipEditableTargets: true`
- `useUndoableState(...)` only for fields that genuinely benefit from app-level undo, with a `coalesceKey`

## Using `clear()` As A Substitute For `undo()`

`clear()` discards both stacks. It cannot be undone.

Wrong:

- calling `clear()` to "undo" a single bad action
- calling `clear()` because the redo stack feels noisy

Prefer:

- `undo()` for individual reversals
- `clear()` only on document switches, route transitions, logout, or similar resets

## Expecting Branching On New Pushes

After an `undo()`, a new `push()` clears the future stack. There is no branch
recovery in v0.

Wrong:

- expecting "undo, edit, redo" to restore the previously redone state
- relying on `future` entries surviving a push

Prefer:

- treating new edits after an undo as a destructive operation against the redo stack
- prompting the user before discarding the future stack if your UX requires that

## Putting Secrets Into Command `meta`

History snapshots are exposed to descendant components and devtools.

Wrong:

- access tokens, refresh tokens, or session IDs in `meta`
- raw user PII in command labels rendered into the DOM

Prefer:

- references (e.g. user id) and resolving sensitive data at runtime
- structured labels that summarize the action without leaking material

## Treating `useUndoableState`'s `reset` As Scope-Local

`reset` clears the **entire scope** the hook is bound to — not just the
value owned by this hook. Sibling `useUndoableState` calls and imperative
`useAmnesia(scopeId).push(...)` entries in the same scope are wiped along
with it.

Wrong:

- `[a, setA, resetA] = useUndoableState(0)` paired with another
  `[b, setB] = useUndoableState(0)` in the same component, expecting
  `resetA()` to leave `b`'s history intact
- mounting a "discard draft" reset on a default-scope hook in an app that
  also tracks unrelated reversible actions in the default scope

Prefer:

- pin sensitive history to its own scope: `useUndoableState(0, { scopeId: "draft" })`
- use `reset` only when the scope-wide wipe is actually what you want
- if you need to "reset only this value" without touching history, write
  the inverse as a normal `set(initial)` — but then the operation is
  itself undoable, and the user can roll back the reset

## Driving UI From Lifecycle Hooks

Lifecycle hooks (`onPush` / `onUndo` / `onRedo` / `onClear`) are for
side-channel observers — analytics, devtools, audit logs. They are NOT a
substitute for subscribing to the snapshot.

Wrong:

- using `onPush` to update React state via `setState` from outside the React
  tree
- treating the hook payload as the source of truth for "what's on the stack"

Prefer:

- `useAmnesia()` (or the scoped variant) — drives UI through normal
  subscriber semantics
- `onPush` for fire-and-forget telemetry that does not feed back into the
  rendered output

## Putting Side-Effecting Mutations Inside `metaTransform`

`metaTransform` runs every time the snapshot is built and every time a hook
fires. If it has side effects, they fire repeatedly with surprising timing.

Wrong:

```tsx
metaTransform: (meta) => {
    if (meta.audit) sendAuditLog(meta);   // ← runs N times per mutation
    return meta;
}
```

Prefer:

- pure transforms only (`return { ...meta, secret: undefined }` etc.)
- emit telemetry from `onPush` / `onUndo` / `onRedo` instead, which fire
  exactly once per logical action

## Calling `store.push` From Inside Transaction `work`

The store is single-flight while a transaction is in flight. A bare
`store.push(...)` from inside the work function hits busy and is dropped
silently from the user's perspective.

Wrong:

```tsx
await transaction("preset", async (tx) => {
    await tx.push({ redo, undo });
    // BAD — second mutation is lost.
    await store.push({ redo, undo });
});
```

Prefer:

- always use `tx.push(...)` inside the work function so the mutation joins
  the buffer
- if you really need a "do this on its own outside the transaction" effect,
  schedule it after the transaction resolves

## Holding `tx` Outside The Work Function

The `TransactionApi` handle is closed when the surrounding `transaction(...)`
call resolves. Calls to `tx.push` / `tx.label` after that point throw.

Wrong:

```tsx
let captured;
await transaction((tx) => {
    captured = tx;
});
await captured.push(...); // throws
```

Prefer:

- treat `tx` as a borrow whose lifetime is the work function's call frame
- start a fresh transaction for the next batch of mutations

## Modeling Recoverable Errors As Transaction Throws

A throw inside `work` rolls back **every** buffered undo. If only some of
the work failed, you may be undoing successful steps too.

Wrong:

```tsx
await transaction(async (tx) => {
    await tx.push(saveMetadata);    // succeeded
    try {
        await tx.push(uploadAvatar); // failed
    } catch {
        // swallow — but tx is already aware of the failure
        throw new Error("avatar failed");
    }
});
```

Prefer:

- decide up-front whether each step is part of the atomic bundle
- if a step is genuinely optional, fan it out as a separate `push` after the
  transaction commits, with its own retry / undo semantics

## Routing `useUndoableState` Through The Active Scope

`useUndoableState` always pins to a stable `scopeId`. It does not — and
should not — float to the active claim. React state is owned by a component
instance; the history surface it belongs to is a stable property, not a
focus-driven one.

Wrong:

- attempting to make `useUndoableState` "scope-aware" by reading
  `useAmnesia().scopeId` inside the call site and passing it as `scopeId`
- expecting `useUndoableState` to migrate its entries when focus moves

Prefer:

- declare `scopeId` once at the call site as a literal: `useUndoableState(initial, { scopeId: "canvas" })`
- use `useAmnesia()` (no arg) only for read-only views (toolbar buttons,
  badges) that should follow the active claim

## Mixing `useAmnesiaFocusClaim` With Inert DOM

`useAmnesiaFocusClaim` returns capture-phase handlers. They only fire when
focus or pointer-down events actually reach the element they're attached to.

Wrong:

- spreading the handlers onto a `<div>` that has no `tabIndex` and no
  focusable descendants — focus never enters, so the claim never fires
- attaching them inside a child but expecting the parent's events to bubble
  through (capture-phase only catches at the bound element)

Prefer:

- attach the handlers to a focusable container (`tabIndex={-1}` is fine for
  programmatic focus, `tabIndex={0}` for tab navigation)
- ensure the container has at least one focusable descendant or accepts
  pointer-down itself

## Using `Command.do` When `redo` Alone Would Suffice

`do` exists for the narrow case where first-apply and replay genuinely need
different closures. Using it gratuitously means the command has two code
paths to keep in sync.

Wrong:

- `do` and `redo` are identical literal copies of each other
- `do` differs from `redo` only by adding "first time!" telemetry that could
  ride on `onPush` (Workstream E) when that lands

Prefer:

- omit `do` entirely; let `redo` run on initial push
- use `do` only when first-apply produces a value (e.g. an id) that subsequent
  replays must reuse, or when first-apply has a side effect that replay must not

## Capturing Mutable State In `do` Without A Stable Closure

`do` runs once. `redo` runs many times. If `redo` reads from a variable that
`do` populated, that variable must outlive both — typically a closed-over
`let` or a ref.

Wrong:

```tsx
push({
    do: () => {
        const id = mintId();
        list.add({ id, text });
    },
    // `id` does not exist here.
    redo: () => list.restore(id),
    undo: () => list.remove(id),
});
```

Prefer:

- declare the captured value at the call-site scope so `do` and `redo` / `undo`
  share it
- treat the entry as a self-contained unit: any state `redo` / `undo` needs
  must be captured at push time, never recomputed inside the closures

## Awaiting `push` Inside Render

Calling `await store.push(...)` inside a render function, `useMemo`, or any
synchronous render-phase code suspends the render and produces an unbounded
stream of pushes.

Wrong:

- `await push(...)` inside a component body
- `await push(...)` inside a `useMemo` factory

Prefer:

- `void push(...)` from event handlers when you don't care about the resolution
- `await push(...)` from event handlers and `useEffect` callbacks when you do
- Capture the pending state from `useAmnesia().pending` to drive UI feedback

## Stacking Async Pushes Without Awaiting

The store is single-flight. A second `push` while another is pending resolves
to `null` and fires `onError({ phase: "busy" })` — the user's action is
**dropped**, not queued.

Wrong:

- Firing two un-awaited async pushes back-to-back from a button handler
- Assuming pending pushes will run sequentially after the first resolves

Prefer:

- `await` each push and let the user retry if a second click was intended
- Disable the trigger UI while `useAmnesia().pending === true`
- Compose multi-step work into one composite command rather than several

## Throwing From `onError`

The `onError` handler is invoked from inside the store. A throw is caught and
discarded so the store stays consistent.

Wrong:

- relying on a thrown `onError` to surface failures to React error boundaries
- side effects inside `onError` that themselves can throw and are not guarded

Prefer:

- forwarding to your error tracker explicitly
- guarding side effects with `try { ... } catch { /* ignore */ }` inside the handler

## Inventing Local Package Shims

Do not "fix" missing type information by shadowing the package.

Wrong:

- `react-amnesia.d.ts`
- `declare module "react-amnesia"`
- importing from unpublished internal paths

Prefer:

- `import` and `import type` from `react-amnesia`, `react-amnesia/core`, or `react-amnesia/mnemonic`
- checking `src/index.ts`, `package.json`, and the API docs before assuming a surface is missing

## Treating The Provider As Optional

`useAmnesia(...)` and `useUndoableState(...)` are not global singleton hooks.

Wrong:

- calling them outside an `AmnesiaProvider`
- assuming a global window-level fallback

Prefer:

- one explicit provider per undo scope (often per document or workspace)
- `useAmnesiaScopeOptional()` only for reusable components that should silently degrade outside a provider
