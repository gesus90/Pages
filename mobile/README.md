# Pica Mobile

The native Pica app for Android and iOS: Expo, React Native and TypeScript, with
Expo Router for navigation and no WebView. It is developed, tested and built on
its own, independent of the Pages web app, and later talks to the same
server-side Pica sessions.

**Status: foundation (PAGE-99).** This version has the app shell, the theme, the
German and English texts, the typed API layer, the connection status and the
build configuration. It has **no** authentication, no chat or session sync, no
ACP connection, no AI runtime, no push notifications, no voice input and no store
publication. The Pica view says so in its empty state and never shows a message
that could pass for an answer.

## What is in the app

- **Pica**: the main view. While there is nothing to show it explains why, says
  where the connection stands (the header carries the status badge) and leads to
  the settings.
- **Settings**: the Pages server address, the connection status with a check
  button, the theme (device, light, dark), the language (device, German,
  English) and the version.
- Light and dark theme from tokens that follow the Pages palette, safe areas
  (notch, home indicator, edge-to-edge Android), a readable content column on
  tablets and in landscape, and text that grows with the system font size.

## Requirements

| For                | You need                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| Everything         | Node.js 24 or newer and pnpm 10 or newer (the `packageManager` field names 11.23) |
| Android, local     | JDK 17, the Android SDK (Android Studio) and an emulator or a device              |
| iOS, local         | A Mac with Xcode (the simulator needs no Apple account)                           |
| iOS without a Mac  | An Expo account and EAS cloud builds, see [Builds](#builds)                       |
| Store distribution | An Apple Developer account for iOS, a Google Play Console account for Android     |

Development works on Linux, Windows and macOS. Only a local iOS build needs a
Mac.

## Set up and run

```sh
pnpm install            # only versions published at least ten days ago, see below
cp .env.example .env    # optional; every value is optional
pnpm start              # Metro for a development build
```

The app uses a **development build** (`expo-dev-client`), not Expo Go. Build and
install it once, then `pnpm start` connects to it:

```sh
pnpm android            # expo run:android: builds and starts the app locally
pnpm ios                # expo run:ios (Mac only)
# or, without a local toolchain, an EAS cloud build of the profile `development`
```

`android/` and `ios/` are generated from `app.config.ts` (continuous native
generation) and are not committed; `pnpm run clean` removes them.

### Scripts

| Script   | What it does                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------- |
| `start`  | Starts Metro for the development build.                                                             |
| `lint`   | ESLint with `--max-warnings=0`, the Pages rules of `GUIDELINES.md`.                                 |
| `check`  | `tsc --noEmit` in strict mode and `prettier --check`.                                               |
| `test`   | Jest with the `jest-expo` preset and React Native Testing Library; no device, no network. |
| `build`  | `expo export` for Android and iOS: Metro bundles and Hermes compiles. No account, no toolchain.     |
| `format` | `prettier --write`.                                                                                 |
| `clean`  | Removes `node_modules`, `dist`, `coverage`, `.expo` and the generated native folders.               |

### Supply-chain rule

`pnpm-workspace.yaml` sets `minimumReleaseAge: 14400` (ten days), as in Pages:
pnpm installs only versions published at least ten days ago, transitive packages
included, and fails instead of falling back to a younger one. Before a package
is added, check that it is compatible with the Expo SDK (`pnpm exec expo install
--check`, or `npx expo-doctor`). Optional peer dependencies of Expo packages are
not installed on their own (`autoInstallPeers: false`): they would be picked
without regard to the SDK and Expo autolinking would compile them into every
native build. A package the app really uses goes into `package.json`.

The app is on **Expo SDK 57** (React Native 0.86, React 19.2). SDK 58 exists, but
it pins React Native 0.88, whose stable release is younger than ten days, and an
older SDK 58 patch pins a release candidate. `pnpm exec expo install --check`
therefore also lists newer SDK 57 patches (`expo`, `expo-router`, ...); they
install once they are ten days old. To move to SDK 58 later, follow the Expo
upgrade guide (`pnpm exec expo install expo@^58 --fix`).

## Architecture

```text
app/                        Expo Router routes; each file only re-exports a screen
  _layout.tsx               icon font, providers, navigator
  (tabs)/                   the two tabs: index (Pica) and settings
  +not-found.tsx
src/
  api/                      typed access to Pages: no UI, no React
    pages-client.ts         PagesClient: builds requests, credentials, time limit
    api-error.ts            PagesApiError and its subclasses
    server-address.ts       checks and normalizes the address a person types
    auth.ts                 AuthProvider contract (anonymous for now)
    health.ts               GET /health -> ConnectionStatus
    contracts/              draft contracts for sessions and live events (types only)
  connection/               the state of the connection, as a hook and a provider
  settings/                 settings model, device storage, provider
  theme/                    tokens (light and dark), provider, `useTheme`
  i18n/                     de/en texts, language resolution, provider
  components/               small presentational components
  navigation/               navigators, navigation theme, splash screen control
  screens/                  the screens the routes show
tests/                      Jest: API, settings, i18n, config, components, the real routes
assets/images/              icon, adaptive icon, mascot, Pages wordmark
app.config.ts               Expo configuration of the three build variants
eas.json                    EAS build and submit profiles
```

Dependencies point one way: routes and screens use components and providers;
providers use `api`, `settings` and `theme`; `api` knows nothing of React. File
names are kebab-case, like `app/` in Pages. The coding rules are those of Pages
(see [AGENTS.md](./AGENTS.md)); a color is never written into a component, it
comes from `src/theme/tokens.ts` (a lint rule checks it).

### API layer

`PagesClient` is the one place that talks to a Pages server:

- The address is configurable. `parseServerAddress` accepts `https://` only and
  rejects credentials, queries and fragments. A development build also accepts
  `http://`, so a server on the local network can be reached; every release build
  requires HTTPS. No address is hard-coded: a build profile may preset one with
  `EXPO_PUBLIC_PAGES_SERVER_URL`, a person can change it in the settings.
- Every request asks an `AuthProvider` for the `Authorization` header before it is
  sent. The foundation provides `ANONYMOUS_AUTH`; the authentication ticket
  replaces it, backed by the device's credential store (`expo-secure-store`).
- Every failure is a `PagesApiError`: `network`, `timeout`, `aborted`, `http`
  (with the status and the JSON body) or `invalid-response`. Answers are
  validated by a parser the caller passes in, never cast.
- The connection status comes from the unauthenticated `GET /health` of Pages. It
  proves that a Pages server answers and whether its setup is finished; it opens
  no session. It is checked when the address changes, when the device comes back
  online, when the app returns to the foreground and on request.
- `src/api/contracts/` holds draft types for sessions (`PicaSessionApi`) and live
  events (`PicaLiveEvent`, `LiveEventSource`). Pages has no mobile API yet; the
  ticket that adds it aligns them with the server.

### Theme, language, safe areas

- `src/theme/tokens.ts` holds the light and the dark palette with the names of
  the Pages tokens (`background`, `surface`, `primary`, ...), the spacing and
  radius scales and the type scale. The Pica orange (`#f97316`) is `primary`.
  Three light values differ from Pages because the touch UI needs more contrast
  (`mutedForeground`, `primaryForeground` and the new `outline` for inputs and
  choices); `tests/theme/tokens.test.ts` keeps every text pair at 4.5:1 and the
  outline at 3:1 in both palettes. Color is never the only cue: the selected
  option also shows a check mark, a connection status also shows its name.
- The theme follows the device or a forced choice. A forced choice is handed to
  the system through `Appearance.setColorScheme`, so the status bar, the keyboard
  and system dialogs follow it too.
- Texts live in `src/i18n/locales/` (`en.ts` defines the keys, `de.ts` must match
  them; a missing key does not compile). The language follows the device when it
  is German or English, otherwise English.
- `Screen` keeps content out of a notch in landscape, centers a column of at most
  640 dp and scrolls when text or the keyboard needs the room; the header and the
  tab bar handle the status bar and the home indicator.

### Branding and assets

The artwork comes from Pages: `assets/pica/pica_maskottchen.svg` (mascot) and
`assets/icon.png` (wordmark). Rendered to PNG in `assets/images/`:

| File                           | What                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `icon.png`                     | 1024 px app icon: mascot on the Pica orange gradient              |
| `icon-dark.png`                | iOS dark variant: the mascot on the dark Pages surface            |
| `adaptive-icon-foreground.png` | Android adaptive icon: the mascot inside the 66 % safe zone       |
| `adaptive-icon-background.png` | The same orange gradient                                          |
| `adaptive-icon-monochrome.png` | Android themed icon: the silhouette with the face cut out         |
| `pica-mascot.png`              | 768 px mascot, transparent: the empty state and the splash screen |
| `pages-wordmark.png`, `-dark`  | The Pages logo for the About section, light and dark              |

The splash screen shows the mascot on the light or dark window background of the
theme (`expo-splash-screen` through `app.config.ts`). Android 12 and newer mask
the splash icon with a circle, so Android uses the adaptive-icon artwork there.

## Builds

`app.config.ts` creates three variants. `APP_VARIANT` selects one; the profiles
of `eas.json` set it, a local start without a profile is `development`. They
install next to each other.

| Variant       | Name           | Identifier (Android package, iOS bundle id) | URL scheme     |
| ------------- | -------------- | ------------------------------------------- | -------------- |
| `development` | Pica (Dev)     | `io.github.gesus90.pica.dev`                | `pica-dev`     |
| `preview`     | Pica (Preview) | `io.github.gesus90.pica.preview`            | `pica-preview` |
| `production`  | Pica           | `io.github.gesus90.pica`                    | `pica`         |

The identifier base `io.github.gesus90.pica` (`BASE_APPLICATION_ID` in
`app.config.ts`) is a proposal derived from the GitHub owner. Store identifiers
cannot be changed later, so confirm it before the first store build.

EAS profiles (`eas.json`):

| Profile                 | Use                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `development`           | Development build with the dev client. Android: APK. iOS: internal distribution to registered devices. |
| `development-simulator` | iOS only: development build for the simulator; needs no Apple Developer account.                     |
| `preview`               | Internal test build. Android: **APK** to install directly. iOS: ad-hoc internal distribution.         |
| `production`            | Store build. Android: **AAB** for Google Play. iOS: store distribution for **TestFlight** and the App Store. |

`appVersionSource` is `remote`: EAS keeps the build number and the version code
and raises them on every production build. The user-facing version is `version`
in `package.json`.

### What a first build needs (not part of this repository)

No account, credential or secret is stored here. Before the first cloud build:

1. `pnpm dlx eas-cli login` with an Expo account, then `pnpm dlx eas-cli init`.
   It prints a project id: set it as `EAS_PROJECT_ID` (in `.env` locally and as
   an EAS environment variable for cloud builds; it is not a secret).
2. **Android**: `eas build --platform android --profile preview` creates and
   keeps the signing keystore at Expo. For Google Play, create the app in the
   Play Console and upload the first AAB by hand; `eas submit` needs a service
   account key afterwards.
3. **iOS**: an Apple Developer account. `eas build --platform ios --profile
   preview` asks for the Apple login, registers devices and creates certificates.
   For TestFlight, create the app in App Store Connect, set its id in `eas.json`
   (`submit.production.ios.ascAppId`) and run `eas submit --platform ios`.
   `ITSAppUsesNonExemptEncryption` is already `false` (HTTPS only).

The workflow `.github/workflows/eas-build.yml` starts a build by hand once the
secret `EXPO_TOKEN` and the variable `EAS_PROJECT_ID` exist.

EAS chooses a default Node.js version for its build machines; if a build asks for
a newer one, pin `node` in the profile of `eas.json`. A local Android build
(`pnpm android`, `eas build --local`) needs the JDK and the Android SDK on the
machine; a local iOS build needs a Mac.

### What was checked without an account

`pnpm run build` bundles both platforms. `expo prebuild` generates the native
projects for both platforms and all variants. The four profiles of `eas.json`
validate against the EAS schema for Android and iOS. No cloud build, no signing
and no run on a device or emulator happened (see the ticket report).

## CI

`.github/workflows/ci.yml` runs `lint`, `check`, `test` and `build` on every push
to `main` and on pull requests. `eas-build.yml` is manual (see above).

## Pages and the submodule

In the Pages repository this app lives in `mobile/`, as a Git submodule with its
own history. Pages gates (`pnpm run check`, `lint`, `build`) ignore `mobile/`; the
app has its own manifest, lockfile, dependencies, tests and builds, and Pages
needs nothing from it. Setup, update and the first-time conversion are described
in the [Pages README](../README.md#pica-mobile-submodule).
