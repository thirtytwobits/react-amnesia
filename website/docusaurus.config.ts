import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const isLocalDevelopment = process.env.NODE_ENV === "development";

const config: Config = {
    title: "react-amnesia",
    tagline: "AI-friendly application undo/redo (Ctrl+Z) for React",
    favicon: "img/favicon.svg",

    url: "https://thirtytwobits.github.io",
    baseUrl: isLocalDevelopment ? "/" : "/react-amnesia/",

    organizationName: "thirtytwobits",
    projectName: "react-amnesia",
    trailingSlash: false,

    onBrokenLinks: "throw",

    markdown: {
        hooks: {
            onBrokenMarkdownLinks: "warn",
        },
    },

    i18n: {
        defaultLocale: "en",
        locales: ["en"],
    },

    plugins: [
        [
            "docusaurus-plugin-typedoc",
            {
                entryPoints: ["../src/index.ts"],
                tsconfig: "../tsconfig.json",
                out: "docs/api",
                outputFileStrategy: "members",
                readme: "none",
                excludePrivate: true,
                excludeProtected: true,
                excludeInternal: true,
                sort: ["kind", "alphabetical"],
                kindSortOrder: ["Function", "Interface", "TypeAlias", "Class", "Variable", "Enum"],
                parametersFormat: "table",
                enumMembersFormat: "table",
                typeDeclarationFormat: "table",
                sidebar: {
                    autoConfiguration: true,
                    pretty: true,
                },
            },
        ],
    ],

    presets: [
        [
            "classic",
            {
                docs: {
                    sidebarPath: "./sidebars.ts",
                    editUrl: "https://github.com/thirtytwobits/react-amnesia/tree/main/website/",
                },
                blog: false,
                theme: {
                    customCss: "./src/css/custom.css",
                },
            } satisfies Preset.Options,
        ],
    ],

    themeConfig: {
        navbar: {
            title: "react-amnesia",
            items: [
                {
                    type: "docSidebar",
                    sidebarId: "docsSidebar",
                    position: "left",
                    label: "Docs",
                },
                {
                    to: "docs/api",
                    label: "API",
                    position: "left",
                },
                {
                    href: "https://github.com/thirtytwobits/react-amnesia",
                    label: "GitHub",
                    position: "right",
                },
                {
                    href: "https://www.npmjs.com/package/react-amnesia",
                    label: "npm",
                    position: "right",
                },
            ],
        },
        footer: {
            style: "dark",
            links: [
                {
                    title: "Docs",
                    items: [
                        { label: "Getting Started", to: "/docs/getting-started/installation" },
                        { label: "AI Docs", to: "/docs/ai" },
                        { label: "Guides", to: "/docs/guides/keyboard-shortcuts" },
                        { label: "API Reference", to: "/docs/api" },
                    ],
                },
                {
                    title: "Community",
                    items: [
                        {
                            label: "GitHub Issues",
                            href: "https://github.com/thirtytwobits/react-amnesia/issues",
                        },
                        {
                            label: "GitHub Discussions",
                            href: "https://github.com/thirtytwobits/react-amnesia/discussions",
                        },
                    ],
                },
                {
                    title: "More",
                    items: [
                        { label: "GitHub", href: "https://github.com/thirtytwobits/react-amnesia" },
                        { label: "npm", href: "https://www.npmjs.com/package/react-amnesia" },
                        { label: "react-mnemonic", href: "https://thirtytwobits.github.io/react-mnemonic/" },
                    ],
                },
            ],
            copyright: `Copyright © ${new Date().getFullYear()} Scott Dixon. Built with Docusaurus.`,
        },
        prism: {
            theme: prismThemes.github,
            darkTheme: prismThemes.dracula,
            additionalLanguages: ["bash", "json"],
        },
        colorMode: {
            defaultMode: "light",
            disableSwitch: false,
            respectPrefersColorScheme: true,
        },
    } satisfies Preset.ThemeConfig,
};

export default config;
