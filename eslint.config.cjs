module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", "studio/**"],
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
        FormData: "readonly",
        history: "readonly",
        localStorage: "readonly",
        Map: "readonly",
        navigator: "readonly",
        Set: "readonly",
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
