import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default [
  {
    ignores: [
      "dist/**/*",
      "node_modules/**/*",
      ".gmp_cache/**/*",
      "js/**/*",
      "admin/**/*",
      "public/**/*",
      "scripts/**/*",
      "cloudflare-worker/**/*",
      "server.ts",
      "vite.config.js",
      "eslint.config.js"
    ]
  },
  firebaseRulesPlugin.configs["flat/recommended"]
];
