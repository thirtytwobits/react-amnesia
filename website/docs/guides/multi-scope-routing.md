---
sidebar_position: 6
title: Multi-Scope Routing
description: Multiple authoring surfaces under one provider, each with their own history. Focus claims route Ctrl+Z to the active scope.
---

# Multi-Scope Routing

A single `<AmnesiaProvider>` can host many independent history scopes. A
canvas, a property panel, and a layer tree each get their own past /
future / capacity / coalesce window. Focus claims route Ctrl+Z to the
scope the user is currently working in.

```tsx
import {
    AmnesiaProvider,
    AmnesiaShortcuts,
    useAmnesiaFocusClaim,
    useAmnesiaScopes,
    useUndoableState,
} from "react-amnesia";

function CanvasArea() {
    const claim = useAmnesiaFocusClaim("canvas");
    const [strokes, setStrokes] = useUndoableState<string[]>([], { scopeId: "canvas" });
    return (
        <section tabIndex={-1} {...claim}>
            <p>{strokes.length} strokes</p>
            <button onClick={() => setStrokes((s) => [...s, "stroke"])}>Add stroke</button>
        </section>
    );
}

function PropertyPanel() {
    const claim = useAmnesiaFocusClaim("props");
    const [title, setTitle] = useUndoableState("Untitled", {
        scopeId: "props",
        coalesceKey: "edit:title",
    });
    return (
        <aside tabIndex={-1} {...claim}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </aside>
    );
}

function Breadcrumb() {
    const { activeScopeId } = useAmnesiaScopes();
    return <span>Editing: {activeScopeId}</span>;
}

export function App() {
    return (
        <AmnesiaProvider scopes={{ canvas: { capacity: 1000 }, props: { capacity: 100 } }}>
            <AmnesiaShortcuts />
            <Breadcrumb />
            <CanvasArea />
            <PropertyPanel />
        </AmnesiaProvider>
    );
}
```

## How it works

- Each named scope is created lazily on first access. The implicit
  `"default"` scope exists too.
- `useAmnesiaFocusClaim(scopeId)` returns `{ onFocusCapture,
onPointerDownCapture }` handlers. Spread them onto a focusable
  container — clicking or focusing the element claims that scope as
  active.
- `<AmnesiaShortcuts />` (without a `scopeId` prop) routes the chord to
  the **active** scope. Pin to one scope with `<AmnesiaShortcuts scopeId="canvas" />`.
- Only one focused-child claim is held at a time. The most recently
  claimed scope wins. When the claiming component unmounts, the active
  scope falls back to default.

## `useUndoableState` is always pinned

`useUndoableState` accepts `scopeId` in its options and **pins** the
component to that scope. It does not float to the active claim — React
state lives in stable component instances, so the history surface it
belongs to should be a stable property, not focus-driven.

```tsx
useUndoableState(initial, { scopeId: "canvas" });
```

If you want a component that follows the active scope (say, an
`<UndoToolbar />` that always reflects the focused surface), use
`useAmnesia()` with no argument:

```tsx
function UndoToolbar() {
    const { undo, redo, canUndo, canRedo } = useAmnesia(); // tracks active
    return (
        <div>
            <button disabled={!canUndo} onClick={() => undo()}>
                Undo
            </button>
            <button disabled={!canRedo} onClick={() => redo()}>
                Redo
            </button>
        </div>
    );
}
```

## Per-scope option overrides

```tsx
<AmnesiaProvider
    capacity={100}
    coalesceWindowMs={400}
    scopes={{
        canvas: { capacity: 1000, coalesceWindowMs: 50 },
        props: { capacity: 50 },
    }}
>
```

Provider-level options are the defaults; per-scope entries override.
Settings are read at scope-creation time and frozen after that.

## Provider-wide clear

`useAmnesiaScopes()` returns `clear(scopeId?)`:

- `clear()` — every registered scope
- `clear("canvas")` — just one scope

Useful for document switches: clear everything when the user opens a
different document.

## See also

- [AI invariants — Multi-Scope Routing](../ai/invariants#multi-scope-routing)
- [Recipe: Multi-Scope Authoring App](../ai/recipes#12-multi-scope-authoring-app)
- [Anti-pattern: routing useUndoableState through the active scope](../ai/anti-patterns#routing-useundoablestate-through-the-active-scope)
