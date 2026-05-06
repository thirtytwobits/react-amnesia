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

## 2. Multi-Field Form With Shared Undo Stack

Multiple `useUndoableState` hooks in the **same scope** share one
undo/redo stack automatically. A single Ctrl+Z reverts whichever field
was edited most recently, regardless of which hook produced it. The
default scope is `"default"`, so just omitting `scopeId` everywhere is
enough.

```tsx
import { AmnesiaProvider, AmnesiaShortcuts, useAmnesia, useUndoableState } from "react-amnesia";

function ProfileForm() {
    const [name, setName, resetName] = useUndoableState("", {
        label: "Edit name",
        coalesceKey: "form:profile:name",
    });
    const [email, setEmail, resetEmail] = useUndoableState("", {
        label: "Edit email",
        coalesceKey: "form:profile:email",
    });
    const [bio, setBio, resetBio] = useUndoableState("", {
        label: "Edit bio",
        coalesceKey: "form:profile:bio",
    });

    // All three setters above push entries onto the same default-scope stack.
    // Ctrl+Z reverts the most recent edit, regardless of which field it was.
    const { transaction, clear } = useAmnesia();

    const reset = () => {
        // Reset each field. We use a transaction so the whole form-clear
        // collapses into ONE undoable composite entry — Ctrl+Z restores
        // every field at once.
        void transaction("Reset profile form", async (tx) => {
            const previous = { name, email, bio };
            await tx.push({
                redo: () => {
                    resetName();
                    resetEmail();
                    resetBio();
                },
                undo: () => {
                    setName(previous.name);
                    setEmail(previous.email);
                    setBio(previous.bio);
                },
            });
        });
    };

    const submit = async () => {
        await api.saveProfile({ name, email, bio });
        // After a successful submit, history of pre-submit edits is no longer
        // meaningful — the server has accepted them.
        clear();
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
        >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" />
            <button type="submit">Save</button>
            <button type="button" onClick={reset}>
                Reset
            </button>
        </form>
    );
}

export default function App() {
    return (
        <AmnesiaProvider>
            <AmnesiaShortcuts />
            <ProfileForm />
        </AmnesiaProvider>
    );
}
```

Use when:

- a form has several fields and the user expects one Ctrl+Z to reverse
  the last typing burst, no matter which field they were in
- "Reset" should be an atomic undoable action (one Ctrl+Z restores
  everything at once)
- "Submit" should retire the pre-submit history (no point letting the
  user undo edits that have already been persisted)

### Form-state hygiene

What goes in `useUndoableState` vs plain `useState`:

| State                                     | Hook                          | Why                                                    |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| User-authored field values                | `useUndoableState`            | The thing the user types is what they want to undo.    |
| Validation errors / "is this field valid" | `useState`                    | Derived. Recomputed from values on every render.       |
| "Submit in flight" / loading              | `useState`                    | Ephemeral; meaningless after the request settles.      |
| `currentStep` in a wizard                 | `useState`                    | Navigation isn't an edit; Ctrl+Z shouldn't move pages. |
| Server response cache                     | `useState` or your data layer | Not user input; not undoable.                          |

If you find yourself reaching for "but should we undo the validation
state too?" — no. Validation is a function of the value. Undo the value;
validation re-derives.

### Per-field `coalesceKey` is essential

Without it, every keystroke is its own entry — typing "hello" produces
five undo entries. With per-field `coalesceKey`, all five collapse into
one entry per **logical edit burst**.

The keys must be **distinct per field**. Don't share `coalesceKey: "form"`
across name + email — typing in name then immediately in email would
weirdly merge. Namespace them: `"form:profile:name"`, `"form:profile:email"`.

When the user pauses for longer than `coalesceWindowMs` (default 400ms),
the next keystroke creates a fresh entry. That's usually the right
checkpoint cadence for typing.

### When to use a separate scope

If the form is one part of a larger app that has its own undo (e.g. a
canvas in the same page), put the form in its own scope so Ctrl+Z while
the form is focused doesn't accidentally revert canvas state — and vice
versa:

```tsx
function ProfileForm() {
    const claim = useAmnesiaFocusClaim("form");
    const [name, setName] = useUndoableState("", {
        scopeId: "form",
        coalesceKey: "form:profile:name",
    });
    // ... other fields all with scopeId: "form"

    return (
        <section tabIndex={-1} {...claim}>
            {/* ...inputs... */}
        </section>
    );
}
```

The pattern: every `useUndoableState` in the form pins to `scopeId: "form"`,
and a `useAmnesiaFocusClaim("form")` on the form's outer container makes
Ctrl+Z route there while the user is typing. Other surfaces in the app
get their own scopes.

## 3. Coalesced Slider Drag

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

## 4. Imperative List Mutation

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

## 5. Persistence-Aware Editor

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

## 6. Document Switch With `clear()`

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

## 7. Modal Owns Its Own Keybindings

