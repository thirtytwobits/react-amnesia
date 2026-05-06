---
sidebar_position: 11
title: Error Handling
description: How onError works, the phases, the rollback contract, and how to forward to your tracker.
---

# Error Handling

The store has a single `onError` hook that fires for every operation
phase that goes wrong. Errors are **microtask-deferred** — handlers fire
on a tick after the failing op settles, so a handler that calls
`push` / `undo` / `redo` re-entrantly always sees a quiescent store.

```tsx
import { AmnesiaProvider } from "react-amnesia";
import * as Sentry from "@sentry/react";

export function App({ children }: { children: React.ReactNode }) {
    return (
        <AmnesiaProvider
            onError={(error, ctx) => {
                Sentry.captureException(error, {
                    tags: {
                        phase: ctx.phase,
                        recoverable: String(ctx.recoverable ?? false),
                        label: ctx.label ?? "",
                    },
                });
            }}
        >
            {children}
        </AmnesiaProvider>
    );
}
```

## Phases

| Phase        | When                                                          | Recoverable? | Entry effect                                 |
| ------------ | ------------------------------------------------------------- | ------------ | -------------------------------------------- |
| `"push"`     | A command's `do` / `redo` threw on initial application.       | No           | Entry not added; original error rethrown.    |
| `"undo"`     | The entry's `undo()` threw.                                   | Yes          | Entry stays in place; the user can retry.    |
| `"redo"`     | The entry's `redo()` threw.                                   | Yes          | Entry stays in place.                        |
| `"busy"`     | Concurrent op while another was in flight.                    | Yes          | Op resolves to `null`; retry after pending.  |
| `"stale"`    | `clear()` / `dispose()` ran during the await, signal ignored. | No           | Op resolves to `null`; entry dropped.        |
| `"rollback"` | A buffered transaction undo threw during rollback.            | No           | One per failure. Original error still fires. |

## Failed undo / redo leaves the entry

When an entry's `undo()` or `redo()` throws, the entry is **not** removed
from its stack. The application can decide whether to retry, surface a
toast, or call `clear()` on the scope. This is intentional — silent
removal would lose the user's ability to recover the state.

## Rollback errors

A transaction that throws inside its `work` function rolls back every
buffered undo in reverse. If one of those undos itself throws, you get a
`phase: "rollback"` error per failure. The original `work` error still
propagates to the caller.

## Default behavior

Without an `onError` prop, the default handler logs to `console.error`
with the prefix `[Amnesia]`. Useful in development; usually replaced for
production.

## Throwing from the handler

If your `onError` handler throws, the throw is **caught and ignored**.
The store stays consistent. Don't rely on a thrown handler to surface
failures upstream.

## AbortError vs real error

A handler that observes `signal.aborted` and rejects (e.g. with an
`AbortError`-shaped error) is treated as a **silent no-op**. No `onError`
fires. The entry is dropped. This is the cancellation path — see the
[Async Commands guide](./async-commands).

## Per-scope override

You can give different scopes different handlers:

```tsx
<AmnesiaProvider
    onError={defaultHandler}
    scopes={{
        canvas: { onError: canvasHandler },
        props: { onError: propsHandler },
    }}
>
```

Per-scope wins over provider-level when both are set.

## See also

- [AI invariants — Lifecycle Hooks](../ai/invariants#lifecycle-hooks)
- [Recipe: Custom Error Reporting](../ai/recipes#19-custom-error-reporting)
- [Async Commands guide](./async-commands)
- [Transactions guide](./transactions)
