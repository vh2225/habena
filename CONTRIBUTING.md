# Contributing to AgentGuard

Thanks for considering a contribution. A few notes before you start.

## Before substantial work

**Open an issue first.** For anything more than a typo fix or a one-line tweak, start a discussion so we can confirm the direction fits the roadmap. AgentGuard is an opinionated project with a specific design thesis (safer AND more automated via middleware enforcement); some PRs may be out of scope even if they're well-written.

See [`docs/roadmap.md`](docs/roadmap.md) for what's in flight and [`docs/specs/`](docs/specs) for design specs.

## Setup

```bash
git clone https://github.com/vh2225/agentguard.git
cd agentguard
pnpm install
pnpm -F habena build
pnpm -F habena exec vitest run   # should be all green
```

Requires Node 20+. pnpm v10+. Uses `pnpm.onlyBuiltDependencies` to make `better-sqlite3` install-and-build reliably across machines.

## Code style

- TypeScript, strict mode. No `any` without justification.
- Small, focused functions. Prefer 3 10-line functions over 1 30-line one.
- No comments for *what* — well-named identifiers are the comment. Add comments only for *why* (non-obvious constraints, invariants, references to upstream bugs).
- Tests colocated under `packages/core/tests/<subsystem>/`. Use `vitest`.

## Pull request checklist

- [ ] New behavior has a unit test (or a clear note in the PR why not).
- [ ] `pnpm -F habena build` succeeds.
- [ ] `pnpm -F habena exec vitest run` passes all tests.
- [ ] No lint regressions.
- [ ] Commit message explains the *why*, not just the *what*.
- [ ] If you touch a documented design (specs or README), update the doc in the same PR.

## Commit messages

Conventional commits preferred:

- `feat(subsystem): short sentence` — new user-visible behavior
- `fix(subsystem): short sentence` — bug fix
- `docs: short sentence` — docs only
- `refactor(subsystem): short sentence` — no behavior change
- `test(subsystem): short sentence` — test changes only

First line ≤ 72 chars. Body optional; explains the context.

## Security issues

Don't open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the MIT License.
