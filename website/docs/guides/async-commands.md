---
sidebar_position: 4
title: Async Commands
description: Server-backed actions, the pending state, single-flight semantics, and AbortSignal cancellation.
---

# Async Commands

`Command.do` / `redo` / `undo` may return a Promise. The store stays in
a `pending` state for the duration of the await, concurrent operations
are dropped, and `clear()` / `dispose()` cancel the in-flight work via an
`AbortSignal`.

```tsx
import { useAmnesia } from "react-amnesia";

export function ApplyServerThemeButton({
    next,
    current,
    api,
}: {
    next: "light" | "dark";
    current: "light" | "dark";
    api: { applyTheme: (value: "light" | "dark", init?: RequestInit) => Promise<void> };
}) {
    const { push, pending } = useAmnesia();

    return (
        <button
            disabled={pending}
            onClick={() =>
                push({
                    label: "Change theme",
                    redo: async (signal) => {
                        await api.applyTheme(next, { signal });
                    },
                    undo: async (signal) => {
                        await api.applyTheme(current, { signal });
                    },
                })
            }
        >
            Switch to {next}
        </button>
    );
}
```

## The `pending` flag

`useAmnesia().pending` is `true` while any async op is in flight. Use
this to disable the trigger UI so the user can't stack a second pending
op (the store is single-flight: a concurrent `push` / `undo` / `redo`
resolves to `null` and fires `onError({ phase: "busy" })`).

## Single-flight, not queued

Concurrent calls during an in-flight op are **dropped**, not queued. Two
clicks while one is pending will produce one history entry (the first)
and one busy error (the second). Drop-on-busy is a deliberate choice:
queueing would silently delay user actions in ways that hide ordering
bugs.

If you genuinely need to batch multiple steps into a single composite
entry, use a [transaction](./transactions).

## AbortSignal — honor it

Every async handler receives an `AbortSignal`. The signal aborts when:

- `clear()` runs on the scope
- `dispose()` runs on the store
- The provider unmounts

Pass it to `fetch`:

```tsx
push({
    redo: async (signal) => {
        const response = await fetch("/api/theme", { method: "POST", body, signal });
        if (!response.ok) throw new Error("server rejected");
    },
    // ...
});
```

A handler that throws **after** observing `signal.aborted` resolves
silently — no `onError` event, no log noise. The entry simply isn't
committed.

A handler that **ignores** the signal still drops its commit (epoch
check), but `onError({ phase: "stale" })` fires.

## Stale-drop semantics

If `clear()` runs while an async op is awaiting:

1. The signal aborts.
2. The handler either honors the signal (clean exit) or runs to completion
   (epoch mismatch).
3. Either way, no entry is committed.
4. If the handler ignored the signal, `onError({ phase: "stale" })` fires
   to surface the dropped work.

## Sync vs async — one API

A handler is async only if it returns a Promise. Sync handlers take a
single notify (no observable `pending: true` window) and behave identically
to v0.1 of the API. The choice is per-command, not per-store.

## See also

- [AI invariants — Async Commands](../ai/invariants#core-runtime-invariants)
- [AI invariants — Cancellation (AbortSignal)](../ai/invariants#cancellation-abortsignal)
- [Recipe: Async Command](../ai/recipes#10-async-command-server-backed-setting)
- [Recipe: Cancellable Async Command With AbortSignal](../ai/recipes#17-cancellable-async-command-with-abortsignal)
