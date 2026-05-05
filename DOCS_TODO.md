# Docs TODO

Remaining documentation-infrastructure work to reach parity with
`react-mnemonic`. Step 1 (canonical AI docs + instruction-pack generator) is
done; what's below is everything else.

## Status snapshot

| Piece                                                            | Status |
| ---------------------------------------------------------------- | ------ |
| `website/docs/ai/*` canonical sources                            | done   |
| `scripts/generate-agent-instructions.mjs` + `npm run docs:ai`    | done   |
| `npm run ai:check` drift guard                                   | done   |
| Generated `AGENTS.md` / `CLAUDE.md` / `.claude` / `.cursor` / `.github` | done   |
| Docusaurus `website/`                                            | TODO   |
| TypeDoc API reference                                            | TODO   |
| `llms.txt` / `llms-full.txt` / `ai-contract.json` generator      | TODO   |
| `context7.json`                                                  | TODO   |
| `.devin/wiki.json`                                               | TODO   |
| Versioned docs (`docs:version`)                                  | TODO   |
| GitHub Pages deploy workflow                                     | TODO   |
| `CHANGELOG.md`                                                   | TODO   |

## Step 2 — Docusaurus site + TypeDoc

The `homepage` in `package.json` (`https://thirtytwobits.github.io/react-amnesia/`)
points nowhere right now, and the canonical docs URLs the generator emits all
404. Both unblock once Docusaurus ships.

Reference: `react-mnemonic/website/`. Mirror layout exactly.

- [ ] `website/` Docusaurus scaffold with its own `package.json` and `node_modules`
- [ ] `website/docusaurus.config.ts` — title, base URL `/react-amnesia/`, GitHub link, primary nav
- [ ] `website/sidebars.ts` — sections matching `react-mnemonic`: Getting Started, Guides, AI, API
- [ ] Move `website/docs/ai/*` (already authored) into the Docusaurus docs tree (it already lives there)
- [ ] Author Getting Started pages: `quick-start.md`, `installation.md`
- [ ] Author Guides: `keyboard-shortcuts.md`, `coalescing.md`, `imperative-commands.md`, `optional-persistence.md`, `error-handling.md`, `document-switch-resets.md`
- [ ] TypeDoc config (`typedoc.json`) emitting into `website/docs/api/`
- [ ] `npm --prefix website run typedoc` script wired through root `npm run docs`
- [ ] `npm run docs:site` (build) and `npm run docs:site:start` (dev) — match `react-mnemonic`
- [ ] Verify: `npm run docs:site` succeeds with no broken links, generated AI pages render, API reference is reachable.

Acceptance: `npm run docs:site` produces `website/build/` that, when served,
matches the URLs the generator hard-codes (e.g.
`/react-amnesia/docs/ai/invariants` resolves).

## Step 3 — Retrieval surfaces (llms.txt, ai-contract.json, etc.)

Reference: `react-mnemonic/website/scripts/generate-ai-assets.mjs`. Output goes
into `website/static/` so the Docusaurus build picks them up.

- [ ] Port `website/scripts/generate-ai-assets.mjs` (vocabulary swap: undo/redo instead of persistence)
- [ ] Generates `website/static/llms.txt` — compact retrieval index (one-line summaries with relative URLs)
- [ ] Generates `website/static/llms-full.txt` — long-form prose export of all canonical AI docs
- [ ] Generates `website/static/ai-contract.json` — machine-readable summary (quick rules, decision checklist, recipe titles, source-of-truth files)
- [ ] Add `--check` mode and wire into `npm run ai:check` so both generators participate in the drift guard
- [ ] Update `npm run docs:ai` to run both generators in sequence (mnemonic does: AI assets first, then instruction packs)
- [ ] Reference these surfaces from `website/docs/ai/index.md` and `assistant-setup.md` (links currently exist in mnemonic's prose; ours intentionally omit them until they resolve)

Acceptance: after `npm run docs:ai`, fresh `llms.txt`, `llms-full.txt`, and
`ai-contract.json` exist under `website/static/`; `npm run ai:check` exits 0
when sources match and non-zero when any of the five generated artifacts drift.

## Step 4 — Editor / agent integration files

Smaller surfaces. Most are static or near-static.

- [ ] `context7.json` — Context7 indexing hints (look at `react-mnemonic/context7.json`, copy structure, swap library name + key file paths)
- [ ] `.devin/wiki.json` — DeepWiki priorities (canonical AI docs, README, `src/index.ts`, `src/Amnesia/*.ts`, `src/mnemonic.ts`)
- [ ] `.sonarcloud.properties` if SonarCloud will be enabled (mnemonic has one; optional)

The generator already emits the Codex / Claude / Cursor / Copilot rule files
under `.claude/`, `.cursor/`, `.github/` — those are done.

## Step 5 — Versioned docs

Once Step 2 ships and the package starts cutting tagged releases.

- [ ] `npm run docs:version` script that runs TypeDoc into `website/versioned_docs/`, then calls `docusaurus docs:version`
- [ ] First snapshot: `0.1.0`
- [ ] Document the cadence in `assistant-setup.md` ("Versioned Docs Behavior" section in mnemonic)

## Step 6 — Deploy automation

- [ ] `.github/workflows/deploy-docs.yml` — build Docusaurus, push to `gh-pages` branch (mirror mnemonic)
- [ ] `.github/workflows/release.yml` — npm publish on tagged releases (mnemonic has one; pattern: `vX.Y.Z`)
- [ ] CI workflow that runs `npm run lint`, `npm test`, `npm run ai:check` on every PR
- [ ] Branch protection: require the CI workflow to pass before merge

## Step 7 — `CHANGELOG.md`

- [ ] Author initial `CHANGELOG.md` (`v0.1.0` — initial release, in-memory undo/redo, optional `react-mnemonic` bridge)
- [ ] Decide convention — mnemonic uses Keep-a-Changelog style; match it.

## Cross-cutting cleanup once steps 2–3 land

- [ ] Replace placeholder GitHub URLs in canonical AI docs once the repo actually exists at `thirtytwobits/react-amnesia` (currently the generator emits `https://github.com/thirtytwobits/react-amnesia/blob/main/...` — those 404 today)
- [ ] Add the AI-resources table from `react-mnemonic/README.md` to our `README.md` once `llms.txt` / `ai-contract.json` exist
- [ ] Update `package.json` `keywords` if any new vocabulary emerges from the docs work
