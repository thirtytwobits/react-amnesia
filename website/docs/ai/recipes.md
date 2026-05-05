---
sidebar_position: 4
title: Recipes
description: Canonical copy-pastable patterns for the most common undo/redo behaviors.
---

# Recipes

These recipes are intentionally compact and focus on undo/redo choices that
agents often get wrong under time pressure.

## 1. Reversible Single-Value Editor

```tsx
import { AmnesiaProvider, AmnesiaShortcuts, useUndoableState } from "react-amnesia";

function TitleEditor() {
    const [title, setTitle] = useUndoableState("Untitled", {
        label: "Edit title",
        coalesceKey: "edit:title",
    });

    return <input value={title} onChange={(event) => setTitle(event.target.value)} />;
}

export function App() {
    return (
        <AmnesiaProvider capacity={200}>
            <AmnesiaShortcuts />
            <TitleEditor />
        </AmnesiaProvider>
    );
}
```

Use when:

- a piece of state has a clean replacement value
- rapid typing should collapse into a single undo entry
- the surrounding `<AmnesiaShortcuts />` should drive Ctrl+Z / Cmd+Z

## 2. Coalesced Slider Drag

```tsx
import { useUndoableState } from "react-amnesia";

export function VolumeSlider() {
    const [volume, setVolume] = useUndoableState(50, {
        label: "Adjust volume",
        coalesceKey: "drag:volume",
    });

    return (
        <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
        />
    );
}
```

A slider can fire dozens of changes per second. The shared `coalesceKey`
collapses the whole drag into one history entry so a single Ctrl+Z restores
the pre-drag value.

## 3. Imperative List Mutation

```tsx
import { useAmnesia } from "react-amnesia";

type Item = { id: string; text: string };

export function AddItemButton({ list }: { list: { add: (item: Item) => void; remove: (id: string) => void } }) {
    const { push } = useAmnesia();

    return (
        <button
            onClick={() => {
                const item: Item = { id: crypto.randomUUID(), text: "New item" };
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

Use when:

- the change does not fit a single replacement value
- the inverse depends on data captured at the call site (here: the new item id)
- the calling code already mutated the underlying state, so `redo()` should not run on insertion

## 4. Persistence-Aware Editor

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
        <select value={value} onChange={(event) => set(event.target.value as "light" | "dark")}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
        </select>
    );
}

export function App() {
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

Use when:

- the value should survive reload
- changes should still be reversible while the user is on the page
- it is acceptable for the undo history to start empty after each reload

## 5. Document Switch With `clear()`

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

Use when the application switches between documents or workspaces. The closures
captured by previous entries probably reference the prior document's state;
`clear()` drops both stacks without invoking them.

## 6. Modal Owns Its Own Keybindings

```tsx
import { useState } from "react";
import { AmnesiaShortcuts } from "react-amnesia";

export function ColorPickerModal({ open }: { open: boolean }) {
    const [scopedHistory] = useState(() => [/* ... */]);
    return (
        <>
            <AmnesiaShortcuts enabled={!open} />
            {open ? <ColorPickerWithItsOwnUndo history={scopedHistory} /> : null}
        </>
    );
}
```

Use when a modal has its own undo semantics (e.g. a color picker with its own
preview history) and the global shortcuts must yield while it is open.
Toggling `enabled` is preferable to unmounting the component.

## 7. Surface-Scoped Shortcut Binding

```tsx
import { useRef, type RefObject } from "react";
import { AmnesiaShortcuts } from "react-amnesia";

export function CanvasRegion() {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div ref={ref} tabIndex={0} style={{ outline: "none" }}>
            <AmnesiaShortcuts target={ref.current} skipEditableTargets={false} />
            {/* ...canvas... */}
        </div>
    );
}
```

Use when only a specific surface should respond to undo / redo chords. Setting
`skipEditableTargets` to `false` is appropriate here because the canvas
region is not a native editable target.

## 8. Reversible Multi-Key Persisted Action

```tsx
import { useMnemonicKey } from "react-mnemonic";
import { useAmnesia } from "react-amnesia";

export function ApplyPresetButton({ preset }: { preset: { theme: "light" | "dark"; density: "comfy" | "compact" } }) {
    const theme = useMnemonicKey<"light" | "dark">("theme", { defaultValue: "light" });
    const density = useMnemonicKey<"comfy" | "compact">("density", { defaultValue: "comfy" });
    const { push } = useAmnesia();

    return (
        <button
            onClick={() => {
                const previousTheme = theme.value;
                const previousDensity = density.value;
                theme.set(preset.theme);
                density.set(preset.density);
                push(
                    {
                        label: "Apply preset",
                        redo: () => {
                            theme.set(preset.theme);
                            density.set(preset.density);
                        },
                        undo: () => {
                            theme.set(previousTheme);
                            density.set(previousDensity);
                        },
                    },
                    { applied: true },
                );
            }}
        >
            Apply
        </button>
    );
}
```

Use when one user action mutates several persisted keys and the inverse must
restore them as a unit. `usePersistedUndoableState` covers single keys; this
pattern handles compound, atomic actions.

## 9. Async Command (Server-Backed Setting)

```tsx
import { useAmnesia } from "react-amnesia";

