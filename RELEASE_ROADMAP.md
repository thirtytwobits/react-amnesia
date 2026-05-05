# v0.1.0 Runtime Roadmap

This file tracks the runtime feature work for the **first npm publish**. The
package version stays `0.1.0` throughout — nothing has shipped yet, so there
is no historical API to migrate from. Everything described here is what
`react-amnesia@0.1.0` will be when it lands on npm.

The goal of the first release is a single, well-scoped runtime that:

1. **Lets primrosehill replace `desktop/shared/undo/`.** That codebase is the
   most concrete real-world adopter we have data on, and the gap analysis
   surfaced a small, bounded set of features to close.
2. **Covers the surface that any serious adopter expects** before they would
   trust an undo library — async commands, multi-scope routing, transactional
   batching, lifecycle hooks, devtools.
3. **Avoids feature creep.** Branching, selective undo, CRDT, reducer
   integration, and patch-based command synthesis are explicitly deferred.
   They are real wants but each carries enough design surface to derail a
   focused first release.

---

## Workstream A — Async commands with busy / version guard

**Why:** primrosehill's `CommandUndoHistory.execute()` awaits `do()`, takes a
version snapshot before the await, and refuses to commit the entry if the
store mutated during the await. Without this, half of primrosehill's runtime
actions (theme apply, server-URL change, session selection) cannot move.

**Spec:**

- `Command.do`, `Command.undo`, `Command.redo` may return `void | Promise<void>`.
- The store keeps a monotonic `version: number` (already present) and a new
  `pending: number` counter (in-flight async ops).
- `push(command, options?)` flow becomes: snapshot version → `await do()` →
  if version changed during the await, drop the entry and call `onError({ phase: "stale" })`.
- `undo()` / `redo()` follow the same pattern; they return `Promise<number | null>`.
- New snapshot field: `pending: boolean` (true while any in-flight op is live).
  `<AmnesiaShortcuts />` ignores chords while `pending`.
- Concurrent calls to `undo()` / `redo()` while `pending === true` resolve to
  `null` immediately — the store is single-flight.
- New error phase: `"stale"` for version-mismatch drops.

**Acceptance:**

- Async happy path: `await push({ do: async () => …, undo: async () => … })`
  pushes one entry after `do` resolves.
- Concurrent test: two parallel `push()` calls — second one observes the
  version bump from the first and resolves as `phase: "stale"`.
- Strict-mode test: double-invoked effect during dev does not double-push.
- Pending flag flips correctly across the full async lifecycle.

**Dependencies:** none. First workstream.

**Estimated effort:** 2–3 days plus tests.

---

## Workstream B — Distinct `Command.do` vs `Command.redo`

**Why:** primrosehill separates initial-apply (`do`) from re-apply (`redo`)
because the inverses sometimes require different closures (inserting a
freshly-created node vs. restoring a known reference). Today we overload
`redo` with the initial-apply contract via `applied: false`, which forces
adopters to write awkward closures.

**Spec:**

- `Command.do?: () => void | Promise<void>` — optional one-shot run on push.
- `Command.redo: () => void | Promise<void>` — required; runs on every redo.
- `Command.undo: () => void | Promise<void>` — required.
- On `push(command, { applied: false })`: invoke `command.do ?? command.redo`.
- `applied: true` skips the initial invocation as today.
- Coalescing keeps the merged entry's `redo` as the latest pushed command's
  `redo`, and the original entry's `undo`. `do` is not stored — only `redo`
  and `undo` survive on the stack.

**Acceptance:**

- New test: `push({ do, redo, undo })` with `applied: false` calls `do` once,
  then `redo` on each subsequent redo.
- Test: `push({ redo, undo })` (no `do`) still works — `redo` is invoked on
  initial push.

**Dependencies:** A (so `do` can also be async).

**Estimated effort:** 1 day.

---

## Workstream C — Multi-scope routing with focused-child override

**Why:** the largest single gap. primrosehill's `UndoRouter` (195 lines) lets
multiple authoring surfaces coexist — `dataflow`, `ui-builder`, `world-editor`,
`desktop-ui` — under one window with one Ctrl+Z chord. A focused child scope
(e.g. a property-panel input field) shadows its parent until focus leaves.
A naive single-store `AmnesiaProvider` would not compose cleanly with
shortcuts.

**Spec:**

- `AmnesiaProvider` owns a `Map<scopeId, AmnesiaScope>` plus an active-scope
  resolver. The default scope is `"default"` and is created implicitly.
