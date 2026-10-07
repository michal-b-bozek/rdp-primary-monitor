// SPDX-License-Identifier: MIT
// ESLint flat config — strict defaults, adapted for plain ESM
// JavaScript that runs under GJS (by design, no TypeScript sources):
//
// - Type-aware rules run on .js files: tsconfig.json type-checks them (checkJs) against the
//   @girs GNOME types, so typescript-eslint's project service can see their types.
// - Rules that need TypeScript syntax are off for .js (they cannot be satisfied by JSDoc).
// - eslint-plugin-import-x replaces eslint-plugin-import: the latter has no ESLint 10
//   support and ESLint 9 is end-of-life. Same rules, `import-x/` prefix.
// - GJS globals are declared; GNOME Shell requires a default export from extension.js and
//   prefs.js.
//
// Prettier integration as in the baseline: eslint-config-prettier last, no
// eslint-plugin-prettier.

import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import-x'
import noSecretsPlugin from 'eslint-plugin-no-secrets'
import regexpPlugin from 'eslint-plugin-regexp'
import securityPlugin from 'eslint-plugin-security'
import tseslint from 'typescript-eslint'

// Globals GJS defines in every module (gjs.guide; mirrored by @girs/gjs for tsc).
const gjsGlobals = {
  global: 'readonly',
  log: 'readonly',
  logError: 'readonly',
  print: 'readonly',
  printerr: 'readonly',
  console: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
}

export default defineConfig(
  // --- 1. global ignores ---------------------------------------------------
  {
    ignores: ['**/build/**', '**/dist/**', '**/node_modules/**'],
  },

  // --- 2. JS recommended ---------------------------------------------------
  js.configs.recommended,

  // --- 3. typescript-eslint: strict + type-checked + stylistic ------------
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // --- 4. parser wiring: project service for every linted file ------------
  // Every linted file must be in tsconfig.json `include` or match the *.config.js override
  // below; a new top-level script needs one or the other.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // --- 5. GJS sources: globals, typing and import discipline ---------------
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: gjsGlobals,
    },
    plugins: { 'import-x': importPlugin },
    rules: {
      // --- typing discipline ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          // Every suppression says why, as `// @ts-expect-error reason: …`.
          'ts-expect-error': { descriptionFormat: '^ reason: .+$' },
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Need TypeScript syntax (annotations, `import type`) that .js files cannot carry.
      // Substitutes, by review convention: every export carries JSDoc `@param` / `@returns`
      // types; type-only imports use `/** @import … */`. A value import used only in JSDoc is
      // reported by @typescript-eslint/no-unused-vars (JSDoc references don't count), so no
      // GJS module is loaded just for a type.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',

      // --- module / import discipline ---
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-default-export': 'error',
      'import-x/no-cycle': ['error', { maxDepth: 10 }],
      'import-x/no-useless-path-segments': 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
    },
  },

  // --- 6. security (language-level) ---------------------------------------
  {
    files: ['**/*.js'],
    plugins: {
      security: securityPlugin,
      'no-secrets': noSecretsPlugin,
      regexp: regexpPlugin,
    },
    rules: {
      ...securityPlugin.configs.recommended.rules,
      ...regexpPlugin.configs['flat/recommended'].rules,
      'no-secrets/no-secrets': ['error', { tolerance: 4.5 }],
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-eval': 'error',
      // Fires on every `obj[key]` access, including safe Record reads (as in the baseline).
      'security/detect-object-injection': 'off',
    },
  },

  // --- 7. per-file overrides ----------------------------------------------
  {
    // GNOME Shell loads the extension and its preferences through their default export.
    files: ['src/extension.js', 'src/prefs.js'],
    rules: { 'import-x/no-default-export': 'off' },
  },
  {
    // Tests: deliberate type-invalid usage and structural fakes are fine.
    files: ['tests/**/*.js'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-secrets/no-secrets': 'off',
    },
  },
  {
    // Tool config files run under Node, not GJS, and stay out of tsconfig.json (as in the
    // baseline): no type-aware rules, Node globals, default exports allowed.
    files: ['**/*.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { process: 'readonly' },
    },
    rules: { 'import-x/no-default-export': 'off' },
  },

  // --- 8. Prettier compatibility (MUST be last) ---------------------------
  prettierConfig,
)
