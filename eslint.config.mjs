import js from "@eslint/js";
import tseslint from "typescript-eslint";

const restrictedInternalDynamicImport = {
  selector:
    "ImportExpression[source.value=/^@poppy-lab\\/pap-(?:agent|company)\\/src(?:\\/|$)/]",
  message:
    "Import from the package's public entry points instead of internal src/ paths.",
};

const restrictedBoundaryCasts = [
  {
    selector:
      "TSAsExpression[typeAnnotation.type='TSNeverKeyword'], TSTypeAssertion[typeAnnotation.type='TSNeverKeyword']",
    message:
      "Avoid `as never` boundary casts; use the validated api-contract types instead.",
  },
  {
    selector:
      "TSAsExpression[typeAnnotation.type='TSAnyKeyword'], TSTypeAssertion[typeAnnotation.type='TSAnyKeyword']",
    message:
      "Avoid `as any` boundary casts; use the validated api-contract types instead.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "**/.open-next/**",
      "**/.wrangler/**",
      "**/test-results/**",
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
  {
    files: [
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      "**/*.mjs",
      "**/*.cjs",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@poppy-lab/pap-(?:agent|company)/src(?:/|$)",
              message:
                "Import from the package's public entry points instead of internal src/ paths.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", restrictedInternalDynamicImport],
    },
  },
  {
    files: [
      "packages/pap-agent/src/api-http.ts",
      "packages/pap-agent/src/agent-account-http.ts",
      "packages/pap-agent/src/api-contract/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        restrictedInternalDynamicImport,
        ...restrictedBoundaryCasts,
      ],
    },
  },
);