- New API:
    - `useAmnesia(scopeId?: string)` — defaults to the active scope at call time.
    - `useUndoableState(initial, opts & { scopeId? })`.
    - `useAmnesiaScope(scopeId)` — explicitly enter a scope, returns the
      underlying `Amnesia` store.
    - `useAmnesiaFocusClaim(scopeId)` — returns `{ onFocusCapture, onPointerDownCapture }`
      handlers that, when applied to a focusable surface, claim the active scope
      while focus is inside.
    - `useAmnesiaScopes()` — exposes `activeScopeId`, `scopeIds`, and a
      `clear(scopeId?)` helper for provider-level orchestration.
- `<AmnesiaShortcuts />` resolves the active scope via the focus-claim chain,
  falling back to the provider's default. A new `scopeId` prop overrides the
  resolver and pins shortcuts to one scope (use case: a region-scoped canvas).
- Each scope is an independent store with its own past / future / version /
  capacity / coalesce window. The provider can override per-scope settings via
  a new `scopes={{ canvas: { capacity: 1000 } }}` prop.
- `clear(scopeId?)` clears one scope or all of them.

**Acceptance:**

- Test: two scopes side-by-side. Pushes route by `useAmnesia("a").push(...)`;
  Ctrl+Z routes to whichever scope owns claimed focus.
- Test: `useAmnesiaFocusClaim` correctly hands off when focus moves between
  parent and child.
- Test: `clear()` with no arg clears every scope; with an arg clears just that
  scope.
- After this lands, primrosehill should be able to delete `router.ts` entirely.

**Dependencies:** A, B.

**Estimated effort:** 4–5 days. Largest workstream.

---

## Workstream D — Transactions (batched undoable units)

**Why:** primrosehill, almost every other adopter, and our own anti-patterns
doc (multi-key persisted action recipe) all hand-roll the "wrap N mutations
in one entry" pattern by capturing previous values manually and composing
closures. A first-class transaction API makes this safe.

**Spec:**

- `useAmnesia().transaction(label, work)` where
  `work: (tx: TransactionApi) => void | Promise<void>` and
  `tx: { push(command), label(text) }`.
- Pushes inside the transaction are buffered. On successful resolution, they
  collapse into a single composite entry whose `redo` re-runs all buffered
  `redo`s in order and whose `undo` runs all buffered `undo`s in reverse.
- If `work` throws or rejects, every buffered command's `undo` runs in reverse
  and the transaction is dropped.
- Nested transactions flatten into the outermost transaction. (No nested
  composite entries — keeps the rollback semantics tractable.)
- The composite entry inherits the outermost label by default; `tx.label(...)`
  overrides.
- `coalesceKey` is honored on individual buffered commands for redo, but the
  composite entry itself is never coalesced with neighbors.

**Acceptance:**

- Test: 3 nested mutations in one transaction → 1 entry on the stack.
- Test: transaction throws halfway → all already-applied undos run, stack
  unchanged.
- Test: nested `transaction(...).transaction(...)` flattens.
- Test: undo of a composite reverses all buffered undos in reverse order.

**Dependencies:** A.

**Estimated effort:** 3 days.

---

## Workstream E — Lifecycle hooks for telemetry / devtools

**Why:** `onError` exists. Real adopters want `onPush`, `onUndo`, `onRedo`
for telemetry, history-list rendering, and devtools wiring. primrosehill
emits no analytics today but every commercial adopter will need this within
a week of integration.

**Spec:**

- New `AmnesiaProviderOptions`:
    - `onPush?: (entry: HistoryEntry, scopeId: string) => void`
    - `onUndo?: (entry: HistoryEntry, scopeId: string) => void`
    - `onRedo?: (entry: HistoryEntry, scopeId: string) => void`
    - `onClear?: (scopeId: string) => void`
- All hooks are fired after the snapshot is updated and after subscribers are
  notified, so handlers see a consistent store.
- A throwing hook is caught and ignored (matching `onError`'s discipline).
- New per-scope option `metaTransform?: (meta) => meta` for redacting
  sensitive fields before they reach hooks. Useful for the
  "do not put secrets in `meta`" anti-pattern.

**Acceptance:**

- Test: each hook fires exactly once per matching mutation.
- Test: throwing in a hook does not poison the store.
- Test: `onPush` fires after coalescing — i.e., once per logical user action.

**Dependencies:** C (scopeId in payload).

**Estimated effort:** 1 day.

---

## Workstream F — `useUndoableState` `reset`

**Why:** primrosehill's `SnapshotHistory.reset(state)` clears the stack and
rebases on a new initial value. Adopters routinely want this for "discard
changes" or "load new document" flows.

**Spec:**

- Return tuple becomes `[value, set, reset]`.
- `reset(next?: T | (() => T))` clears the surrounding scope's history (past +
  future), sets the value to `next` if provided, otherwise to the original
  initial. Does **not** push an entry.