```tsx
import { useState } from "react";
import { AmnesiaShortcuts } from "react-amnesia";

export function ColorPickerModal({ open }: { open: boolean }) {
    const [scopedHistory] = useState(() => [
        /* ... */
    ]);
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

## 8. Surface-Scoped Shortcut Binding

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

## 9. Web-Component / Shadow-DOM Editable

```tsx
import { AmnesiaShortcuts } from "react-amnesia";

// A Lit / web-component editor renders an <input> inside its shadow root.
// `<my-rich-editor>` exposes the input only inside `mode: "open"` shadow.
export function App() {
    return (
        <>
            <AmnesiaShortcuts target="document" />
            <my-rich-editor />
        </>
    );
}
```

Use when:

- the app embeds web components (Lit, Stencil, FAST, custom elements) that
  contain native editables inside their open shadow root
- you want the browser's native undo to keep working inside those editables
  without disabling app-level Ctrl+Z entirely

`<AmnesiaShortcuts />` walks `event.composedPath()` to detect editables
across shadow boundaries, so a chord originating in the shadow-DOM input
is correctly skipped under the default `skipEditableTargets={true}`.
Closed shadow roots (`mode: "closed"`) are intentionally opaque — the
host author has chosen to hide them, and `composedPath` reflects that.

## 10. Reversible Multi-Key Persisted Action (Pre-Transactions Pattern)

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

## 11. Async Command (Server-Backed Setting)

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

## 12. Divergent First-Apply With `Command.do`

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

## 13. Multi-Scope Authoring App

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

## 14. Transaction (Multi-Step Composite Entry)

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

## 15. Telemetry With Lifecycle Hooks + `metaTransform`

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
            onPush={(entry, scopeId) =>
                logEvent("undo.push", { scopeId, entryId: entry.id, label: entry.label, meta: entry.meta })
            }
            onAmend={(entry, scopeId) =>
                logEvent("undo.amend", { scopeId, entryId: entry.id, label: entry.label, meta: entry.meta })
            }
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

## 16. Discard-Changes With `reset`

```tsx
import { useUndoableState } from "react-amnesia";

export function DraftEditor() {
    const [draft, setDraft, resetDraft] = useUndoableState("", {
        label: "Edit draft",
        coalesceKey: "edit:draft",
    });

    return (
        <div>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button onClick={() => resetDraft()}>Discard changes</button>
            <button onClick={() => resetDraft(loadServerTemplate())}>Load template</button>
        </div>
    );
}

function loadServerTemplate(): string {
    return "Subject: …\n\nDear …";
}
```

Use when:

- the UI needs an explicit "throw away the work I did" button
- "load preset" / "load template" should snap to a known starting value
  rather than appearing in the undo stack
- the rest of the surrounding scope's history should also be wiped (a
  fresh-document UX)

`reset()` clears the history scope synchronously and writes the new value
in the same microtask. There is no entry to undo back to the pre-reset
state — that is the point. If you want the discard to itself be undoable,
push a normal command instead.

## 17. Wiring DevTools For Agent / Extension Introspection

```tsx
import { AmnesiaProvider, AmnesiaShortcuts } from "react-amnesia";

export function App({ children }: { children: React.ReactNode }) {
    return (
        <AmnesiaProvider enableDevTools={import.meta.env.DEV} devToolsId="my-app">
            <AmnesiaShortcuts />
            {children}
        </AmnesiaProvider>
    );
}
```

External code can then introspect or drive the store:

```ts
const registry = window.__REACT_AMNESIA_DEVTOOLS__;
if (registry) {
    const probe = registry.resolve("my-app");
    if (probe) {
        console.table(probe.dump()); // every scope's snapshot
        await probe.triggerUndo(); // drive an undo
        probe.clear("draft"); // wipe a scope
    }
}
```

Use when:

- a browser extension or external CLI needs to observe state without
  consuming React context
- an AI agent should be able to query "what's on the stack" without reading
  source
- you want a debug surface that toggles on in development and is absent in
  production builds (gate via your bundler's env flag)

The registry is **opt-in**: when no provider sets `enableDevTools`, no
global is created. When enabled, provider entries are held weakly so the
registry never prevents an unmounted provider from being garbage-collected.

## 18. Cancellable Async Command With AbortSignal

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
            onClick={async () => {
                await push({
                    label: "Change theme",
                    redo: async (signal) => {
                        // Pass the signal to fetch so a clear() / dispose()
                        // mid-flight cancels the network call cleanly.
                        await api.applyTheme(next, { signal });
                    },
                    undo: async (signal) => {
                        await api.applyTheme(current, { signal });
                    },
                });
            }}
        >
            Switch to {next}
        </button>
    );
}
```

Use when:

- the handler does a network call or other cancellable async work
- you want `clear()` / `dispose()` to cancel mid-flight cleanly without a
  spurious `onError` log
- the call is part of a transaction whose `work` already receives a
  signal — pass that signal through to every command and `fetch`

A handler that honors the signal and rejects with an `AbortError`-shaped
error after `signal.aborted === true` produces a silent no-op: no
`onError` event, the entry is dropped. A handler that ignores the signal
still drops the commit via the epoch check, but `onError({ phase: "stale" })`
fires.

## 19. Custom Error Reporting

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

## 20. History Breadcrumb UI

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
