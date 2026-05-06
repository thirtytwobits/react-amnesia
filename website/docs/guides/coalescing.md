---
sidebar_position: 2
title: Coalescing Bursts
description: Use coalesceKey so rapid keystrokes or drag frames collapse into one undoable entry.
---

# Coalescing Bursts

A single character keystroke or a 60Hz slider drag should not produce one
history entry per frame. Use `coalesceKey` to merge consecutive pushes that
arrive within the active coalescing window (`coalesceWindowMs`) of each
other.

```tsx
import { useUndoableState } from "react-amnesia";

export function TitleEditor() {
    const [title, setTitle] = useUndoableState("Untitled", {
        label: "Edit title",
        coalesceKey: "edit:title",
    });
    return <input value={title} onChange={(e) => setTitle(e.target.value)} />;
}
```

A burst of 5 keystrokes with the same `coalesceKey` produces **one** entry
on the stack. A single Ctrl+Z reverts the whole burst back to its
pre-burst value.

## How merging works

The merged entry keeps:

- the **latest** `redo` (so a future Redo replays the final state)
- the **earliest** `undo` (so a single Undo reverts to the pre-burst state)
- the latest `label`, `coalesceKey`, and `meta` for display purposes

## When coalescing does NOT happen

- Different `coalesceKey` between consecutive pushes
- Empty `coalesceKey` (treated as "do not coalesce")
- More than the effective coalescing window between pushes
- The previous entry has already been undone (not on top of the past stack)
- The new push sets `coalesceWindowMs <= 0`
- The push happens through `tx.push` inside a transaction — composite
  entries never coalesce with neighbors

## Tuning the window

```tsx
<AmnesiaProvider coalesceWindowMs={1000}>{/* coalesce within 1s instead of the default 400ms */}</AmnesiaProvider>
```

A longer window collapses more aggressively (good for slow typists, bad
for batched edits where the user expects each pause to checkpoint). Tune
per-scope when surfaces have different cadences:

```tsx
<AmnesiaProvider scopes={{ canvas: { coalesceWindowMs: 50 } }}>
```

### Per-command override

Imperative `push(...)` can override the scope window per command:

```tsx
push({
    coalesceKey: "drag:node-42",
    coalesceWindowMs: Number.POSITIVE_INFINITY,
    redo: applyFrame,
    undo: restoreFrame,
});
```

Resolution rules:

- `command.coalesceWindowMs` (when provided) wins over the scope default
- `Number.POSITIVE_INFINITY` disables time-bound checks (pure adjacency)
- `<= 0` disables coalescing for that push
- `undefined` falls back to the scope/provider `coalesceWindowMs`

## Coalesce keys, not labels

`coalesceKey` is the merge identity — make it unique per logical edit
target (`"edit:title"`, `"drag:volume"`, `"resize:node-42"`). Don't reuse
the user-facing `label` here; labels can change but the coalesce key
should be stable across a single editing burst.

## Don't coalesce across async commands

Each push's coalesce window is measured at commit time. An async push
that takes 800 ms to settle can race against a fresh keystroke — the
result is unpredictable. Recommendation: **do not** set `coalesceKey` on
async commands.

## See also

- [Recipe: Coalesced Slider Drag](../ai/recipes#3-coalesced-slider-drag)
- [AI invariants — coalescing rules](../ai/invariants#core-runtime-invariants)
