import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";

import styles from "./index.module.css";

const quickExample = `import { AmnesiaProvider, AmnesiaShortcuts, useUndoableState } from "react-amnesia";

function TitleEditor() {
  const [title, setTitle] = useUndoableState("Untitled", {
    label: "Edit title",
    coalesceKey: "edit:title",
  });

  return <input value={title} onChange={(e) => setTitle(e.target.value)} />;
}

export default function App() {
  return (
    <AmnesiaProvider capacity={200}>
      <AmnesiaShortcuts />
      <TitleEditor />
    </AmnesiaProvider>
  );
}`;

type FeatureItem = {
    title: string;
    description: string;
};

type ResourceItem = {
    title: string;
    href: string;
    description: string;
    external?: boolean;
};

const features: FeatureItem[] = [
    {
        title: "AI-friendly by design",
        description:
            "Coding assistants get canonical invariants, decision matrices, recipes, and anti-patterns — so they pick the right history shape without inventing semantics.",
    },
    {
        title: "useState-shaped",
        description:
            "useUndoableState returns [value, set, reset] — the same mental model as useState, with Ctrl+Z + coalescing built in.",
    },
    {
        title: "Multi-scope, async, single-flight",
        description:
            "One provider, many independent scopes. Async commands cancel cleanly via AbortSignal. Transactions collapse N mutations into one undoable composite.",
    },
];

const aiResources: ResourceItem[] = [
    {
        title: "AI Docs",
        href: "/docs/ai",
        description: "Canonical invariants, decision matrix, recipes, anti-patterns, and setup guidance.",
    },
    {
        title: "llms.txt",
        href: "https://thirtytwobits.github.io/react-amnesia/llms.txt",
        description: "Compact retrieval index for tight context windows and first-pass tool loading.",
        external: true,
    },
    {
        title: "llms-full.txt",
        href: "https://thirtytwobits.github.io/react-amnesia/llms-full.txt",
        description: "Long-form export for indexing, retrieval, and larger prompt contexts.",
        external: true,
    },
    {
        title: "ai-contract.json",
        href: "https://thirtytwobits.github.io/react-amnesia/ai-contract.json",
        description: "Machine-readable contract for tooling and agent integrations.",
        external: true,
    },
    {
        title: "DeepWiki Priorities",
        href: "https://github.com/thirtytwobits/react-amnesia/blob/main/.devin/wiki.json",
        description: "DeepWiki steering file pointing retrieval toward the highest-signal sources.",
        external: true,
    },
    {
        title: "Assistant Setup",
        href: "/docs/ai/assistant-setup",
        description: "Generated instruction packs plus the documented MCP-friendly retrieval path.",
    },
];

function HomepageHeader() {
    const { siteConfig } = useDocusaurusContext();

    return (
        <header className={clsx("hero hero--primary", styles.heroBanner)}>
            <div className={clsx("container", styles.heroContent)}>
                <h1 className="hero__title">{siteConfig.title}</h1>
                <p className="hero__subtitle">{siteConfig.tagline}</p>
                <p className={styles.heroLead}>
                    Application undo/redo for React, designed so coding assistants and humans can both reach for it
                    without writing custom history glue. Pairs with{" "}
                    <a href="https://github.com/thirtytwobits/react-mnemonic">react-mnemonic</a> for persistence-aware
                    undoable state.
                </p>
                <div className={styles.buttons}>
                    <Link className="button button--secondary button--lg" to="/docs/getting-started/installation">
                        Get Started
                    </Link>
                    <Link
                        className={clsx("button button--outline button--lg", styles.heroOutlineButton)}
                        to="/docs/api"
                    >
                        API Reference
                    </Link>
                    <Link className={clsx("button button--outline button--lg", styles.heroOutlineButton)} to="/docs/ai">
                        AI Docs
                    </Link>
                </div>
                <div className={styles.installSnippet}>
                    <code>npm install react-amnesia</code>
                </div>
            </div>
        </header>
    );
}

function Feature({ title, description }: Readonly<FeatureItem>) {
    return (
        <div className="col col--4">
            <div className="feature-card" style={{ height: "100%", marginBottom: "1rem" }}>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    );
}

function HomepageFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className="row">
                    {features.map((props) => (
                        <Feature key={props.title} {...props} />
                    ))}
                </div>
            </div>
        </section>
    );
}

function HomepageExample() {
    return (
        <section className={styles.example}>
            <div className="container">
                <h2 style={{ textAlign: "center", marginBottom: "2rem" }}>Reversible state in two hooks</h2>
                <div className="row">
                    <div className="col col--8 col--offset-2">
                        <CodeBlock language="tsx" title="App.tsx">
                            {quickExample}
                        </CodeBlock>
                        <p style={{ textAlign: "center", marginTop: "1rem", opacity: 0.8 }}>
                            Ctrl+Z / Cmd+Z undoes; Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y redoes. Rapid keystrokes sharing
                            a <code>coalesceKey</code> collapse into a single history entry.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

function HomepageAiResources() {
    return (
        <section className={styles.resources}>
            <div className="container">
                <h2 style={{ textAlign: "center", marginBottom: "0.75rem" }}>AI Resources</h2>
                <p className={styles.resourcesLead}>
                    <code>react-amnesia</code> ships dedicated retrieval surfaces for coding assistants, DeepWiki, and
                    local MCP-style documentation setups.
                </p>
                <div className="row">
                    {aiResources.map((resource) => (
                        <div key={resource.title} className="col col--4">
                            <div className="feature-card" style={{ height: "100%", marginBottom: "1rem" }}>
                                <h3>{resource.title}</h3>
                                <p>{resource.description}</p>
                                {resource.external ? (
                                    <a href={resource.href} aria-label={`Open ${resource.title}`}>
                                        Open {resource.title}
                                    </a>
                                ) : (
                                    <Link to={resource.href} aria-label={`Open ${resource.title}`}>
                                        Open {resource.title}
                                    </Link>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default function Home(): React.JSX.Element {
    const { siteConfig } = useDocusaurusContext();
    return (
        <Layout title={siteConfig.title} description={siteConfig.tagline}>
            <HomepageHeader />
            <main>
                <HomepageFeatures />
                <HomepageExample />
                <HomepageAiResources />
            </main>
        </Layout>
    );
}
