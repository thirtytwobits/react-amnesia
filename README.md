# react-amnesia

AI-friendly application undo/redo (Ctrl+Z) for React.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE.md)

`react-amnesia` is a small, in-memory command-history store for React
applications. It manages an undo / redo stack and ships a `useState`-shaped
hook so any piece of state in your UI can become reversible. Like its sister
project [`react-mnemonic`](https://github.com/thirtytwobits/react-mnemonic), it
is designed to be **AI-first**: visible structure, unambiguous specifications,
and small, composable primitives that an agent can reason about without
guessing.

`react-amnesia` works well alongside `react-mnemonic` (so undoable state can
also survive page reloads) but does not require it.

## Installation

```bash
npm install react-amnesia
```

React 18 or 19 is required (`^18.0.0 || ^19.0.0`). The library is tested against both versions under `<StrictMode>`.

## Quick start

Wrap the part of your tree that should share an undo stack in
`AmnesiaProvider`, drop an `AmnesiaShortcuts` somewhere inside it for
keyboard bindings, then use `useUndoableState` for any value the user can
edit.

```tsx
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

## Why use it

- `useState`-shaped hook (`useUndoableState`) for reversible UI state
- Imperative `push({ redo, undo, label })` for arbitrary actions
- Coalescing for keystroke / drag bursts
- Capacity-bounded stack so history can't grow without limit
- Standard keyboard bindings via a single `<AmnesiaShortcuts />` element
- Optional `react-mnemonic` integration for persistence-aware undoables
- Zero runtime dependencies; published TypeScript types

## Pick the right entrypoint

| Entrypoint               | Use when                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `react-amnesia/core`     | Pure undo/redo runtime. No `react-mnemonic` dependency.                             |
| `react-amnesia/mnemonic` | You want `usePersistedUndoableState` to combine undo with `react-mnemonic` storage. |
| `react-amnesia`          | Top-level entrypoint that re-exports `core`. Drop-in default for most apps.         |

## Imperative commands

For actions that don't fit a single value (e.g. inserting / deleting list
items, mutating a graph, applying a transform), push commands directly.

```tsx
import { useAmnesia } from "react-amnesia";

function AddItemButton({ list }: { list: List }) {
    const { push } = useAmnesia();
    return (
        <button
            onClick={() => {
                const item = list.createItem();
                push({
                    label: "Add item",
                    redo: () => list.add(item),
                    undo: () => list.remove(item.id),
                });
            }}
        >
            Add
        </button>
    );
}
```

`push` calls `redo()` once on insertion. If your call site has already mutated
the application state, pass `{ applied: true }` to skip that initial run.

## Optional persistence

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

The undo **stack** itself is intentionally not persisted. Closures aren't
serializable, and replaying old commands against new state is usually the
wrong default. Reloads keep the latest value, but the history starts fresh on
each session.

## AI resources

| Resource                                                                                         | Purpose                                                                           |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [AI Docs](https://thirtytwobits.github.io/react-amnesia/docs/ai)                                 | Canonical invariants, decision matrix, recipes, anti-patterns, and setup guidance |
| [`llms.txt`](https://thirtytwobits.github.io/react-amnesia/llms.txt)                             | Compact retrieval index for tight context windows                                 |
| [`llms-full.txt`](https://thirtytwobits.github.io/react-amnesia/llms-full.txt)                   | Long-form export for indexing and larger prompt contexts                          |
| [`ai-contract.json`](https://thirtytwobits.github.io/react-amnesia/ai-contract.json)             | Machine-readable runtime contract for tooling and agent integrations              |
| [DeepWiki priorities](https://github.com/thirtytwobits/react-amnesia/blob/main/.devin/wiki.json) | Steering file that points DeepWiki toward the highest-signal sources              |
| [AI Assistant Setup](https://thirtytwobits.github.io/react-amnesia/docs/ai/assistant-setup)      | Generated instruction packs plus the documented MCP-friendly retrieval path       |

## Learn more

- [Documentation home](https://thirtytwobits.github.io/react-amnesia/)
- [Quick Start](https://thirtytwobits.github.io/react-amnesia/docs/getting-started/quick-start)
- [Keyboard Shortcuts](https://thirtytwobits.github.io/react-amnesia/docs/guides/keyboard-shortcuts)
- [Coalescing Bursts](https://thirtytwobits.github.io/react-amnesia/docs/guides/coalescing)
- [Imperative Commands](https://thirtytwobits.github.io/react-amnesia/docs/guides/imperative-commands)
- [Async Commands](https://thirtytwobits.github.io/react-amnesia/docs/guides/async-commands)
- [Transactions](https://thirtytwobits.github.io/react-amnesia/docs/guides/transactions)
- [Multi-Scope Routing](https://thirtytwobits.github.io/react-amnesia/docs/guides/multi-scope-routing)
- [DevTools](https://thirtytwobits.github.io/react-amnesia/docs/guides/devtools)
- [Error Handling](https://thirtytwobits.github.io/react-amnesia/docs/guides/error-handling)
- [API Reference](https://thirtytwobits.github.io/react-amnesia/docs/api)

## License

[MIT](./LICENSE.md)
