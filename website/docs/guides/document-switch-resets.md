---
sidebar_position: 8
title: Document Switch Resets
description: Wipe history on document changes, route changes, logout — anywhere stale closures could replay against new state.
---

# Document Switch Resets

Switching documents leaves entries on the stack whose closures reference
the prior document's data. Replaying them is wrong. Use `clear()` on the
relevant scopes whenever the application's underlying state has changed
in a way that invalidates history.

## Per-scope clear

```tsx
import { useEffect } from "react";
import { useAmnesia } from "react-amnesia";

export function useDocumentReset(documentId: string) {
    const { clear } = useAmnesia();
    useEffect(() => {
        clear();
    }, [documentId, clear]);
}
```

`useAmnesia(scopeId).clear()` wipes only that scope. `useAmnesia()`
without an arg clears the active scope.

## Provider-wide clear

For multi-scope apps, you usually want to clear ALL scopes on a document
switch:

```tsx
import { useEffect } from "react";
import { useAmnesiaScopes } from "react-amnesia";

export function useFullReset(documentId: string) {
    const { clear } = useAmnesiaScopes();
    useEffect(() => {
        clear(); // no arg → every registered scope
    }, [documentId, clear]);
}
```

## Remount as the alternative

A clean alternative to imperative `clear()` is to remount the provider
with a `key`:

```tsx
<AmnesiaProvider key={documentId}>
    <DocumentEditor />
</AmnesiaProvider>
```

The previous `AmnesiaProvider` instance unmounts (its in-flight async
ops are aborted via the AbortSignal), and a fresh provider mounts with
empty stacks. Use this when scopes themselves should be reset (different
documents may want different scope sets); use imperative `clear()` when
the scope shape stays the same and you just want to wipe history.

## Logout

Auth-scoped data is a particularly important case. Closures may capture
user-specific tokens or ids. After logout, those references are stale
and likely also leak into your error tracker via `onError`. Always
`clear()` (or remount) on auth state change.

## Useful side effect: cancellation

`clear()` and `dispose()` abort every in-flight async op via the
[AbortSignal](./async-commands#abortsignal--honor-it). A document switch
mid-fetch automatically cancels the network call.

## See also

- [Recipe: Document Switch With `clear()`](../ai/recipes#6-document-switch-with-clear)
- [Anti-pattern: Replaying Stale Closures Across Document Switches](../ai/anti-patterns#replaying-stale-closures-across-document-switches)
- [Multi-Scope Routing guide](./multi-scope-routing)
