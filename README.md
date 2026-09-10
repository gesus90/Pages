<div align="center">

<img src="./assets/icon.png" alt="Pages" width="96" />

# Pages

**A self-hosted project management and wiki platform.**

![Status](https://img.shields.io/badge/status-early%20development-F97316?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-24292F?style=flat-square&logo=typescript&logoColor=3178C6)
![React 19](https://img.shields.io/badge/React%2019-24292F?style=flat-square&logo=react&logoColor=61DAFB)

</div>

## About

Pages is an open-source, self-hosted workspace for planning projects, tracking tasks, and documenting knowledge.

It is designed to start simple and scale from personal use to small teams with role-based access.

> **Status:** Pages is currently in early development.

## Goals

- Project planning and tracking
- Task management
- Project wikis and documentation
- Multi-user support with roles and permissions
- German and English localization
- Responsive desktop, tablet, and mobile UI
- Simple self-hosting

## Tech Stack

| | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript |
| Server | React Router SSR + Node.js |
| Tooling | Vite + React Router Framework Mode |
| Routing | React Router Loader, Actions, Middleware |
| UI | Tailwind CSS 4 + shadcn/ui (Radix UI) + Lucide |
| Database | DuckDB |
| Localization | i18next |
| Tests | Vitest |

## Architecture

Pages follows a small layered structure:

```text
Request
  ↓
Route / Loader
  ↓
Service
  ↓
Repository
  ↓
DuckDB
```

React Router renders Pages server-side and hydrates it in the browser. Route
middleware verifies persisted, HttpOnly sessions before protected loaders and
actions run.

## Development

Install dependencies and start the local development server:

```sh
pnpm install
pnpm run dev
```

Pages is then available at <http://localhost:5173>.

Use `pnpm run build` to create a production build and `pnpm run start` to serve
it. Use `pnpm test` to verify the unit test suite, always with coverage.
`pnpm run test:frontend` and `pnpm run test:backend` verify a single scope
through the `VITEST_FRONTEND` and `VITEST_BACKEND` environment flags, also
with coverage. Suites below `tests/frontend/` verify everything below
`app/`, suites below `tests/backend/` verify `backend/`, `definition/`,
and `language/`. Each scope is held at 100% coverage on its own files, so
a run fails individually as well as together. New files below `tests/` and
new source directories are picked up automatically.
The remaining maintenance commands are `pnpm run check`, `pnpm run lint`,
`pnpm run format`, and `pnpm run clean`.

Coding conventions are defined in [`GUIDELINES.md`](./GUIDELINES.md).

## License

License information will be added before the first public release.
