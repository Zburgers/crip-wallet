import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".local/**",
      "build/**",
      "contracts/broadcast/**",
      "contracts/cache/**",
      "contracts/out/**",
      "coverage/**",
      "dist/**",
      "**/dist/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
