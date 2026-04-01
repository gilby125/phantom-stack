# Repository Guidelines

## Project Structure & Module Organization
`phantom-stack` is a multi-service monorepo. Core orchestration lives in `sandboxed.sh/` (Rust API + mission runtime) with UI in `sandboxed.sh/dashboard/` (Next.js). Sidecars live in:
- `phantom-relay/` (Slack bridge)
- `evolution-worker/` (post-mission evolution loop)
- `memory-mcp/` (memory service)

Operational docs are in `docs/`, automation scripts in `scripts/`, and stack wiring in root `docker-compose.yml`.

## Build, Test, and Development Commands
- `./scripts/bootstrap-local-env.sh`: generate local `.env` from template.
- `docker compose up -d --build`: build and run the full stack locally.
- `./scripts/nuke-and-rebuild.sh --yes`: clean rebuild when stack state is broken.
- `cd sandboxed.sh && cargo test -q`: run Rust backend tests.
- `cd sandboxed.sh/dashboard && npx tsc --noEmit`: TypeScript type-check.
- `cd sandboxed.sh/dashboard && npm run test` (or `bunx playwright test`): dashboard E2E tests.
- `cd sandboxed.sh/dashboard && npm run test:unit`: dashboard unit tests (Vitest).

## Coding Style & Naming Conventions
Rust uses idiomatic `rustfmt` style (4-space indentation, `snake_case` functions/modules, `PascalCase` types). TypeScript/React follows existing Next.js patterns (`camelCase` variables/functions, `PascalCase` components). Keep changes scoped and consistent with nearby code. Prefer explicit backend/provider IDs (`opencode`, `gemini`, `claudecode`) and fail fast on invalid config.

## Testing Guidelines
Add tests closest to the changed layer:
- Rust API/runtime behavior: `sandboxed.sh/src/**` tests.
- UI/API integration: `sandboxed.sh/dashboard/tests/*.spec.ts` (Playwright).
- UI unit logic: Vitest tests near components/lib.

For backend/UI contract changes, run both `cargo test -q` and `npx tsc --noEmit` before opening a PR.

## Commit & Pull Request Guidelines
Use Conventional Commit style seen in history:
- `feat: ...`
- `fix(scope): ...`
- `refactor: ...`

PRs should include:
1. Clear problem statement and solution summary.
2. Any config/env changes (for example `.env` keys).
3. Verification steps and command output summary.
4. Screenshots for UI changes.

## Security & Configuration Tips
Never commit secrets (`.env`, tokens, OAuth artifacts). Keep runtime state in volumes (`/root/.sandboxed-sh`) and use `.env.template` as the source for required variables.