type ServerSettings = { theme: "light" | "dark" };

export function ApplyServerThemeButton({
    next,
    current,
    api,
}: {
    next: ServerSettings["theme"];
    current: ServerSettings["theme"];
    api: { applyTheme: (value: ServerSettings["theme"]) => Promise<void> };
}) {
    const { push, pending } = useAmnesia();

    return (
        <button
            disabled={pending}
            onClick={async () => {
                const id = await push({
                    label: "Change theme",
                    redo: () => api.applyTheme(next),
                    undo: () => api.applyTheme(current),
                });
                if (id === null) {
                    // Either another op was in flight (busy) or clear() raced
                    // the await (stale). Either way the entry was dropped.
                }
            }}
        >
            {pending ? "Applying…" : `Switch to ${next}`}
        </button>
    );
}
```

Use when:

- the inverse must talk to a server before the user can move on
- the UI should disable affordances during the in-flight window (`pending`)
- a concurrent click should not stack a second pending op (single-flight)

The handler returning a Promise causes the store to flip `pending: true` for
the duration of the await. Subscribers see the busy state synchronously.

## 10. Divergent First-Apply With `Command.do`

```tsx
import { useAmnesia } from "react-amnesia";

type Node = { id: string; text: string };

export function InsertNodeButton({
    list,
    text,
}: {
    text: string;
    list: { add: (node: Node) => void; restore: (id: string) => void; remove: (id: string) => void };
}) {
    const { push } = useAmnesia();

    return (
        <button
            onClick={() => {
                // First-apply mints the new node id. Redo-after-undo reuses the
                // existing id via `restore` rather than minting a new one.
                let mintedId: string | null = null;
                push({
                    label: "Insert node",
                    do: () => {
                        const node = { id: crypto.randomUUID(), text };
                        mintedId = node.id;
                        list.add(node);
                    },
                    redo: () => {
                        if (mintedId) list.restore(mintedId);
                    },
                    undo: () => {
                        if (mintedId) list.remove(mintedId);
                    },
                });
            }}
        >
            Insert
        </button>
    );
}
```

Use when:

- the initial application has effects that should not repeat on a redo replay
- the inverse needs a stable identity captured at first-apply (here, `mintedId`)
- the caller wants the entry to participate in normal redo cycles after the first apply

`do` runs once at push time. Subsequent redos always invoke `command.redo`.

## 11. Multi-Scope Authoring App

```tsx
import {
    AmnesiaProvider,
    AmnesiaShortcuts,
    useAmnesiaFocusClaim,
    useAmnesiaScopes,
    useUndoableState,
} from "react-amnesia";

function CanvasArea() {
    const claim = useAmnesiaFocusClaim("canvas");
    const [strokes, setStrokes] = useUndoableState<string[]>([], {
        scopeId: "canvas",
        label: "Add stroke",
    });
    return (
        <section tabIndex={-1} {...claim}>
            <p>{strokes.length} strokes</p>
            <button onClick={() => setStrokes((s) => [...s, "stroke"])}>Add stroke</button>
        </section>
    );
}

function PropertyPanel() {
    const claim = useAmnesiaFocusClaim("props");
    const [title, setTitle] = useUndoableState("Untitled", {
        scopeId: "props",
        coalesceKey: "edit:title",
    });
    return (
        <aside tabIndex={-1} {...claim}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </aside>
    );
}

function Breadcrumb() {
    const { activeScopeId } = useAmnesiaScopes();
    return <span>Editing: {activeScopeId}</span>;
}

export function App() {
    return (
        <AmnesiaProvider scopes={{ canvas: { capacity: 1000 }, props: { capacity: 100 } }}>
            <AmnesiaShortcuts />
            <Breadcrumb />
            <CanvasArea />
            <PropertyPanel />
        </AmnesiaProvider>
    );
}
```

Use when:

- two or more long-lived authoring surfaces share one window
- Ctrl+Z should affect whichever surface the user just touched
- different surfaces want different capacities or coalesce settings
- a "now editing: X" breadcrumb helps the user understand what undo will do

The single `<AmnesiaShortcuts />` routes Ctrl+Z to the active scope. Each
surface owns its own history; clicking into one shifts the active claim.
Both `useUndoableState` calls pin to their scope so React state never moves
between scopes when the user's focus shifts.

## 12. Transaction (Multi-Step Composite Entry)

```tsx
import { useAmnesia } from "react-amnesia";

