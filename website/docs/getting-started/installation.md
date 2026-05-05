---
sidebar_position: 1
title: Installation
description: Install react-amnesia and its peer dependencies.
---

# Installation

```bash
npm install react-amnesia
```

## Peer dependencies

- `react` `^18.0.0 || ^19.0.0`
- `react-dom` `^18.0.0 || ^19.0.0`
- `react-mnemonic` `>=1.5.0` — **optional**, only required if you import from `react-amnesia/mnemonic`

```bash
# Required:
npm install react react-dom

# Optional (for the persistence-aware bridge):
npm install react-mnemonic
```

## Entry points

| Import path              | Use when                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| `react-amnesia`          | Top-level entry point. Re-exports the core surface. Drop-in default.  |
| `react-amnesia/core`     | Pure undo/redo runtime. No `react-mnemonic` dependency.               |
| `react-amnesia/mnemonic` | `usePersistedUndoableState` for undoable state that survives reloads. |

## TypeScript

react-amnesia ships its own `.d.ts` files. No additional `@types/*` package
needed.

## Next

- [Quick Start](./quick-start) — five-line hello world plus the most common
  patterns
- [AI Docs](../ai) — canonical invariants, decision matrix, recipes
- [API Reference](../api) — every exported symbol
