---
sidebar_position: 9
title: Optional Persistence
description: Combine react-amnesia with react-mnemonic for undoable state that survives reloads.
---

# Optional Persistence

The undo stack itself is intentionally **not** persisted. Closures aren't
serializable, and replaying old commands against new application state is
usually wrong.

What CAN survive reloads is the underlying **value**. Pair `react-amnesia`
with `react-mnemonic` and use `usePersistedUndoableState`:

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

## What persists vs what doesn't

| Crosses a reload? | What                                                       |
| ----------------- | ---------------------------------------------------------- |
| ✅ Yes            | The current value (via `react-mnemonic`'s storage adapter) |
| ❌ No             | The undo / redo history (closures are not serializable)    |
| ❌ No             | The active scope claim                                     |
| ❌ No             | Lifecycle hook subscriptions                               |

After a reload the user sees their last value; the history starts empty.

## Shape of the result

`usePersistedUndoableState` returns:

| Field          | Behavior                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| `value`        | The current persisted value.                                                       |
| `set(next)`    | Updates the value (via mnemonic) AND pushes an undoable entry.                     |
| `reset(next?)` | Clears the bound history scope AND restores via mnemonic. Composite. Not undoable. |
| `remove()`     | Deletes the persisted key entirely AND clears the bound history scope.             |

`reset()` and `remove()` are both **scope-wide** wipes — they clear every
entry in the bound scope, not just this hook's value.

## Where things live

- `AmnesiaProvider` owns the in-memory history.
- `MnemonicProvider` (from `react-mnemonic`) owns the durable storage.
- Both must be ancestors of any component that calls
  `usePersistedUndoableState`.

## When to NOT use this

- If the value should NOT survive reloads (transient UI state) — use
  `useUndoableState` directly.
- If the value should survive reloads but should NOT be undoable — use
  `useMnemonicKey` from `react-mnemonic` directly.

## See also

- [Recipe: Persistence-Aware Editor](../ai/recipes#5-persistence-aware-editor)
- [react-mnemonic docs](https://thirtytwobits.github.io/react-mnemonic/)
