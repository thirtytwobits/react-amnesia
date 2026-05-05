# Docs TODO

Documentation infrastructure for `react-amnesia`. All foundation work has
landed; what remains here is upstream-dependent (URLs that 404 until the
GitHub repo + Pages deployment exist).

## Status snapshot

| Piece                                                                   | Status |
| ----------------------------------------------------------------------- | ------ |
| `website/docs/ai/*` canonical sources                                   | done   |
| `scripts/generate-agent-instructions.mjs` + `npm run docs:ai`           | done   |
| `npm run ai:check` drift guard                                          | done   |
| Generated `AGENTS.md` / `CLAUDE.md` / `.claude` / `.cursor` / `.github` | done   |
| Docusaurus `website/` (config, sidebars, homepage, css, favicon)        | done   |
| TypeDoc API reference (via `docusaurus-plugin-typedoc`)                 | done   |
| `llms.txt` / `llms-full.txt` / `ai-contract.json` generator             | done   |
| Getting Started + Guides docs                                           | done   |
| `context7.json`                                                         | done   |
| `.devin/wiki.json`                                                      | done   |
| `npm run docs:site`, `docs:site:start`, `docs` scripts                  | done   |
| `.github/workflows/ci.yml` (lint, format, ai:check, build, test)        | done   |
| `.github/workflows/deploy-docs.yml` (Docusaurus → gh-pages on tags)     | done   |
| `.github/workflows/release.yml` (npm publish on tags)                   | done   |
| README AI-resources table                                               | done   |

## Pending — unblocks once the GitHub repo + Pages site exist

These items are deferred until the repository exists at
`thirtytwobits/react-amnesia` and GitHub Pages is configured. None block
local development or shipping the runtime.

- [ ] Verify `https://thirtytwobits.github.io/react-amnesia/` resolves once
      the deploy workflow runs on the first tagged release.
- [ ] Confirm the URLs the AI generators emit (`/docs/ai/*`, `/llms.txt`,
      `/ai-contract.json`, `.devin/wiki.json`) all 200 from the deployed
      site. They are valid by construction once Pages is live.
- [ ] If the repo is renamed, sweep the canonical AI docs and `package.json`
      `homepage` / `repository` URLs in one pass and re-run `npm run docs:ai`.

## Optional follow-ups

Not required for the first publish, capture so they don't get lost.

- [ ] `.sonarcloud.properties` if SonarCloud is enabled later (mnemonic has
      one).
- [ ] Bundle-size budget enforcement in `ci.yml` (the budgets are listed in
      `RELEASE_ROADMAP.md` cross-cutting work; need a tool like `size-limit`
      to enforce in CI).
- [ ] Pack-install matrix in `ci.yml` covering yarn / pnpm and a fixture
      consumer app — the kind react-mnemonic ships. Worth doing once there
      is a real consumer to integrate against.
- [ ] Versioned docs setup (`docusaurus docs:version`) once the package
      has shipped at least one tagged release.
