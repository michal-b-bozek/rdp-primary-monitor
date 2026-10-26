# 1. Record architecture decisions

- **Status:** accepted; Last amended: 2026-10-13
- **Date:** 2026-10-12
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** none; this is the first ADR.

## Context

By the end of the feasibility spike and the design questions that followed it, the project had taken
its first design decisions, several with rejected options. It restores every gathered window even
if it was moved remotely, rather than keep the remote changes. It picks the most recently added
virtual monitor, rather than the largest. It keeps a session through the lock screen, rather than
restore on lock. The chosen rules are in `docs/design.md`; the rejected options and the reasons
live only in the maintainer's working notes, which are not part of the repository. The repository
is meant to go public, and it is worked on by people and coding agents who see only what is
committed.

Decisions costly to reverse get re-litigated when their reasoning is lost:

- **Rejected options come back.** Nothing in the repository records that an option was weighed,
  so the next reader proposes it again.
- **Edited records lose the first decision.** A design page rewritten in place shows today's
  choice, not the one it replaced or why. `docs/design.md` describes the mechanism as it is and
  is expected to change with the code.
- **Agents do not open a log that `AGENTS.md` does not point to.** A coding agent starts from
  `AGENTS.md`, so reasoning kept anywhere else is lost to it.
- **Records in different shapes cannot be amended or superseded alike.** A reader who meets two
  layouts cannot tell which section holds the rejected options or which status line counts.

## Decision

### 1. Every decision costly to reverse gets an ADR

One per file in `docs/architecture/decisions/NNNN-short-title.md`, numbered from `0001`, with the
rejected options and why each lost, named in the words a reader would search for. Each ADR states
its evidence in its own words, with no link to working notes.

Not for bug fixes, dependency bumps, settings defaults, routine tooling changes (a lint rule, a
hook, a pinned version) or test setup: the commits record those, and settings defaults will live in
the GSettings schema. Revisit the exclusions if a decision in one of these categories is re-proposed
after being rejected once.

### 2. An accepted ADR's meaning is never rewritten

A reversed decision gets a new ADR that supersedes it, and both link to each other. A refinement
(a parameter, an edge case, a renamed concept) is a dated amendment, `> **Amendment
(YYYY-MM-DD).** …`, under the paragraph it changes, and the ADR's status line gains
`Last amended: YYYY-MM-DD`. Each amendment states the evidence that forced it and names every
file or rule it changes. An amendment that touches the Context or the options, or removes or
inverts a rule, is a reversal and needs a superseding ADR. Wording fixes that change no meaning
are allowed.

### 3. Format

One problem per file, its parts numbered when it has several. Sections: Context, Decision,
Considered options, Consequences, and Tracked separately when work is deferred. The status line is
`proposed`, `accepted`, `deprecated` or `superseded by ADR-NNNN`; superseding one part keeps
`accepted` and adds `part N superseded by ADR-NNNN`. Links to other ADRs are typed: supersedes,
exception to, builds on.

### 4. Routing

`AGENTS.md` names this directory in one line and does not summarise the decisions.

## Considered options

- **Decisions only in `docs/design.md`.** One place to read; loses the rejected options and
  every earlier version of a rule once the page is edited.
- **Commit messages only.** Free; a decision spread over several commits has no single place to find
  it, and its rejected options sink into the history. Revisit if every decision ships as a single
  commit.
- **The maintainer's working notes.** Already written; not in the repository, so invisible to
  every other reader.

## Consequences

- **Good:** a contributor or agent finds both the constraint and the road already rejected,
  without the working notes.
- **Cost:** each decision costly to reverse carries a writing tax, and the log is only as good as
  the discipline of superseding instead of editing.

## Tracked separately

- Recording the decisions taken so far, one ADR each: the virtual-monitor matching rule, the
  temporary display configuration (with the rule for a primary moved off the session's monitor),
  window snapshot and restore, the lock screen, and the language and tooling, which shapes the
  shipped code and so is not a routine tooling change; the rest are settings defaults, routine
  tooling changes or test setup, which part 1 excludes.

  > **Amendment (2026-10-13).** Settled by
  > [ADR-0002](0002-match-the-virtual-monitor.md) to
  > [ADR-0006](0006-plain-javascript-checked-with-typescript.md), one per decision listed here; the
  > item is closed. No rule of this ADR changes.
