# 6. Plain JavaScript, checked with TypeScript

- **Status:** accepted; Last amended: 2026-10-15
- **Date:** 2026-10-13
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** builds on [ADR-0001](0001-record-architecture-decisions.md), which names this
  decision as one that shapes the shipped code rather than a routine tooling change.

## Context

The extension runs inside `gnome-shell`, whose GJS engine loads ES modules from the extension's
directory as they are; nothing compiles them first. What ships is reviewed by people: the
extensions.gnome.org reviewers read the JavaScript in the uploaded zip, and the project is meant to
go public. The code also calls large GNOME APIs (`Meta`, `Gio`, `GLib`, the Shell's own modules)
whose signatures changed between versions; the feasibility spike, for one, found that Mutter 49 and
50 (libmutter API 17 and 18) no longer have `Meta.Window.get_maximized()` (`is_maximized()` and
`get_maximize_flags()` take its place) and that their `maximize()` takes no arguments, unlike
earlier releases. Both GNOME Shell 49 and 50 are supported. Three forces follow:

- **Reviewers read what ships.** Code generated from another language reaches them as output the
  author did not write or read line by line; every review of a change needs the build run first to
  see what will ship.
- **API mistakes surface only at run time.** A wrong method name or argument shows up only when the
  code runs in the compositor, as an exception in the journal or a call that does nothing, and the
  spike already met removed and changed calls. Type definitions for these APIs exist as the
  `@girs/*` packages: generated from the GObject introspection data for the libraries, written by
  hand for the Shell's own modules.
- **Tools need a runtime the extension does not.** Type checking, linting and formatting run on
  Node; the extension itself needs none of it, and nothing from npm may ship in the zip.

## Decision

### 1. The shipped sources are plain ES modules

Every JavaScript file under `src/` is hand-written in ES module form, and the zip contains those
files as written: no compile, bundle or minify step for the JavaScript between the repository and
the upload.

Explicitly not TypeScript sources compiled to JavaScript: the reviewed code would be generated, and
each review would need the build. Revisit if the extensions.gnome.org review starts reading
TypeScript sources directly.

### 2. Types come from JSDoc and `tsc --noEmit`

Every source file is type-checked by `tsc` with `checkJs` and the strict flags, against the
`@girs/*` types of the oldest supported GNOME Shell release, pinned in `package.json`, with JSDoc
carrying the types. `tsc` emits nothing. A GNOME 50-only API, which the pinned types lack, is used
through a JSDoc type declared for it in the project and a runtime check, never through `any`.

> **Amendment (2026-10-15).** The sources are checked against the `@girs/*` types of each supported
> release, GNOME Shell 49 and 50, in two separate `tsc` programs (`mise run typecheck:49` and
> `typecheck:50`; `typecheck` runs both). The 50 set is a second pinned package next to the 49 one,
> `@girs/gnome-shell-50`, an alias of `@girs/gnome-shell` 50.x, with its own ambient file
> (`types50/ambient.d.ts`) and `tsconfig.gnome50.json`. A program that loads both releases' ambient
> types reports no error and checks against one of them, depending on the order in which `tsc` reads
> its files: a 50 config that also included `types/` passed with 196 files of the 49 set loaded.
> `.mise/tasks/typecheck/release` therefore fails a run whose file list contains the other release's
> types, and fails the leaking config with exit 65. ESLint's type-aware rules read `tsconfig.json`
> only, so they see the GNOME Shell 49 types.
>
> The project-declared JSDoc type now covers a method or function that one of the two releases
> lacks. The type declares the member optional (`Partial<…>`), written as a property
> (`name: (…) => …`; the method form fails `jsdoc/valid-types`). The object is cast to it with
> `/** @type {Partial<…>} */ (object)`; a `@type` annotation is rejected by the release without the
> API. The runtime check is `typeof … === 'function'` on that member, so both programs type the call
> and the fallback. The signature is copied exactly from the `@girs` types of the release that has
> the API: there the cast fails (TS2352) only when neither signature fits the other, so a wider or
> narrower one passes unnoticed.
>
> A bare `'name' in object` check does not work: one program types the member `unknown`, the other
> narrows the fallback branch to `never`. `@ts-expect-error` cannot mark such a call either: the
> program that has the API fails on the unused directive (TS2578).
>
> Adds `types50/ambient.d.ts`, `tsconfig.gnome50.json` and `.mise/tasks/typecheck/release`; changes
> `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `eslint.config.js`, `mise.toml`,
> `README.md` and `AGENTS.md`.

Explicitly not untyped JavaScript: the spike's removed and changed Mutter calls would reach the
compositor unnoticed. Revisit if the `@girs/*` packages stop following GNOME releases.

### 3. Node and pnpm are development tools only

Node, pnpm, TypeScript, ESLint and Prettier are installed for checking and formatting, pinned
through `mise` and `pnpm-lock.yaml`. No module in `src/` loads anything installed with pnpm at run
time, and nothing from `node_modules/` is packed into the zip.

Explicitly not dropping Node altogether: without it there is no type checking against the GNOME APIs
and no lint, which leaves part 2 without a tool. Revisit if both a type checker that reads the
`@girs` types and a linter run without Node.

## Considered options

- **Plain ES modules, JSDoc types, `tsc --noEmit` (chosen).**
- **TypeScript sources compiled to readable JavaScript.** Types written inline; a build step in
  every review, and the shipped code is output.
- **Plain JavaScript without Node tooling.** No dev dependencies; no type checking and no lint.

## Consequences

- **Good:** the zip holds exactly the reviewed files, and reviewers read the code the author wrote.
- **Good:** wrong GNOME API calls that the pinned `@girs` types describe fail `mise run typecheck`
  instead of failing in the compositor.
- **Cost:** JSDoc types are wordier than TypeScript syntax, and some TypeScript-only lint rules
  cannot apply to `.js` files.
- **Cost:** the repository carries a Node toolchain and a lockfile that the extension never uses at
  run time.
- **Cost:** the `@girs/*` types can lag behind or differ from the running Shell; a type that passes
  the check can still be wrong at run time.

## Tracked separately

- Type-checking against GNOME Shell 50 as well as 49: a second set of `@girs` types next to the
  pinned 49 ones, checked in a separate `tsc` run.

  > **Amendment (2026-10-15).** Done in the amendment to part 2; the item is closed.
