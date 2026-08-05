import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: "#FFBD5A",
        brandDark: "#E8A94A",
        brandInk: "#3a332b",
        cream: "rgb(var(--cream-rgb) / <alpha-value>)",
        ink: "var(--ink)",
        inkMuted: "var(--ink-muted)",
        card: "var(--card-bg)",
        stripe: "var(--stripe)",
        borderSubtle: "var(--border-subtle)",
        borderStrong: "var(--border-strong)",
        selectBg: "var(--select-bg)",
        selectText: "var(--select-text)",
        pending: "#F2994A",
        pendingBg: "#FFF3E0",
        approved: "#1E7A46",
        approvedBg: "#E8F8EE",
        rejected: "#C0392B",
        rejectedBg: "#FDECEC",
        assigned: "#2C5FBB",
        assignedBg: "#EAF2FF",
      },
    },
  },
  plugins: [],
};
export default config;
