---
sidebar_position: 1
title: Keyboard Shortcuts
description: How <AmnesiaShortcuts /> binds Ctrl+Z / Cmd+Z and how to scope it to specific surfaces.
---

# Keyboard Shortcuts

`<AmnesiaShortcuts />` is the only built-in keyboard binding. Drop one
inside an `AmnesiaProvider` and the app gets standard undo / redo chords:

| Chord                          | Action |
| ------------------------------ | ------ |
| `Ctrl+Z` / `Cmd+Z`             | Undo   |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo   |
| `Ctrl+Y`                       | Redo   |

```tsx
import { AmnesiaProvider, AmnesiaShortcuts } from "react-amnesia";

export function App({ children }: { children: React.ReactNode }) {
    return (
        <AmnesiaProvider>
            <AmnesiaShortcuts />
            {children}
        </AmnesiaProvider>
    );
}
```

## Skipping native editables

By default, chords originating from a native editable element are
**ignored**. This includes text-like `<input>` types (for example `text`,
`email`, `search`, `tel`, `url`, `password`, and `number`), plus
`<textarea>`, `<select>`, and `contenteditable`. The browser's own undo
handles those, and stealing the chord usually breaks user expectations.
The check walks `event.composedPath()` so editables inside an open shadow
root (Lit / web components) are also recognized.

If you want to override that — e.g. inside a canvas region with no native
editables — opt out:

```tsx
<AmnesiaShortcuts skipEditableTargets={false} />
```

## Native menu integration

For Electron/Tauri edit menus (or any non-keyboard "Undo" trigger), use
`react-amnesia/native`:

```ts
import { dispatchNativeUndo, isNativeEditableElement } from "react-amnesia/native";

function handleUndoMenuClick() {
    if (isNativeEditableElement(document.activeElement)) {
        if (dispatchNativeUndo("undo")) return;
    }
    // Otherwise call your app-level amnesia undo.
}
```

## Disabling globally

For a modal that owns its own undo:

```tsx
<AmnesiaShortcuts enabled={modalIsOpen ? false : true} />
```

This is preferable to unmounting the component — toggling `enabled`
detaches and re-attaches the listener cleanly.

## Pinning to a target

`target` accepts:

- An `HTMLElement | Document | Window`
- The string aliases `"document"` or `"window"` (SSR-safe — they resolve
  inside `useEffect`)
- `null` to disable the listener entirely

```tsx
<AmnesiaShortcuts target="document" />
```

## Pinning to a scope

When the provider has multiple scopes ([multi-scope routing](./multi-scope-routing)),
the chord routes to the **active** scope by default. Pin it to a specific
scope with `scopeId`:

```tsx
<AmnesiaShortcuts scopeId="canvas" target={canvasRef.current} />
```

## Why `preventDefault` always fires

When the chord matches and shortcuts are not skipped, `event.preventDefault()`
fires whether or not an entry was actually undone. This is required because
async undo/redo cannot synchronously decide whether to suppress the
browser's native chord. If you want native fallback for empty stacks, set
`preventDefault={false}`.

## Skipping when defaultPrevented

Chords whose `event.defaultPrevented === true` are ignored — an upstream
handler already claimed them. `Alt`-modified chords are also ignored
(`Ctrl+Alt+Z` is not Undo).

## See also

- [AI invariants — Keyboard Shortcut Boundaries](../ai/invariants#keyboard-shortcut-boundaries)
- [Multi-Scope Routing guide](./multi-scope-routing)
