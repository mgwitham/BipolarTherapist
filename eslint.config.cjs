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
      globals: {
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        history: "readonly",
        localStorage: "readonly",
        Map: "readonly",
        navigator: "readonly",
        Set: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