- `useUndoableState` accepts `initial: T | (() => T)` (already does); `reset()`
  with no arg uses a stable reference to the initial.

**Acceptance:**

- Test: after `reset()`, `canUndo === false && canRedo === false`.
- Test: `reset(next)` updates the value without leaving an entry behind.

**Dependencies:** C (clear-by-scope semantics).

**Estimated effort:** 0.5 day.

---

## Workstream G — `<AmnesiaShortcuts />` polish

**Why:** primrosehill respects `event.defaultPrevented` and
`event.altKey === false`. We should match that. Also: today we install on
`window` by default, which is fine, but we should document and test the
`document.activeElement` resolution under iframe / shadow-DOM edge cases.

**Spec:**

- Skip when `event.defaultPrevented === true`.
- Skip when `event.altKey === true` (matches primrosehill's exclusion of
  Alt-modified chords).
- Add `target="document" | "window" | HTMLElement` (already supports the
  element form; document the string forms).
- Audit shadow-DOM target resolution: if `event.target` is a shadow root,
  walk into `composedPath()` to find the editable element. Test with a Lit
  component fixture.

**Acceptance:**

- Test: chord with `defaultPrevented` is ignored.
- Test: chord with `altKey` is ignored.
- Test: chord originating inside a shadow-DOM editable is skipped when
  `skipEditableTargets` is true.

**Dependencies:** none.

**Estimated effort:** 1 day.

---

## Workstream H — Strict-mode and React 19 audit

**Why:** React 18 strict-mode double-invokes effects in dev. React 19 changes
some lifecycle timing. Both already shipped; we have to be safe on both.

**Spec:**

- Add a CI matrix: tests run against React 18 and React 19 peers.
- Add a strict-mode test wrapper that double-renders every existing component
  test.
- Fix any double-push, double-listener, or stale-snapshot issues that surface.
- Set peer dep range to `react: ^18.0.0 || ^19.0.0`.

**Acceptance:**

- Full test suite passes under strict mode on React 18 and 19.
- No new console warnings during tests.

**Dependencies:** A, C (so the new APIs are also covered).

**Estimated effort:** 1–2 days.

---

## Workstream I — DevTools registry

**Why:** mirrors `react-mnemonic`'s `window.__REACT_MNEMONIC_DEVTOOLS__`
pattern. Lets a future browser extension or CLI introspect live stores. Also
lets agents query "what's on the stack" without reading source. This is the
"AI-first" framing made concrete.

**Spec:**

- New `AmnesiaProvider` option: `enableDevTools?: boolean` (default `false`).
- When enabled, the provider registers a weak-ref entry in
  `window.__REACT_AMNESIA_DEVTOOLS__` keyed by an opt-in `id` prop (defaults to
  a generated id). Mirrors `MnemonicDevToolsRegistry` exactly: `resolve(id)`,
  `list()`, `capabilities`, `__meta`.
- Per-store API: `dump()`, `pastSnapshot()`, `futureSnapshot()`, `scopes()`,
  `triggerUndo()`, `triggerRedo()`, `clear(scopeId?)`.
- Tree-shaken away when `enableDevTools` is statically false (gate behind a
  module-level `if`).

**Acceptance:**

- Test: with `enableDevTools`, the registry resolves and exposes a working API.
- Test: without it, no global is created and the bundle does not retain the
  registry code (snapshot test on the built ESM file size).

**Dependencies:** C.

**Estimated effort:** 1.5 days.

---

## Workstream J — Cancellation tokens for in-flight async ops

**Why:** Workstream A introduces async commands but doesn't say what happens
when `clear()` is called mid-flight. Leaving an orphan promise that resolves
into a now-empty stack is a footgun.

**Spec:**

- Each `do` / `undo` / `redo` invocation receives an `AbortSignal` argument.
- `clear()` and `dispose()` call `abort()` on every in-flight signal.
- A rejection thrown after `signal.aborted === true` is treated as a silent
  no-op rather than an `onError` event.
- Document that async commands which ignore the signal will continue to run,
  but their result is dropped — same contract as `fetch`.

