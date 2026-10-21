# AGENTS.md

# Pica Mobile Agent Instructions

Instructions for AI coding agents working in this repository. The app is the
native Pica client for Android and iOS (Expo, React Native, TypeScript, Expo
Router). It lives in the Pages repository as the submodule `mobile/` and is
developed on its own.

## 1. Mandatory coding rules

The coding rules of Pages apply here unchanged. Before writing or changing code,
read `GUIDELINES.md` of Pages: it is `../GUIDELINES.md` when this repository is
checked out as the `mobile/` submodule of Pages, otherwise in the Pages
repository. They cover TypeScript, React, TypeDoc, functions, naming, imports,
async code, error handling and comments. The SQL and Tailwind chapters do not
apply; the equivalent of the CSS rule is chapter 5 below.

The rules a tool can check are enforced by `pnpm run lint` (ESLint, no warnings
allowed) and `pnpm run check` (`tsc --noEmit` in strict mode and Prettier).
`eslint.rules.mjs` is derived from `eslint.rules.js` in Pages; when Pages changes
a rule, change the copy too. Do not switch a rule off, relax a limit or add a
suppression comment; change the code instead.

Files are kebab-case. React components, hooks and routes follow the React rules
of `GUIDELINES.md`; a route file in `app/` is a default export (Expo Router needs
it) that re-exports a screen from `src/screens/`.

## 2. Architecture boundaries

```text
app/ (routes) -> src/screens -> src/components
                      |
                      v
        src/connection, src/settings, src/theme, src/i18n (providers and hooks)
                      |
                      v
                  src/api (no React)
```

- `src/api` is typed access to Pages. It imports nothing from React or React
  Native, so it stays testable without a renderer.
- Providers hold state and side effects; components render; screens compose.
- Keep requests to Pages in `PagesClient`. Never call `fetch` elsewhere, never
  build a URL by hand, never read a response without a parser.
- Do not add a dependency on code of the Pages repository, and keep Pages out of
  this app's dependency tree.

## 3. Scope

This repository is the foundation. It does **not** contain, and an agent must
not start without a ticket: Pages authentication, the real mobile API, chat and
session synchronization, ACP connections, an AI runtime, voice input, push
notifications, camera, file handling or store publication. `src/api/contracts/`
holds draft types only; do not invent server behavior behind them and never show
simulated answers as Pica's.

Change only what the task requires. Do not rename or move files without need, do
not add a dependency unless necessary, preserve the public API.

## 4. Dependencies

- Only versions published at least ten days ago are installed
  (`minimumReleaseAge` in `pnpm-workspace.yaml`); do not bypass it, and do not
  list a package as an exception.
- Check Expo compatibility before installing: use `pnpm exec expo install <pkg>`
  or compare with `expo/bundledNativeModules.json`, and run
  `pnpm exec expo install --check` afterwards. Newer SDK 57 patches may be
  reported while they are younger than ten days; that is expected.
- Optional peers of Expo packages are not installed automatically
  (`autoInstallPeers: false`). Add a native package explicitly and only when the
  app uses it: every native package is compiled into every build.
- Commit `pnpm-lock.yaml`. CI installs with `--frozen-lockfile`.

## 5. UI

- Colors come from the theme tokens (`useTheme().colors`); a hex or `rgb()`
  literal outside `src/theme/tokens.ts` fails the lint. A token has a value in the
  light and the dark palette: add one to both.
- Text for people lives in `src/i18n/locales/` in German and English; `de.ts`
  must provide every key of `en.ts`. No text literal in a component.
- Touch targets are at least 48 dp (`MINIMUM_TOUCH_TARGET`). Give interactive
  elements an `accessibilityRole`, state and label. Text must grow with the system
  font size; do not fix the height of a text container.
- Safe areas: use `Screen`, which handles left and right insets; the navigators
  handle top and bottom. Content must work on a phone, a tablet and in landscape.
- Native UI only: no WebView, no web fallback.

## 6. Configuration, secrets and builds

- `app.config.ts` is the Expo configuration; `eas.json` holds the build and
  submit profiles. Identifiers, versions and variants are organized there.
- Never commit credentials, API keys, keystores, certificates, `.env` files or
  server addresses. A build profile may preset the server address through
  `EXPO_PUBLIC_PAGES_SERVER_URL`; `.env.example` names the variables.
- Do not create or use Apple, Google or Expo accounts on behalf of the project.
  When a build needs one, document the manual step.
- `android/`, `ios/`, `dist/` and `.expo/` are generated; do not edit or commit
  them.

## 7. Tests

Tests live in `tests/`, run with `pnpm run test` (Jest, `jest-expo`, React Native
Testing Library) and cover observable behavior: API layer, settings, texts,
configuration, components and the real routes through `renderRouter`. They use
no device, no network and no real server; the transport is replaced at the
boundary (`fetch`, `expo-network`). Add or update tests when behavior changes. Do
not delete or weaken a test to make a change pass.

## 8. Completion

Before a task is complete:

- Run `pnpm run lint`, `pnpm run check`, `pnpm run test` and `pnpm run build`.
- Confirm the changed code follows `GUIDELINES.md` and changes nothing unrelated.
- Update the README when documented behavior changed.
- Say what was not verified: a change to native behavior, the keyboard or a build
  can only be proven on a device or in an EAS build.
