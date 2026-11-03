import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "**/.open-next/**",
      "**/.wrangler/**",
      "**/src/site/app-script.ts",
    ],
  },
  {
    // Juniper's customer website runs in the browser.
    files: ["apps/*/src/site/app.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        AbortSignal: "readonly",
        Intl: "readonly",
        requestAnimationFrame: "readonly",
        setInterval: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
