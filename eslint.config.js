// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
// ESLint flat config for plain ESM JavaScript that runs under GJS (no TypeScript sources):
//
// - Type-aware rules run on .js files: tsconfig.json type-checks them (checkJs) against the
//   @girs GNOME types, so typescript-eslint's project service can see their types. It reads
//   tsconfig.json only, so type-aware rules see the GNOME Shell 49 types; tsc checks 50.
// - Rules that need TypeScript syntax are off for .js (they cannot be satisfied by JSDoc).
// - eslint-plugin-import-x replaces eslint-plugin-import: the latter has no ESLint 10
//   support and ESLint 9 is end-of-life.
// - GNOME Shell requires a default export from extension.js and prefs.js.
// - eslint-plugin-jsdoc requires JSDoc types on the extension's exports (src/), standing in for
//   explicit-module-boundary-types, which cannot read JSDoc.
// - eslint-config-prettier goes last; no eslint-plugin-prettier.

import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import-x'
import jsdocPlugin from 'eslint-plugin-jsdoc'
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

const registerClassCall =
  'CallExpression[callee.object.name="GObject"][callee.property.name="registerClass"]'

// A call, `new`, `await`, tagged template or `import()` that runs when the module is imported:
// anywhere except inside a function body or an instance field (static fields and blocks run at
// import), and except GObject.registerClass with its arguments.
const importTimeWork =
  'Program :matches(CallExpression, NewExpression, AwaitExpression, TaggedTemplateExpression, ImportExpression)' +
  ':not(:function *):not(PropertyDefinition[static=false] *)' +
  `:not(${registerClassCall}):not(${registerClassCall} *)`

// A method of a class expression passed to a call, as in GObject.registerClass(class … {}).
const registeredClassMethod =
  'CallExpression > ClassExpression > ClassBody > MethodDefinition'

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
      // Substitutes: exports in src/ carry JSDoc `@param` / `@returns` types (section 7,
      // eslint-plugin-jsdoc); type-only imports use `/** @import … */`. A value import used
      // only in JSDoc is reported by @typescript-eslint/no-unused-vars (JSDoc references don't
      // count), so no GJS module is loaded just for a type.
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
      // Fires on every `obj[key]` access, including safe Record reads.
      'security/detect-object-injection': 'off',
    },
  },

  // --- 7. JSDoc types on the extension's exports ---------------------------
  {
    files: ['src/**/*.js'],
    // `jsdoc-gobject` is a second name for the same plugin, so require-jsdoc can run twice.
    plugins: { jsdoc: jsdocPlugin, 'jsdoc-gobject': jsdocPlugin },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
        },
      ],
      // GNOME Shell classes are usually `export const X = GObject.registerClass(class … {})`.
      // publicOnly counts that class's methods as exported only while the export statement has
      // no JSDoc of its own, so they are checked here without publicOnly.
      'jsdoc-gobject/require-jsdoc': [
        'error',
        {
          require: { FunctionDeclaration: false },
          contexts: [
            `ExportNamedDeclaration ${registeredClassMethod}`,
            `ExportDefaultDeclaration ${registeredClassMethod}`,
          ],
        },
      ],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-type': 'error',
      'jsdoc/require-returns': [
        'error',
        { forceRequireReturn: true, forceReturnsWithAsync: true },
      ],
      'jsdoc/require-returns-type': 'error',
      'jsdoc/valid-types': 'error',
    },
  },

  // --- 8. per-file overrides ----------------------------------------------
  {
    // GNOME Shell loads the extension and its preferences through their default export.
    files: ['src/extension.js', 'src/prefs.js'],
    rules: { 'import-x/no-default-export': 'off' },
  },
  {
    // The preferences run in their own GTK process, the rest in the Shell; neither side may load
    // the other's libraries (GNOME extension review rules).
    files: ['src/prefs.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Also with a version, as in gi://St?version=…
              regex: '^gi://(Clutter|Meta|Mtk|Shell|St)(\\?|$)',
              message: 'Shell-only library; prefs.js runs outside the Shell.',
            },
            {
              regex: '^resource:///org/gnome/shell/',
              // The preferences' own modules live under /org/gnome/Shell/Extensions/.
              caseSensitive: true,
              message: 'Shell module; prefs.js runs outside the Shell.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/prefs.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Also with a version, as in gi://Gtk?version=4.0.
              regex: '^gi://(Adw|Gdk|Gtk)(\\?|$)',
              message:
                'GTK library; only prefs.js may load it, the Shell must not.',
            },
          ],
        },
      ],
    },
  },
  {
    // GNOME extension review rules: no work at module import time, no synchronous calls (in the
    // Shell they block the compositor; prefs.js follows the same rule). GObject.registerClass is
    // allowed, arguments included, as the review rules let a module register its classes; work
    // placed in its arguments is left to review. Only calls named `*_sync` are caught; other
    // blocking calls (GLib.file_get_contents, Gio.File.load_contents) are left to review too.
    files: ['src/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          // Top-level expression statements that are not themselves a call (assignments, x++, …).
          'Program > ExpressionStatement:not([expression.type=/^(CallExpression|NewExpression|AwaitExpression|TaggedTemplateExpression|ImportExpression|ChainExpression)$/])',
          importTimeWork,
        ].map((selector) => ({
          selector,
          message:
            'Runs at module import time; move it into enable() or fillPreferencesWindow() (GNOME extension review rules).',
        })),
        {
          selector:
            'CallExpression:matches([callee.property.name=/_sync$/], [callee.name=/_sync$/])',
          message:
            'Synchronous call; use the async variant (GNOME extension review rules).',
        },
      ],
    },
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
    // The GNOME Shell 50 ambient types are outside tsconfig.json (one ambient set per tsc
    // program), so the project service cannot type them; they hold only imports.
    files: ['types50/**/*.d.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false } },
  },
  {
    // Tool config files run under Node, not GJS, and stay out of tsconfig.json: no type-aware
    // rules, Node globals, default exports allowed.
    files: ['**/*.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { process: 'readonly' },
    },
    rules: { 'import-x/no-default-export': 'off' },
  },

  // --- 9. Prettier compatibility (MUST be last) ---------------------------
  prettierConfig,
)
