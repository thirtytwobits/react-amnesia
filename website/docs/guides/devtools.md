---
sidebar_position: 10
title: DevTools
description: Inspect and drive a live store from external tooling, browser extensions, or AI agents.
---

# DevTools

`<AmnesiaProvider enableDevTools>` registers the provider with
`window.__REACT_AMNESIA_DEVTOOLS__`. External tooling can resolve the
provider by id and call its inspection api — read scope state, trigger
undo / redo, dump everything — without touching application code.

```tsx
<AmnesiaProvider enableDevTools={import.meta.env.DEV} devToolsId="my-app">
    {children}
</AmnesiaProvider>
```

Then anywhere with `window` access:

```ts
const registry = window.__REACT_AMNESIA_DEVTOOLS__;
if (registry) {
    const probe = registry.resolve("my-app");
    if (probe) {
        console.table(probe.dump());
        await probe.triggerUndo();
        probe.clear("draft");
    }
}
```

## Opt-in by design

The registry is **lazy-installed**. When no provider sets
`enableDevTools`, the global is never created and the registry-side
machinery stays cold. You can ship `enableDevTools={import.meta.env.DEV}`
(Vite) or `enableDevTools={process.env.NODE_ENV !== "production"}` to
gate it behind a build-time env flag.

## Inspection api

The api a provider exposes:

| Method                     | Returns                                          |
| -------------------------- | ------------------------------------------------ |
| `id`                       | The id under which the provider is registered.   |
| `getActiveScopeId()`       | The current active scope.                        |
| `scopes()`                 | All registered scope ids.                        |
| `getSnapshot(scopeId?)`    | Snapshot for one scope (active by default).      |
| `pastSnapshot(scopeId?)`   | Just the past entries.                           |
| `futureSnapshot(scopeId?)` | Just the future entries.                         |
| `dump()`                   | `Record<scopeId, AmnesiaState>` for every scope. |
| `triggerUndo(scopeId?)`    | Async — returns the undone entry id, or `null`.  |
| `triggerRedo(scopeId?)`    | Async.                                           |
| `clear(scopeId?)`          | Clear one scope, or every scope when omitted.    |

## Pinning ids vs auto-generated

- `devToolsId="my-app"` registers under that exact id. Recommended for
  production-shaped builds where external tooling expects a known name.
- Omit `devToolsId` and the provider gets an auto-generated id like
  `amnesia-1`. Stable across re-renders within the component instance.

## WeakRef behavior

Provider entries are held weakly via `WeakRef` when available. A
long-lived registry never prevents an unmounted provider from being
garbage-collected. `resolve(id)` returns `null` for GC'd entries.

`__meta.version` bumps on every register / unregister so a polling
extension can detect changes without re-resolving.

## What it is NOT

The registry is for **inspection** — diagnostics, telemetry, agent
introspection. It is NOT a substitute for `useAmnesia()` snapshots inside
React components. UI state should subscribe normally; treat the registry
as an external observer.

## Don't ship it on by default

Anything the registry exposes is reachable from arbitrary user code. If
your `meta` payloads carry sensitive data, gate `enableDevTools` to dev
builds AND/OR set `metaTransform` on the provider so even a leaked
registry surface returns redacted state.

## See also

- [AI invariants — DevTools Registry](../ai/invariants#devtools-registry)
- [Recipe: Wiring DevTools For Agent / Extension Introspection](../ai/recipes#17-wiring-devtools-for-agent--extension-introspection)
- [Anti-pattern: Leaving DevTools Enabled In Production](../ai/anti-patterns#leaving-devtools-enabled-in-production)
