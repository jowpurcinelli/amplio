# Contributing to Amplio

Thanks for your interest in Amplio. This project is built in the open and contributions are welcome, from bug reports to whole subsystems.

## Getting set up

Requirements: Node 20+, pnpm, Docker.

```bash
pnpm install
pnpm stack:up     # start ClickHouse + Postgres
pnpm dev          # run services
pnpm test         # run tests
pnpm typecheck    # type check everything
```

## How we work

- **Pick from the roadmap or open issues.** See [docs/ROADMAP.md](docs/ROADMAP.md). Comment on an issue before starting large work so we do not duplicate effort.
- **Keep PRs focused.** One logical change per PR. Small PRs get reviewed faster.
- **Tests matter.** New behavior needs tests. The query engine in particular is designed to be tested by snapshotting generated SQL.
- **Type safety.** The codebase is strict TypeScript. No `any` without a written reason.

## Commit and PR style

- Write clear commit messages in imperative mood ("add funnel query builder").
- Reference the issue you are closing in the PR description.
- CI must pass (typecheck, test, lint) before merge.

## Code layout

See the repository layout in [README.md](README.md) and the component breakdown in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Copy and UI text

User-facing copy (dashboard, docs, marketing) is written for humans. Avoid AI tells: no em-dashes or double hyphens as pauses, no filler hype. Plain, direct language.

## Code of conduct

Be respectful. Assume good faith. We are here to build something useful together.
