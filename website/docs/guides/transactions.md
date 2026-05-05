---
sidebar_position: 5
title: Transactions
description: Collapse N pushes into one composite undoable entry.
---

# Transactions

A transaction wraps multiple `push`es into a single composite entry.
A single Ctrl+Z reverses the whole bundle. Throws inside the work
function trigger automatic rollback.

```tsx
import { useAmnesia } from "react-amnesia";

export function ApplyPresetButton({ doc }: { doc: DocStore }) {
    const { transaction, pending } = useAmnesia();

    const apply = async () => {
        const before = doc.snapshot();
        await transaction("Apply preset", async (tx) => {
            await tx.push({
                redo: () => doc.setTitle("Untitled (preset)"),
                undo: () => doc.setTitle(before.title),
            });
            await tx.push({
                redo: () => doc.addTag("preset"),
                undo: () => doc.removeTag("preset"),
            });
            await tx.push({
                redo: () => doc.setUpdatedAt(Date.now()),
                undo: () => doc.setUpdatedAt(before.updatedAt),
            });
        });
    };

    return (
        <button disabled={pending} onClick={apply}>
            Apply preset
        </button>
    );
}
```

## Behaviour

| Situation                               | What happens                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Work resolves                           | All buffered redo/undo pairs collapse into ONE composite entry on the past stack.                        |
| Work throws / rejects                   | Every buffered undo runs in reverse, the work's error is re-thrown to the caller, no entry is committed. |
| `clear()` runs mid-await                | Buffered undos run, `onError({ phase: "stale" })` fires, transaction resolves to `null`.                 |
| Empty work (no `tx.push`)               | Resolves to `null`, no entry committed.                                                                  |
| `tx.label("…")` called                  | Overrides the composite's label. Last write wins.                                                        |
| Nested `transaction(...)` inside `work` | Flattens into the outer. Nested label is ignored. Returns `null`.                                        |
| Composite undo                          | Runs all buffered undos in **reverse** order.                                                            |
| Composite redo                          | Runs all buffered redos in **original** order.                                                           |

## `tx.push` vs `store.push`

Inside the `work` function, use `tx.push` — it appends to the
transaction's buffer. A bare `store.push` (or `useAmnesia().push`) from
inside `work` hits busy and is **dropped silently** from the user's
perspective. Easy mistake to make; the [anti-pattern doc](../ai/anti-patterns)
has a section on it.

## Async work + AbortSignal

The work function receives an `AbortSignal` as its second argument:

```tsx
await transaction(async (tx, signal) => {
    await tx.push({
        redo: async () => fetch("/api/save", { method: "POST", signal }).then((r) => r.json()),
        undo: () => undefined,
    });
});
```

When `clear()` aborts the signal, the work can either honor it (rejects
silently with no `onError`) or ignore it (epoch drop, `phase: "stale"`).

## Coalescing

Composite entries **never** coalesce with stack neighbors. Inside a
transaction, individual `tx.push` calls also do not coalesce with each
other — each is appended to the buffer verbatim.

## See also

- [AI invariants — Transactions](../ai/invariants#transactions)
- [Recipe: Transaction (Multi-Step Composite Entry)](../ai/recipes#13-transaction-multi-step-composite-entry)
- [Async Commands guide](./async-commands)
