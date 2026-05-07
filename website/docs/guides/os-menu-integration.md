---
sidebar_position: 11
title: OS Menu Integration (Tauri/Electron)
description: Wire native Edit-menu Undo/Redo to react-amnesia using DevTools registry + native editable helpers.
---

# OS Menu Integration (Tauri/Electron)

Use this guide when your app runs inside a desktop shell (Tauri/Electron)
and users expect the native **Edit > Undo/Redo** menu items to control your
history.

If your app is pure web, you usually only need
[`<AmnesiaShortcuts />`](./keyboard-shortcuts).

## Why this pattern

You need to handle two different targets:

- Native editable focus (`input`, `textarea`, etc.) should use the
  browser/native undo stack.
- Non-editable app focus should route to Amnesia undo/redo.

You also need menu enabled-state updates when:

- history changes (`canUndo`, `canRedo`, `pending`)
- focus changes (editable vs non-editable)

## Architecture

1. React mounts `AmnesiaProvider` with `enableDevTools` + stable
   `devToolsId`, and mounts `<AmnesiaShortcuts />`.
2. A tiny React bridge publishes `useAmnesiaLabels()` updates to `window`
   events for shell-side menu-state syncing.
3. Shell-side menu handlers resolve the provider from
   `getDevToolsRegistry().resolve(devToolsId)`.
4. On click:
    - if focus is native-editable, call `dispatchNativeUndo(...)`
    - otherwise call `triggerUndo` / `triggerRedo` on the provider api.

## React setup

```tsx
import { AmnesiaProvider, AmnesiaShortcuts, useAmnesiaLabels } from "react-amnesia";

function MenuStateBridge() {
    const labels = useAmnesiaLabels();

    React.useEffect(() => {
        window.dispatchEvent(
            new CustomEvent("amnesia:labels", {
                detail: labels,
            }),
        );
    }, [labels]);

    return null;
}

export function App() {
    return (
        <AmnesiaProvider enableDevTools devToolsId="editor">
            <AmnesiaShortcuts />
            <MenuStateBridge />
            {/* rest of app */}
        </AmnesiaProvider>
    );
}
```

## Tauri example (renderer-side menu wiring)

> API details vary slightly across Tauri versions. The integration pattern is
> the important part.

```ts
import { getDevToolsRegistry, type AmnesiaDevToolsProviderApi } from "react-amnesia";
import { dispatchNativeUndo, isNativeEditableElement } from "react-amnesia/native";
import { Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";

type Labels = {
    canUndo: boolean;
    canRedo: boolean;
    pending: boolean;
};

export async function installEditorMenu(devToolsId = "editor"): Promise<() => void> {
    const undoItem = await MenuItem.new({
        id: "edit.undo",
        text: "Undo",
        accelerator: "CmdOrCtrl+Z",
        action: () => {
            void onUndoClick();
        },
    });

    const redoItem = await MenuItem.new({
        id: "edit.redo",
        text: "Redo",
        accelerator: "CmdOrCtrl+Shift+Z",
        action: () => {
            void onRedoClick();
        },
    });

    const editMenu = await Submenu.new({
        text: "Edit",
        items: [undoItem, redoItem],
    });
    const menu = await Menu.new({ items: [editMenu] });
    await menu.setAsAppMenu();

    let latestLabels: Labels = { canUndo: false, canRedo: false, pending: false };

    const resolveProvider = (): AmnesiaDevToolsProviderApi | null => {
        const registry = getDevToolsRegistry();
        if (!registry) return null;
        return registry.resolve(devToolsId);
    };

    const refreshEnabledState = async () => {
        const editableFocused = isNativeEditableElement(document.activeElement);

        // If editable has focus, keep menu enabled so native undo/redo can run.
        if (editableFocused) {
            await undoItem.setEnabled(true);
            await redoItem.setEnabled(true);
            return;
        }

        // Otherwise drive enabled-state from Amnesia labels.
        await undoItem.setEnabled(latestLabels.canUndo && !latestLabels.pending);
        await redoItem.setEnabled(latestLabels.canRedo && !latestLabels.pending);
    };

    const onUndoClick = async () => {
        if (isNativeEditableElement(document.activeElement)) {
            if (dispatchNativeUndo("undo")) return;
        }

        const provider = resolveProvider();
        if (!provider) return;

        const snapshot = provider.getSnapshot();
        if (snapshot.pending || !snapshot.canUndo) return;

        await provider.triggerUndo();
    };

    const onRedoClick = async () => {
        if (isNativeEditableElement(document.activeElement)) {
            if (dispatchNativeUndo("redo")) return;
        }

        const provider = resolveProvider();
        if (!provider) return;

        const snapshot = provider.getSnapshot();
        if (snapshot.pending || !snapshot.canRedo) return;

        await provider.triggerRedo();
    };

    const onLabels = (event: Event) => {
        const custom = event as CustomEvent<Labels>;
        latestLabels = custom.detail;
        void refreshEnabledState();
    };

    // Focus changes can switch between native and Amnesia routing.
    const onFocus = () => {
        void refreshEnabledState();
    };

    window.addEventListener("amnesia:labels", onLabels as EventListener);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("focusout", onFocus);

    // Prime once at install.
    await refreshEnabledState();

    return () => {
        window.removeEventListener("amnesia:labels", onLabels as EventListener);
        window.removeEventListener("focusin", onFocus);
        window.removeEventListener("focusout", onFocus);
    };
}
```

## Electron note

The same approach works with Electron's `Menu` / `MenuItem`:

- build Undo/Redo items with accelerators
- use `isNativeEditableElement(document.activeElement)` +
  `dispatchNativeUndo(...)` fallback
- call resolved provider `triggerUndo` / `triggerRedo` when not editable
- refresh enabled state from `useAmnesiaLabels` bridge events + focus events

Only the menu construction API changes.

## Multi-window / multi-provider

- Use a unique `devToolsId` per window/provider (`editor:window-1`,
  `editor:window-2`, etc.).
- Install one menu bridge per window and resolve that window's provider id.
- Keep label events window-local to avoid cross-window enable-state bleed.

## Anti-patterns

- Firing shell-level global keyboard handlers that call `triggerUndo` while
  also mounting `<AmnesiaShortcuts />` (double dispatch risk).
- Ignoring focused native editable state (breaks expected input undo).
- Triggering `triggerUndo`/`triggerRedo` while `pending === true`.
- Forgetting teardown of focus/menu listeners when window/component unmounts.

## See also

- [Keyboard Shortcuts](./keyboard-shortcuts)
- [DevTools](./devtools)
- [Multi-Scope Routing](./multi-scope-routing)
