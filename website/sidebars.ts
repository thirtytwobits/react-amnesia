import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
    docsSidebar: [
        {
            type: "category",
            label: "Getting Started",
            collapsed: false,
            items: ["getting-started/installation", "getting-started/quick-start"],
        },
        {
            type: "category",
            label: "AI",
            collapsed: false,
            items: [
                "ai/index",
                "ai/invariants",
                "ai/decision-matrix",
                "ai/recipes",
                "ai/anti-patterns",
                "ai/assistant-setup",
            ],
        },
        {
            type: "category",
            label: "Guides",
            collapsed: false,
            items: [
                "guides/keyboard-shortcuts",
                "guides/coalescing",
                "guides/imperative-commands",
                "guides/forms",
                "guides/async-commands",
                "guides/transactions",
                "guides/multi-scope-routing",
                "guides/document-switch-resets",
                "guides/optional-persistence",
                "guides/devtools",
                "guides/os-menu-integration",
                "guides/error-handling",
            ],
        },
        {
            type: "category",
            label: "API Reference",
            link: {
                type: "doc",
                id: "api/index",
            },
            items: require("./docs/api/typedoc-sidebar.cjs"),
        },
    ],
};

export default sidebars;
