---
sidebar_position: 3
title: Imperative Commands
description: When to use useAmnesia().push directly instead of useUndoableState.
---

# Imperative Commands

`useUndoableState` covers the common single-value case. For mutations
that touch a list, graph, canvas, or any data structure the hook can't
own directly, push commands imperatively:

```tsx
import { useAmnesia } from "react-amnesia";

type Item = { id: string; text: string };

export function AddItemButton({ list }: { list: { add(item: Item): void; remove(id: string): void } }) {
    const { push } = useAmnesia();
    return (
        <button
            onClick={() => {
                const item: Item = { id: crypto.randomUUID(), text: "New item" };
                list.add(item);
                push(
                    {
                        label: "Add item",
                        redo: () => list.add(item),
                        undo: () => list.remove(item.id),
                    },
                    { applied: true },
                );
            }}
        >
            Add
        </button>
    );
}
```

## The `Command` shape

| Field          | Required | Purpose                                                                                                                                                           |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redo(signal)` | yes      | Apply (or re-apply) the action. Runs on every redo and on initial push when `do` is absent.                                                                       |
| `undo(signal)` | yes      | Revert the action. Runs on every undo.                                                                                                                            |
| `do(signal)`   | no       | One-shot initial-apply handler. When present, replaces `redo` for the first push. Useful when first-apply mints state (an id) that subsequent replays must reuse. |
| `label`        | no       | Human-readable label for history UIs.                                                                                                                             |
| `coalesceKey`  | no       | Merge identity for [coalescing](./coalescing).                                                                                                                    |
| `meta`         | no       | Free-form data for tooling. Pass through `metaTransform` to redact secrets.                                                                                       |

All three handlers receive an `AbortSignal` — see the
[Async Commands guide](./async-commands).

## `applied: true` vs default

`push(command)` calls `command.redo()` (or `command.do()`) once on
insertion. If your call site already mutated state itself — for example,
the user-event handler called `list.add(item)` directly before pushing —
pass `{ applied: true }` to skip the initial invocation.

```tsx
list.add(item); // mutate first
push({ redo, undo }, { applied: true }); // record the inverse without re-running redo
```

## When to prefer `useUndoableState`

If the mutation IS just "set this value to something else", reach for the
hook instead:

```tsx
const [text, setText] = useUndoableState("");
```

Imperative `push` is right when:

- The mutation touches data the hook doesn't own (lists, graphs, canvas)
- The inverse depends on a value computed at the call site (like `item.id`)
- Multiple steps must collapse into one entry → see [Transactions](./transactions)

## See also

- [Recipe: Imperative List Mutation](../ai/recipes#3-imperative-list-mutation)
- [Transactions guide](./transactions) — for batched compound mutations
- [Async Commands guide](./async-commands)