**Acceptance:**

- Test: a long-running `await push({ redo: async (signal) => …, undo })`
  followed by `clear()` aborts the in-flight `redo` and does not push the entry.
- Test: rejecting with a non-`AbortError` still routes to `onError`.

**Dependencies:** A.

**Estimated effort:** 1 day.

---

## Cross-cutting work

These are not features but ship-blockers for the first publish.

- **Canonical AI docs** in `website/docs/ai/`:
    - new `Async Commands` section in `invariants.md`
    - new `Multi-Scope Routing` section in `decision-matrix.md` and `recipes.md`
    - new `Transactions` recipe
    - new `Cancellation` invariants entry
    - regenerate `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/*` etc. via
      `npm run docs:ai`
- **`ai-contract.json`** must include the new APIs once Step 3 of `DOCS_TODO.md`
  lands. If it hasn't shipped by then, defer.
- **Property-based tests** for the core invariants (push → undo → redo cycle
  preserves value, capacity drops oldest, coalesce key collapses bursts).
- **Bundle-size budgets** per entrypoint, enforced in CI:
    - `react-amnesia/core` < 12 KB ESM gzipped
    - `react-amnesia/mnemonic` < 3 KB ESM gzipped
- **Public-API surface test** (e.g. `api-extractor` snapshot) so accidental
  surface changes fail CI.
- At least one external adopter integration before publish. Ideally
  primrosehill itself.

---

## Explicitly deferred to a future release

These are real wants but each carries enough surface area to derail this
release. Capture them now so they don't keep coming up.

- **Branching / multi-timeline history** — preserving the future stack across
  new pushes. Requires a tree, not a stack; large UX-design surface.
- **Selective undo (skip an entry mid-stack)** — only safe when commands are
  commutative; needs an explicit annotation per entry to be correct.
- **Named checkpoints / "undo to here"** — depends on stable entry ids and a
  `undoUntil(id)` API. Small but easier once we know the transaction model is
  stable.
- **Reducer integration** (`withAmnesia(reducer)`) — would auto-derive
  inverses from state diffs. Big design surface; better as a separate package
  (`react-amnesia/reducer`) once the core stabilizes.
- **Patch-based commands (Immer / mutative)** — `produceWithPatches` →
  `Command`. Same caveat as reducer integration.
- **CRDT / collaborative undo** — out of scope; reasonable adopters will pair
  react-amnesia with their CRDT layer rather than expect us to own it.
- **Custom persistence adapters beyond the mnemonic bridge** — current users
  can write `useMnemonicKey`-shaped wrappers; revisit only after demand.
- **Tauri / Electron menu bindings** — application concern, stays in
  primrosehill / consumers.

---

## Acceptance: ready to publish when

1. Every workstream above (A–J) has merged with green tests on React 18 and 19.
2. `npm run lint`, `npm run test`, `npm run ai:check`, `npm run build` all pass
   in CI on every PR.
3. One external adopter (primrosehill or a fixture app) has integrated the
   runtime end-to-end.
4. Canonical AI docs are regenerated; `AGENTS.md` / `CLAUDE.md` / Cursor /
   Copilot rules reflect the final API.
5. Bundle-size budgets pass.
6. Tag `v0.1.0`, publish to npm.

---

## Suggested order of execution

```
A (async + busy/version) ──┬─► B (do vs redo)
                           ├─► D (transactions)
                           └─► J (cancellation)

A,B ─► C (multi-scope routing) ──┬─► E (lifecycle hooks)
                                 ├─► F (useUndoableState reset)
                                 └─► I (devtools registry)

(any time) ─► G (shortcut polish)
(after C)  ─► H (strict-mode + React 19 audit)
(after all features) ─► cross-cutting (docs, budgets, adoption)
```

Critical path: **A → C → cross-cutting**. Workstreams D, E, F, G, I, J can run
in parallel once their dependencies are met. H runs continuously after C as a
gate on every PR.

---

## Anti-goals for this release

- Do not redesign the core `Amnesia` surface beyond what is listed.
- Do not introduce a new package (`react-amnesia/reducer`, etc.).
- Do not gate adoption on the website / `llms.txt` / typedoc work in
  `DOCS_TODO.md`. Those are valuable but orthogonal — the runtime should
  ship even if the docs site lags.
- Do not add features motivated only by hypothetical future adopters. Every
  workstream above traces back either to primrosehill's gap analysis or to a
  shipping requirement (strict mode, bundle budget, telemetry).
