import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(websiteDir, "..");
const docsDir = path.join(websiteDir, "docs", "ai");
const staticDir = path.join(websiteDir, "static");
const packageJsonPath = path.join(repoDir, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const siteBaseUrl = new URL(packageJson.homepage).toString().replace(/\/$/, "");
const prettierConfig = (await resolveConfig(packageJsonPath)) ?? {};
const checkMode = process.argv.includes("--check");

const canonicalDocs = [
    {
        id: "index",
        title: "AI Overview",
        summary:
            "Canonical entry point for the undo/redo contract: providers, scopes, async commands, transactions, devtools.",
        sourcePath: path.join(docsDir, "index.md"),
        url: `${siteBaseUrl}/docs/ai`,
    },
    {
        id: "invariants",
        title: "Invariants",
        summary:
            "Deterministic guarantees for push / undo / redo, transactions, multi-scope routing, lifecycle hooks, and AbortSignal cancellation.",
        sourcePath: path.join(docsDir, "invariants.md"),
        url: `${siteBaseUrl}/docs/ai/invariants`,
    },
    {
        id: "decision-matrix",
        title: "Decision Matrix",
        summary:
            "Decision tables for hook choice, coalescing, capacity, scope routing, transactions, lifecycle hooks, devtools, and cancellation.",
        sourcePath: path.join(docsDir, "decision-matrix.md"),
        url: `${siteBaseUrl}/docs/ai/decision-matrix`,
    },
    {
        id: "recipes",
        title: "Recipes",
        summary:
            "Copy-pastable patterns for reversible state, coalesced bursts, imperative commands, transactions, multi-scope authoring, async + AbortSignal, devtools wiring, and discard-changes resets.",
        sourcePath: path.join(docsDir, "recipes.md"),
        url: `${siteBaseUrl}/docs/ai/recipes`,
    },
    {
        id: "anti-patterns",
        title: "Anti-Patterns",
        summary:
            "Common mistakes that produce incorrect undo semantics even when the UI appears to work — persisting closures, stealing native undo, ignoring AbortSignals, leaving devtools on in production.",
        sourcePath: path.join(docsDir, "anti-patterns.md"),
        url: `${siteBaseUrl}/docs/ai/anti-patterns`,
    },
    {
        id: "assistant-setup",
        title: "AI Assistant Setup",
        summary: "How to expose the canonical docs through llms files and MCP-friendly retrieval paths.",
        sourcePath: path.join(docsDir, "assistant-setup.md"),
        url: `${siteBaseUrl}/docs/ai/assistant-setup`,
    },
];

const keyGuideLinks = [
    { title: "Quick Start", url: `${siteBaseUrl}/docs/getting-started/quick-start` },
    { title: "Keyboard Shortcuts", url: `${siteBaseUrl}/docs/guides/keyboard-shortcuts` },
    { title: "Coalescing Bursts", url: `${siteBaseUrl}/docs/guides/coalescing` },
    { title: "Imperative Commands", url: `${siteBaseUrl}/docs/guides/imperative-commands` },
    { title: "Forms", url: `${siteBaseUrl}/docs/guides/forms` },
    { title: "Async Commands", url: `${siteBaseUrl}/docs/guides/async-commands` },
    { title: "Transactions", url: `${siteBaseUrl}/docs/guides/transactions` },
    { title: "Multi-Scope Routing", url: `${siteBaseUrl}/docs/guides/multi-scope-routing` },
    { title: "Document Switch Resets", url: `${siteBaseUrl}/docs/guides/document-switch-resets` },
    { title: "Optional Persistence", url: `${siteBaseUrl}/docs/guides/optional-persistence` },
    { title: "DevTools", url: `${siteBaseUrl}/docs/guides/devtools` },
    { title: "Error Handling", url: `${siteBaseUrl}/docs/guides/error-handling` },
    { title: "API Reference", url: `${siteBaseUrl}/docs/api` },
];

const quickRules = [
    "`useAmnesia(...)`, `useUndoableState(...)`, `useAmnesiaFocusClaim(...)`, `useAmnesiaScopes(...)`, and `<AmnesiaShortcuts />` must run inside an `AmnesiaProvider`.",
    "The undo stack is in-memory only. Persist the value (e.g. via `react-mnemonic`) — never the closures.",
    "`Command.do` / `redo` / `undo` may be sync or async. `push` / `undo` / `redo` always return `Promise<number | null>`.",
    "Each handler receives an `AbortSignal`. `clear()` and `dispose()` abort it; pass it to `fetch` for clean cancellation.",
    'An AbortError thrown after `signal.aborted === true` is a silent no-op. A handler that ignores the signal still drops the commit but fires `onError({ phase: "stale" })`.',
    'The store is single-flight. Concurrent ops while `pending === true` resolve to `null` with `onError({ phase: "busy" })`.',
    "`push({ redo, undo, label })` calls `redo()` once on insertion. Pass `{ applied: true }` when state is already mutated.",
    "Use `coalesceKey` for keystroke / drag bursts so a single Ctrl+Z reverts the whole burst.",
    "A new `push` clears the redo (future) stack — branching is not supported.",
    "`useUndoableState` returns `[value, set, reset]`. `reset(next?)` clears the bound scope's history; it is not undoable.",
    "Multi-scope: one provider, many independent stores. `useAmnesiaFocusClaim(scopeId)` routes Ctrl+Z to the focused scope.",
    "Transactions collapse N pushes into one composite entry; throw inside `work` runs every buffered undo in reverse.",
    "Lifecycle hooks (`onPush` / `onUndo` / `onRedo` / `onClear`) are post-notify, microtask-deferred, and re-entrant-safe.",
    "`metaTransform` redacts `meta` everywhere it leaves the store — snapshot AND hooks.",
    "`<AmnesiaShortcuts />` defaults to `skipEditableTargets: true` and walks `composedPath()` to recognize editables in shadow roots.",
    "DevTools registry (`enableDevTools`) is opt-in and lazy-installed; nothing in the bundle activates unless a provider sets it.",
    "Import published values and types from `react-amnesia`, not internal paths or local ambient shims.",
];

const aiContract = {
    version: 1,
    title: "react-amnesia AI Contract",
    canonicalDocs: Object.fromEntries(canonicalDocs.map((doc) => [doc.id, doc.url])),
    retrievalSurfaces: {
        llms: `${siteBaseUrl}/llms.txt`,
        llmsFull: `${siteBaseUrl}/llms-full.txt`,
        machineReadable: `${siteBaseUrl}/ai-contract.json`,
        deepWikiConfig: "https://github.com/thirtytwobits/react-amnesia/blob/main/.devin/wiki.json",
    },
    runtimeContract: {
        type: "in-memory, async-aware, single-flight",
        requiredProvider: true,
        defaultScopeId: "default",
        signalArgument: "AbortSignal — first arg to do/redo/undo, second arg to transaction work",
        actions: {
            push: "apply via do ?? redo and append to past stack",
            undo: "pop past, run undo, append to future",
            redo: "pop future, run redo, append to past",
            clear: "drop past + future of one or all scopes; aborts in-flight signals",
            dispose: "tear down store; aborts in-flight signals",
            transaction: "buffer N pushes into a single composite entry",
        },
    },
    typeContract: {
        sourceOfTruth: "published package exports",
        importPath: "react-amnesia",
        allowLocalAmbientShims: false,
        forbiddenPatterns: ["react-amnesia.d.ts", 'declare module "react-amnesia"'],
        fallbackOrder: ["src/index.ts", "src/core.ts", "src/mnemonic.ts", "package.json", "api-docs", "docs/ai"],
    },
    pushLifecycle: [
        "if disposed → null",
        "if pending → onError(busy), null",
        "invoke command.do ?? command.redo with the AbortSignal",
        "await if thenable",
        "if signal.aborted → silent null",
        "if epoch changed → onError(stale), null",
        "coalesce-merge if previous shares coalesceKey within window, else append",
        "evict at commit when over capacity",
        "notify subscribers, fire onPush hook (microtask-deferred)",
    ],
    undoLifecycle: [
        "if disposed → null",
        "if pending → onError(busy), null",
        "if past empty → null without notify",
        "invoke entry.undo with the AbortSignal",
        "await if thenable",
        "if throws and signal not aborted → onError(undo), entry stays in past, null",
        "if signal.aborted → silent null",
        "pop past, push future, notify, fire onUndo hook",
    ],
    transactionContract: {
        composite: "one entry on commit; redo replays buffered redos in order; undo replays buffered undos in reverse",
        rollback: "throw or stale runs every buffered undo in reverse",
        nested: "flatten into outer; nested label ignored; resolves to null",
        coalescing: "composite never coalesces with neighbors; tx.push entries do not coalesce within the buffer",
    },
    multiScope: {
        creation: "lazy, by first reference",
        defaultScope: "always available, never registered explicitly",
        focusClaim: "useAmnesiaFocusClaim(scopeId) returns capture-phase handlers; single most-recent claim wins",
        clearScope: "useAmnesia(scopeId).clear() — only that scope",
        clearAll: "useAmnesiaScopes().clear() with no arg — every scope",
    },
    decisionShortcuts: {
        sameScopeMultipleEntries: "useAmnesia().push(...)",
        sameScopeOneCompositeEntry: "useAmnesia().transaction(label, work)",
        scopeWideHistoryReset: "useUndoableState(...)[2]() — third tuple slot",
        clearAllScopes: "useAmnesiaScopes().clear()",
        cancellableServerCall: "redo: async (signal) => fetch(url, { signal })",
        externalIntrospection: '<AmnesiaProvider enableDevTools devToolsId="…">',
    },
    cancellation: {
        signalSource: "one AbortController per op; clear() / dispose() abort all",
        honoredAbort: "silent — no onError, entry dropped",
        ignoredAbort: "phase: stale fires, entry dropped via epoch",
        rollbackSignal: "fresh AbortSignal — original was aborted",
    },
    quickRules,
    recipes: [
        "reversible-single-value-editor",
        "multi-field-form-with-shared-undo-stack",
        "coalesced-slider-drag",
        "imperative-list-mutation",
        "persistence-aware-editor",
        "document-switch-with-clear",
        "modal-owns-its-own-keybindings",
        "surface-scoped-shortcut-binding",
        "web-component-shadow-dom-editable",
        "reversible-multi-key-persisted-action",
        "async-command-server-backed-setting",
        "divergent-first-apply-with-command-do",
        "multi-scope-authoring-app",
        "transaction-multi-step-composite-entry",
        "telemetry-with-lifecycle-hooks-and-meta-transform",
        "discard-changes-with-reset",
        "wiring-devtools-for-agent-extension-introspection",
        "cancellable-async-command-with-abort-signal",
        "custom-error-reporting",
        "history-breadcrumb-ui",
    ],
};

function assertFileExists(filePath) {
    if (!existsSync(filePath)) {
        throw new Error(`Expected AI source file to exist: ${filePath}`);
    }
}

function stripFrontmatter(markdown) {
    return markdown.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
}

function normalizeNewlines(text) {
    return text.replace(/\r\n/g, "\n");
}

function normalizeInternalLinks(markdown) {
    return markdown.replace(/(!?\[[^\]]*]\()\/(?!\/)/g, `$1${siteBaseUrl}/`);
}

function loadCanonicalDocs() {
    return canonicalDocs.map((doc) => {
        assertFileExists(doc.sourcePath);
        const content = normalizeInternalLinks(
            stripFrontmatter(normalizeNewlines(readFileSync(doc.sourcePath, "utf8"))),
        );
        return {
            ...doc,
            content,
        };
    });
}

function generateLlmsText(docs) {
    const docLinks = docs.map((doc) => `- [${doc.title}](${doc.url}) - ${doc.summary}`).join("\n");
    const guideLinks = keyGuideLinks.map((guide) => `- [${guide.title}](${guide.url})`).join("\n");
    const ruleLines = quickRules.map((rule) => `- ${rule}`).join("\n");

    return `# react-amnesia
> AI-friendly application undo/redo (Ctrl+Z) for React. Async commands, multi-scope routing, transactions, lifecycle hooks, AbortSignal cancellation, and an opt-in devtools registry.

Use this file as the compact retrieval index. The canonical AI-oriented prose
lives under \`/docs/ai\`, with \`/llms-full.txt\` as the long-form export and
\`/ai-contract.json\` as the machine-readable companion.

## Recommended reading

${docLinks}

## Key guides

${guideLinks}

## Quick rules

${ruleLines}
`;
}

function generateLlmsFullText(docs) {
    const sectionBlocks = docs
        .map(
            (doc) => `## ${doc.title}
Source: ${doc.url}

${doc.content}
`,
        )
        .join("\n");

    return (
        `# react-amnesia
> Long-form AI retrieval export for the canonical react-amnesia documentation.

## Canonical source pages

${docs.map((doc) => `- ${doc.title}: ${doc.url}`).join("\n")}

## Machine-readable companion

- ${siteBaseUrl}/ai-contract.json
- ${siteBaseUrl}/llms.txt

## Quick rules

${quickRules.map((rule) => `- ${rule}`).join("\n")}

${sectionBlocks}`.trimEnd() + "\n"
    );
}

function readTextFileIfExists(filePath) {
    try {
        return readFileSync(filePath, "utf8");
    } catch (error) {
        if (error?.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function writeOutputFile(fileName, content) {
    const outputPath = path.join(staticDir, fileName);
    const currentContent = readTextFileIfExists(outputPath);

    if (checkMode) {
        if (currentContent !== content) {
            if (currentContent === null) {
                throw new Error(`Generated AI asset is missing: ${outputPath}. Run npm run docs:ai.`);
            }
            throw new Error(`Generated AI asset is out of date: ${outputPath}. Run npm run docs:ai.`);
        }
        return;
    }

    mkdirSync(staticDir, { recursive: true });
    writeFileSync(outputPath, content, "utf8");
}

const docs = loadCanonicalDocs();

writeOutputFile("llms.txt", generateLlmsText(docs));
writeOutputFile("llms-full.txt", generateLlmsFullText(docs));
writeOutputFile(
    "ai-contract.json",
    await format(JSON.stringify(aiContract), {
        ...prettierConfig,
        parser: "json",
    }),
);
