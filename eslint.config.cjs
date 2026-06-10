// Shared rules applied to every linted file. These are deliberately a set the
// codebase already satisfies by hand, now enforced so they can't regress.
// NOTE: `no-var`/`prefer-const` are intentionally NOT here yet — the frontend
// still has thousands of `var`s; they land in a dedicated sweep PR so this
// config change stays green.
const sharedRules = {
  "no-undef": "error",
  "no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
};

// Browser runtime globals for the Vite frontend (assets/*.js) and the
// node-context config files that only touch web-standard globals (vite.config.js
// uses URL).
const browserGlobals = {
  console: "readonly",
  document: "readonly",
  fetch: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  history: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  Map: "readonly",
  navigator: "readonly",
  Set: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  AbortController: "readonly",
  Response: "readonly",
  Request: "readonly",
  Headers: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  window: "readonly",
  crypto: "readonly",
  IntersectionObserver: "readonly",
  MutationObserver: "readonly",
  CustomEvent: "readonly",
  Image: "readonly",
  Blob: "readonly",
  alert: "readonly",
  confirm: "readonly",
  getComputedStyle: "readonly",
};

// Node runtime globals for the API (server/*.mjs), domain layer (shared/*.mjs),
// Vercel functions (api/*.mjs), build/ops scripts (scripts/*.mjs) and tests.
const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  globalThis: "readonly",
  crypto: "readonly",
  fetch: "readonly",
  Response: "readonly",
  Request: "readonly",
  Headers: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  structuredClone: "readonly",
  setImmediate: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
};

module.exports = [
  {
    ignores: [".claude/**", ".vercel/**", "dist/**", "node_modules/**", "studio/**", "tmp/**"],
  },
  {
    files: ["eslint.config.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        module: "readonly",
      },
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
];
