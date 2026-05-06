---
sidebar_position: 6
title: AI Assistant Setup
description: How to expose react-amnesia's canonical docs to coding assistants and MCP-based tooling.
---

# AI Assistant Setup

This page explains how users and agent builders should expose `react-amnesia`
to coding assistants.

## Canonical Source

The canonical AI-oriented source is this docs section:

- `/docs/ai`
- `/docs/ai/invariants`
- `/docs/ai/decision-matrix`
- `/docs/ai/recipes`
- `/docs/ai/anti-patterns`

Everything else is a companion surface:

- repository instruction packs for Codex, Claude Code, Cursor, and Copilot

## Generated Instruction Packs

The repo also ships first-party instruction packs generated from the canonical
AI docs:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/rules/react-amnesia-undo.md`
- `.claude/rules/decision-checklist.md`
- `.cursor/rules/react-amnesia-undo.mdc`
- `.cursor/rules/react-amnesia-docs.mdc`
- `.github/copilot-instructions.md`
- `.github/instructions/react-amnesia-undo.instructions.md`
- `.github/instructions/react-amnesia-docs.instructions.md`

Those files are projections over the same undo/redo contract rather than
independent sources of truth.

## Lowest-Friction Retrieval

When an assistant has only HTTP or filesystem access, give it these paths
first:

1. `website/docs/ai/index.md`
2. `website/docs/ai/invariants.md`
3. `website/docs/ai/decision-matrix.md`
4. `website/docs/ai/recipes.md`
5. `website/docs/ai/anti-patterns.md`

That ordering keeps the first context window compact while still leaving the
recipes and anti-patterns available when the task is more complex.

## Validated MCP-Friendly Path

The lowest-friction MCP setup is exposing this repository through a
filesystem-capable MCP server or any equivalent local-docs MCP layer.

Mount these paths:

- `website/docs/ai/index.md`
- `website/docs/ai/invariants.md`
- `website/docs/ai/decision-matrix.md`
- `website/docs/ai/recipes.md`
- `website/docs/ai/anti-patterns.md`
- `src/Amnesia/history.ts`
- `src/Amnesia/provider.tsx`
- `src/Amnesia/use.ts`
- `src/Amnesia/use-undoable-state.ts`
- `src/Amnesia/shortcuts.tsx`
- `src/Amnesia/types.ts`
- `src/mnemonic.ts`

This gives an MCP client both the compact docs surfaces and the source files
that define the contract underneath them.

## Sister Library

`react-amnesia` is the sister project of
[`react-mnemonic`](https://thirtytwobits.github.io/react-mnemonic/), which
handles persistent state. The optional `react-amnesia/mnemonic` bridge is the
only place the two projects depend on each other directly. When a task spans
both libraries, mount both repositories' AI docs side-by-side: each library
owns its own canonical contract.

## Maintenance

Keep the surfaces aligned this way:

- edit the canonical prose in `website/docs/ai/*`
- regenerate instruction packs via `npm run docs:ai`
- use `npm run ai:check` in CI or before commits to catch drift in generated AI artifacts and instruction packs

The goal is simple: agents should load one canonical contract and then choose
the right undo behavior without inventing missing semantics.
