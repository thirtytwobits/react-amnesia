---
sidebar_position: 2
title: Quick Start
description: A five-line hello-world for application undo/redo.
---

# Quick Start

Wrap the part of your tree that should share an undo stack in
`AmnesiaProvider`, drop an `AmnesiaShortcuts` somewhere inside it for
keyboard bindings, then use `useUndoableState` for any value the user can
edit.

```tsx title="App.tsx"
import { AmnesiaProvider, AmnesiaShortcuts, useUndoableState } from "react-amnesia";

function TitleEditor() {
    const [title, setTitle] = useUndoableState("Untitled", {
        label: "Edit title",
        coalesceKey: "edit:title",
    });

    return <input value={title} onChange={(event) => setTitle(event.target.value)} />;
}

export default function App() {
    return (
        <AmnesiaProvider capacity={200}>
            <AmnesiaShortcuts />
            <TitleEditor />
        </AmnesiaProvider>
    );
}
```

`Ctrl+Z` / `Cmd+Z` undoes the last edit; `Ctrl+Shift+Z` / `Cmd+Shift+Z` /
`Ctrl+Y` redoes. Rapid keystrokes that share a `coalesceKey` collapse into a
single history entry, so a single undo reverts the entire burst.

## What just happened

- `AmnesiaProvider` set up an in-memory history store for everything inside
  it.
- `useUndoableState("Untitled", { label, coalesceKey })` returned a
  `[value, set, reset]` tuple. Calling `set(...)` updates the React state AND
  pushes a new history entry; the entry's `redo` re-applies the new value
  and its `undo` restores the previous one.
- `<AmnesiaShortcuts />` mounted a `keydown` listener on `window`. It
  routes Ctrl+Z to the active scope (here just the default scope) and
  ignores chords originating from native editable elements (`<input>`,
  `<textarea>`, `contenteditable`) so the browser's native input undo keeps
  working.
- `coalesceKey: "edit:title"` makes consecutive keystrokes within a few
  hundred milliseconds merge into one entry. A single Ctrl+Z reverts the
  whole burst rather than each character.

## Imperative commands

For actions that don't fit a single value (lists, graphs, transforms),
push commands directly:

```tsx
import { useAmnesia } from "react-amnesia";

function AddItemButton({ list }: { list: { add(item: Item): void; remove(id: string): void } }) {
    const { push } = useAmnesia();
    return (
        <button
            onClick={() => {
                const item = createItem();
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

`push(command)` calls `command.redo()` once on insertion. Pass
`{ applied: true }` when the call site has already mutated state itself.

## Persistence

When paired with `react-mnemonic`, `usePersistedUndoableState` reads and
writes the value through `useMnemonicKey` while still recording each user
edit on the local Amnesia stack:

```tsx
import { MnemonicProvider } from "react-mnemonic";
import { AmnesiaProvider, AmnesiaShortcuts } from "react-amnesia";
import { usePersistedUndoableState } from "react-amnesia/mnemonic";

function ThemePicker() {
    const { value, set } = usePersistedUndoableState<"light" | "dark">("theme", {
        defaultValue: "light",
        label: "Change theme",
    });
    return (
        <select value={value} onChange={(e) => set(e.target.value as "light" | "dark")}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
        </select>
    );
}

export default function App() {
    return (
        <MnemonicProvider namespace="my-app">
            <AmnesiaProvider>
                <AmnesiaShortcuts />
                <ThemePicker />
            </AmnesiaProvider>
        </MnemonicProvider>
    );
}
```

The undo stack itself is intentionally not persisted. Closures aren't
serializable, and replaying old commands against new state is usually the
wrong default. Reloads keep the latest value, but the history starts fresh
on each session.

## Where to go next

- [Keyboard Shortcuts guide](../guides/keyboard-shortcuts)
- [Coalescing guide](../guides/coalescing)
- [Imperative Commands guide](../guides/imperative-commands)
- [Multi-Scope Routing guide](../guides/multi-scope-routing) — for apps with
  several authoring surfaces (canvas + property panel etc.)
- [Async Commands guide](../guides/async-commands)
- [Transactions guide](../guides/transactions)
- [AI Docs](../ai) — canonical invariants for agent-assisted code
