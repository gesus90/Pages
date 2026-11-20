# Backend unit tests

Run the configured backend suite with `pnpm run test:backend`. Test discovery
and V8 coverage both derive their scope from `BACKEND_COVERAGE_SECTIONS` in
`vitest.backend.config.ts`. The current sections cover Discord, cache and
concurrency, and GitHub, security and setup. Tests outside those directories are
not part of this command. Tests and declaration files are excluded from coverage;
source modules in the configured directories are included even when unimported.

Each source module must reach 100% statements, branches, functions and lines.
A metric with no instrumentable items is shown as `n/a`. The report reconciles
measurements with the source inventory and rejects missing executable modules
and incomplete counters. It writes JSON reports and section tables to the
ignored `coverage/backend/` directory. The validated `adopted-backend.tsv`
table is printed and included in the backend CI job summary. CI uploads the
coverage directory even if the test command fails.

The [Discord, cache and concurrency inventory](BackendDiscordCacheConcurrency.md)
and [GitHub, security and setup inventory](BackendGitHubSecuritySetup.md) describe
the modules and their external boundaries. Tests use isolated inputs and mock
external services; they must not access live services or instance data.