type Document = { title: string; tags: string[]; updatedAt: number };
type DocStore = {
    setTitle: (next: string) => void;
    addTag: (tag: string) => void;
    setUpdatedAt: (ms: number) => void;
    snapshot: () => Document;
};

export function ApplyPresetButton({ store: doc }: { store: DocStore }) {
    const { transaction, pending } = useAmnesia();

    const apply = async () => {
        const before = doc.snapshot();
        await transaction("Apply preset", async (tx) => {
            await tx.push({
                redo: () => doc.setTitle("Untitled (preset)"),
                undo: () => doc.setTitle(before.title),
            });
            await tx.push({
                redo: () => doc.addTag("preset"),
                undo: () => doc.setTitle(before.title), // restored once via title path
            });
            await tx.push({
                redo: () => doc.setUpdatedAt(Date.now()),
                undo: () => doc.setUpdatedAt(before.updatedAt),
            });
        });
    };

    return (
        <button disabled={pending} onClick={apply}>
            Apply preset
        </button>
    );
}
```

Use when:

- one user-visible action touches several pieces of state
- a single Ctrl+Z should reverse the whole bundle
- some of the steps may be async (server calls, IndexedDB writes)
- the user expects the action to be atomic — partial application is wrong

If the `work` function throws or rejects, every buffered undo runs in
reverse before the rejection propagates. `clear()` or `dispose()` during the
await stales the transaction the same way.

## 13. Telemetry With Lifecycle Hooks + `metaTransform`

```tsx
import { AmnesiaProvider, AmnesiaShortcuts } from "react-amnesia";
import { logEvent } from "./analytics";

const REDACT = new Set(["authToken", "userEmail", "ssn"]);

export function App({ children }: { children: React.ReactNode }) {
    return (
        <AmnesiaProvider
            metaTransform={(meta) => {
                const safe: Record<string, unknown> = {};
                for (const key of Object.keys(meta)) {
                    if (!REDACT.has(key)) safe[key] = meta[key];
                }
                return safe;
            }}
            onPush={(entry, scopeId) => logEvent("undo.push", { scopeId, entryId: entry.id, label: entry.label, meta: entry.meta })}
            onUndo={(entry, scopeId) => logEvent("undo.undo", { scopeId, entryId: entry.id })}
            onRedo={(entry, scopeId) => logEvent("undo.redo", { scopeId, entryId: entry.id })}
            onClear={(scopeId) => logEvent("undo.clear", { scopeId })}
        >
            <AmnesiaShortcuts />
            {children}
        </AmnesiaProvider>
    );
}
```

Use when:

- you want analytics on undo behaviour without tangling them into every push
  call site
- some `meta` fields are sensitive and must be redacted before leaving the
  store
- different scopes deserve different telemetry — pair `onPush` per-scope via
  `scopes={{ canvas: { onPush: ... } }}`

`metaTransform` runs everywhere `meta` is exposed: hook payloads AND the
public snapshot. Telemetry handlers and history-list UI both see the
sanitized form. A throwing transform safely strips `meta` rather than
leaking unsanitized values.

## 14. Custom Error Reporting

```tsx
import { AmnesiaProvider, AmnesiaShortcuts } from "react-amnesia";
import * as Sentry from "@sentry/react";

export function App({ children }: { children: React.ReactNode }) {
    return (
        <AmnesiaProvider
            capacity={300}
            onError={(error, context) => {
                Sentry.captureException(error, { tags: { phase: context.phase, label: context.label ?? "" } });
            }}
        >
            <AmnesiaShortcuts />
            {children}
        </AmnesiaProvider>
    );
}
```

Use when failing inverses should reach an error tracker. Remember that throwing
from the handler is caught and ignored — the handler must complete successfully.

## 15. History Breadcrumb UI

```tsx
import { useAmnesia } from "react-amnesia";

export function HistoryBreadcrumb() {
    const { past, future } = useAmnesia();
    return (
        <ol>
            {past.map((entry) => (
                <li key={entry.id}>{entry.label ?? `entry-${entry.id}`}</li>
            ))}
            {future.map((entry) => (
                <li key={entry.id} aria-disabled="true">
                    {entry.label ?? `entry-${entry.id}`}
                </li>
            ))}
        </ol>
    );
}
```

Use when the UI needs to display the history. Snapshots are referentially
stable until the next mutation, so React's render bailout works without extra
memoization.
