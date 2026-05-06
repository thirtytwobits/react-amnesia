---
sidebar_position: 4
title: Forms
description: Multi-field forms with shared undo/redo. Field-level coalescing, atomic resets, post-submit cleanup.
---

# Forms

A form is the most common case where multiple `useUndoableState` hooks
need to share one undo stack. The good news: **they share by default**.
Every hook bound to the same scope (the implicit `"default"` scope unless
you specify otherwise) pushes onto the same ordered history. One Ctrl+Z
reverts the most recent edit regardless of which hook produced it.

This guide covers the patterns specific to forms: per-field coalescing,
atomic resets, post-submit cleanup, and when to use a separate scope.

## The simplest form

```tsx
import { AmnesiaProvider, AmnesiaShortcuts, useUndoableState } from "react-amnesia";

function ContactForm() {
    const [name, setName] = useUndoableState("", { coalesceKey: "form:name" });
    const [email, setEmail] = useUndoableState("", { coalesceKey: "form:email" });

    return (
        <form>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </form>
    );
}

export default function App() {
    return (
        <AmnesiaProvider>
            <AmnesiaShortcuts />
            <ContactForm />
        </AmnesiaProvider>
    );
}
```

Both fields push onto the default scope. Type "scott" in name, then
"foo" in email, then Ctrl+Z three times: email goes back from "foo" to
"" (one entry), name goes back from "scott" to "" (one entry — the
keystrokes coalesced).

## Field-level `coalesceKey`

Without `coalesceKey`, every keystroke is its own undo entry. Typing
"scott" produces five entries; the user has to press Ctrl+Z five times.

With **per-field** `coalesceKey`, consecutive keystrokes within
`coalesceWindowMs` (default 400ms) merge into one entry. The keys must
be **distinct per field** so a typing burst on one field doesn't
weirdly merge with the next field.

```tsx
useUndoableState("", { coalesceKey: "form:contact:name" });
useUndoableState("", { coalesceKey: "form:contact:email" });
useUndoableState("", { coalesceKey: "form:contact:phone" });
```

Namespace prefix (`form:contact:...`) keeps the keys unique even when
the same form is mounted next to other undoable surfaces. Don't use
the user-facing `label` here; labels can change but the coalesce key
should be stable across a single edit burst.

## What goes in `useUndoableState` vs plain `useState`

| State                                           | Hook                          | Why                                                               |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| User-authored field values                      | `useUndoableState`            | The thing the user typed is what they want to undo.               |
| Validation errors / "is this field valid"       | `useState`                    | Derived. Recomputed from values on every render.                  |
| "Submit in flight" / loading                    | `useState`                    | Ephemeral; meaningless after the request settles.                 |
| `currentStep` in a wizard                       | `useState`                    | Navigation isn't an edit; Ctrl+Z shouldn't move pages.            |
| Server response cache                           | `useState` or your data layer | Not user input; not undoable.                                     |
| "Has the user touched this field" / dirty flags | `useState`                    | Same logic — a function of value comparison, not a separate edit. |

The general rule: **undo the value, not its derivatives**. Validation,
dirty flags, and submit state all recompute from values on render.

## Atomic reset via `transaction`

If a "Reset" button calls each `setName(initial)` etc. in sequence, the
user gets N undo entries — one per field. They have to press Ctrl+Z N
times to get back to the pre-reset state.

Wrap the reset in a `transaction` so the whole bundle collapses into a
single composite entry:

```tsx
import { useAmnesia } from "react-amnesia";

function ContactForm({ initial }: { initial: { name: string; email: string } }) {
    const [name, setName] = useUndoableState(initial.name, { coalesceKey: "form:name" });
    const [email, setEmail] = useUndoableState(initial.email, { coalesceKey: "form:email" });
    const { transaction } = useAmnesia();

    const reset = () =>
        transaction("Reset form", async (tx) => {
            const previous = { name, email };
            await tx.push({
                redo: () => {
                    setName(initial.name);
                    setEmail(initial.email);
                },
                undo: () => {
                    setName(previous.name);
                    setEmail(previous.email);
                },
            });
        });

    return (
        <form>
            {/* inputs */}
            <button type="button" onClick={() => void reset()}>
                Reset
            </button>
        </form>
    );
}
```

A single Ctrl+Z restores every field to its pre-reset values.

> Why not just call each hook's `reset()` (the third tuple slot)? Because
> `useUndoableState`'s `reset` is **not undoable** — it wipes the bound
> scope's history. That's correct for a "discard changes" button (where
> you don't want pre-reset state to be recoverable) but wrong for a
> "reset to defaults" button (where you do).

## Post-submit cleanup

After a successful submit, history of pre-submit edits is no longer
meaningful — the server has accepted the values and the user shouldn't
"undo" their way back to a draft they already submitted.

```tsx
const { clear } = useAmnesia();

const submit = async () => {
    await api.save({ name, email });
    clear();
};
```

`clear()` drops both stacks of the bound scope. The form's current
values stay (the React state is owned by the hooks), but Ctrl+Z is now
a no-op until the user makes a new edit. This is what you want for a
"submitted draft" UX.

## When to use a separate scope

If the form is one part of a larger app that has its own undo (a canvas,
a layer tree, etc.), put the form in its own scope. Otherwise Ctrl+Z
while focused on the canvas would also see the form's recent
keystrokes, and vice versa.

```tsx
import { AmnesiaProvider, useAmnesiaFocusClaim, useUndoableState } from "react-amnesia";

function ContactForm() {
    const claim = useAmnesiaFocusClaim("form:contact");
    const [name, setName] = useUndoableState("", {
        scopeId: "form:contact",
        coalesceKey: "name",
    });
    const [email, setEmail] = useUndoableState("", {
        scopeId: "form:contact",
        coalesceKey: "email",
    });

    return (
        <section tabIndex={-1} {...claim}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </section>
    );
}
```

The pattern:

- Every field pins to `scopeId: "form:contact"`.
- A `useAmnesiaFocusClaim("form:contact")` on the form's outer container
  routes Ctrl+Z to that scope while focus is inside the form.
- When focus leaves the form, the active scope falls back to default and
  Ctrl+Z affects whatever else the app is doing.
- Inside a single named scope, the field `coalesceKey`s no longer need
  the form prefix — they only have to be unique within the scope.

## Common mistakes

**Sharing one `coalesceKey` across all fields.** Don't:

```tsx
useUndoableState("", { coalesceKey: "form" });
useUndoableState("", { coalesceKey: "form" });
```

A keystroke burst on field A followed quickly by a keystroke burst on
field B would coalesce together, producing a confused entry where Ctrl+Z
half-reverts both fields. Always use distinct keys per field.

**Putting validation errors in `useUndoableState`.** Validation is
derived from values. Recompute it on render:

```tsx
const [email, setEmail] = useUndoableState("", { coalesceKey: "form:email" });
const emailError = validateEmail(email); // ← plain derivation, no hook
```

**Forgetting to clear after submit.** Without `clear()`, the user can
Ctrl+Z back into a state that no longer matches what's on the server.
Either `clear()` or remount the provider with a new `key`.

**Calling `useUndoableState`'s `reset()` for "reset to defaults" when
the user expects the reset itself to be undoable.** That tuple-slot
`reset` wipes the scope's history; use a transaction wrapper instead.

## See also

- [Recipe: Multi-Field Form With Shared Undo Stack](../ai/recipes#2-multi-field-form-with-shared-undo-stack)
- [Coalescing guide](./coalescing)
- [Transactions guide](./transactions)
- [Multi-Scope Routing guide](./multi-scope-routing)
