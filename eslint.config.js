module.exports = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["eslint.config.js"],
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
