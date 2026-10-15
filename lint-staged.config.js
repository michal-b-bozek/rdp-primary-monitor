// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
// lint-staged: fix and format staged files from the lefthook pre-commit hook.
// ESLint --fix runs before Prettier; warnings fail the commit.

/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,ts}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
  // mise writes .mise/locks/; mise.lock's digest of it breaks if a formatter rewrites it.
  '*.toml': (files) => {
    const own = files.filter((file) => !file.includes('/.mise/locks/'))
    return own.length > 0
      ? [`taplo fmt ${own.map((file) => JSON.stringify(file)).join(' ')}`]
      : []
  },
  // The mise file tasks have no extension, so they need their own glob; a pattern with a slash
  // matches from the repo root only. Every file task is bash.
  '**/*.sh': ['shfmt --write', 'shellcheck'],
  '.mise/tasks/**': ['shfmt --write', 'shellcheck'],
}
