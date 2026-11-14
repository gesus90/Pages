# Browser and visual regression suite

PAGE-172 adds an image viewer for the images of a ticket description and, with
it, this suite. It starts a real Chromium and drives a real Pages server, so it
is **not** one of the two unit scopes (`test:backend`, `test:frontend`): those
keep mocking every external boundary and never discover a file here (the files
are `*.spec.ts`; Vitest takes only `*.unit.test.{ts,tsx}` from its own tree).
The suite has no coverage report and is not run by CI, which only runs `check`
and `lint`.

```sh
pnpm run browser:test
```

The script builds Pages (`react-router build`) and then runs
`playwright test --config tests/browser/playwright.config.ts`. The suite uses
[`@playwright/test`](https://playwright.dev) 1.63.0, pinned to the same version
as the `playwright-core` the agent tools already use.

## Prerequisites

1. `pnpm install --frozen-lockfile` in the repository root.
2. A Chromium for Playwright: `pnpm exec playwright install chromium` downloads
   it into the Playwright cache. On a machine that lacks the system libraries
   Chromium needs, `pnpm exec playwright install --with-deps chromium` installs
   them too and needs `sudo`. Playwright looks for the exact browser revision
   of its own version (1.63.0: Chromium 153, revision 1243). A browser
   directory made for another Playwright version, such as a shared tools
   directory, does not serve and the run fails at once with "Executable doesn't
   exist". Install the revision into a directory you can write to and point the
   run at it: `PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers pnpm exec playwright install chromium`,
   then run with the same variable set. `pnpm run browser:test` does this
   itself: it starts the browser of every known cache (`PLAYWRIGHT_BROWSERS_PATH`,
   `$XDG_CACHE_HOME`, `$HOME/.cache`, the cache of the operating-system account),
   because a copied cache can lack the execute bit, and installs the revision
   into `$XDG_CACHE_HOME/pages-browser-tests` when none starts. It never changes
   the mode of a file or switches the Chromium sandbox off.
3. Port 3100 free. A process that already listens on it is never touched:
   `pnpm run browser:test` takes a free loopback port instead, and
   `PAGES_BROWSER_PORT` names one explicitly. Port 3000 is always refused.

`pnpm run browser:test` ends with the exit code of the failed step, with 124
after `PAGES_BROWSER_TIMEOUT_MINUTES` (default 45) per step and with 3 when no
browser can be provided.

## What a run does

`support/global-setup.ts` starts an **isolated instance** and tears it down at
the end:

- `node server.mjs --config <tmp>/config.toml --port 3100` from the production
  build, with a private `HOME`, configuration and attachment store in
  `/tmp/pages-browser-*`, listening on `127.0.0.1` only. A separate private
  PostgreSQL instance supplies the empty setup database. The server
  sees none of the caller's environment except `PATH`. Nothing of a running Pages
  installation, its data directory or port 3000 is read or written.
- It completes the setup wizard over HTTP, as a browser form would, then
  creates the accounts and data below. There is no manual sign-in: the sessions
  are written to Playwright storage state files and picked by the tests with
  `test.use({ account: "reader" })` (default: `admin`).
- At the end both owned servers are stopped and their private directories are
  retained, including the logs, for inspection.

| Seeded                         | What it is for                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `admin`                        | Administrator created by the setup wizard.                                           |
| `reader`                       | Role without write right, bound to departments. Sees open projects only.            |
| VIEW-1 `single`                | One landscape image.                                                                 |
| VIEW-2 `gallery`               | Five images (landscape, portrait, square, 4800×2700, panorama) in a long text.       |
| VIEW-3 `linked`                | An image inside a link, a plain image, an ordinary and an external link.             |
| VIEW-4 `missing`               | Three images; the second attachment was deleted.                                     |
| VIEW-5 `editing`               | One image, for the explicit editing of the description.                              |
| VIEW-6 `hidden`                | Three images; the second belongs to SECR-1, a ticket the reader cannot see.          |
| SECR-1                         | Ticket of a project of the department "Confidential".                               |
| `Team plan`                    | Empty agent plan of `admin` in project "Plans" (workspace in the instance directory, synthetic GitHub link without token or sync), plus the department "A-Team" (PAGE-329). |

The images are drawn by `support/chart-png.ts`: flat colors and hard edges, no
text, a dark border, one color per corner, a circle, a diagonal and as many
marks at the top as the image has in its row. Identical options give identical
bytes, so a crop, a stretch or a mix-up shows on the chart. Everything is
synthetic; no production content, secret or external image is used, and the
tests need no network: the one external link is answered by a Playwright route.

## Specs and projects

| Spec                                   | Projects              | Checks                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket-image-viewer.spec.ts`          | `desktop-light`       | The original defect; exactly the clicked image opens, no editor, no write request, ticket data unchanged; arrows and keys, both ends, single image; Escape and close button restore focus and scroll position (page and ticket dialog); Escape closes only the viewer; focus trap; explicit editing still works; proportions and size; arrow placement; accessibility tree. |
| `ticket-image-viewer.states.spec.ts`   | `desktop-light`       | Image in a link (no navigation, no editor, link target offered, focus returns to the link); ordinary and external links; deleted attachment; loading state; anonymous access to the attachment route is refused; only the protected route is used.   |
| `ticket-image-viewer.reader.spec.ts`   | `desktop-light`       | A reader without write right (checked: a write is refused with 403) can open and page through images, no write request; an attachment of an invisible ticket answers 404 and the viewer reports it.                                       |
| `ticket-image-viewer.mobile.spec.ts`   | `mobile-light`        | Taps, touch targets of at least 44×44, controls inside the screen and not over the picture, no horizontal overflow.                                                                                                                       |
| `agent-plan-teams.spec.ts`             | `desktop-light`       | PAGE-329: in the plan editor an administrator adds the department "A-Team" as a team (all three rights by default), takes away "run", hands the plan to the reader; the "Admin access" badge appears, the dialog shows the saved rights and owner, and the plan history lists the team and owner changes. |
| `chat-mentions.spec.ts`                | `desktop-light`       | PAGE-326: alias and member suggestions, disabled people outside the group, keyboard and mouse insertion, atomic chip deletion, filtering and dismissal, own and other mention highlighting, active/missing decision-model status, decision reasons and fallback. The authenticated app uses a synthetic chat-directory HTTP response; no model connection is started. |
| `koi-garden-settings.spec.ts`          | `desktop-light`       | PAGE-324: in Koi Garden the sticky heading of the personal settings is invisible at rest and, stuck, lies on the translucent, blurred veil of the design with a fade from the same veil (no opaque band); text contrast on the veil over black and white at least 4.5:1; light, dark (`emulateMedia`) and 390 px wide; the Standard design keeps the opaque page color. Screenshots at the top and scrolled are attached to the report. The account is set back to Standard after each test. |
| `ticket-image-viewer.visual.spec.ts`   | all four              | Screenshots, see below.                                                                                                                                                                                                                    |

Projects: `desktop-light` and `desktop-dark` at 1440×900, `mobile-light` and
`mobile-dark` at 390×844 with touch. The theme is the user setting "system" and
Chromium's `prefers-color-scheme`. Locale `en-US`, time zone UTC, reduced
motion.

A negative check such as "the editor stayed closed" is only meaningful once
the editor had time to appear, because it loads lazily. `expectNotEditing`
therefore also requires the edit button to still be there, which the edit mode
removes at once.

## Visual comparison

`ticket-image-viewer.visual.spec.ts` compares full-page screenshots of these
states in every project (8 viewer states, keyboard focus, and the description
itself): single image; first image (previous disabled); portrait; large image
scaled down; last image (next disabled); image in a link; deleted attachment;
loading spinner; keyboard focus ring; the description with its images.

- `support/viewer-visual.css` hides everything in the page except the viewer
  dialog. The ticket behind the viewer shows dates and other text that change
  with every run and is not what these screenshots check. The viewer, its
  controls and the scrim stay as they are; nothing inside the viewer is masked.
- Tolerance: **no** differing pixel (`maxDiffPixels: 0`) with a color
  `threshold` of 0.1, which only ignores sub-visible anti-aliasing noise. The
  same Chromium, fonts and flat-color charts reproduce exactly (three runs in a
  row passed), and one missing 44×44 control is far above any noise. A looser
  ratio would let such a control go missing unnoticed.
- Baselines are in `__screenshots__/<spec>/<state>-<project>-linux.png`. They
  were made with the Chromium headless shell of Playwright 1.63.0 on Linux; other
  platforms need their own baselines.
- A difference fails the test and leaves the **expected, actual and diff**
  images in `<results>/artifacts/<test>/` (`*-expected.png`, `*-actual.png`,
  `*-diff.png`), plus a trace. `<results>/report/index.html` is the HTML report.
- `<results>` lies outside the checkout: generated reports contain JavaScript
  and must never reach the gates. `pnpm run browser:test` creates one directory
  per run under `$XDG_STATE_HOME/pages-browser-tests/`, so a run keeps the
  evidence of the previous one, and prints it. `PAGES_BROWSER_RESULTS` names
  another directory outside the checkout. The legacy `tests/browser/results/`
  of older runs stays git-ignored and is ignored by ESLint.

### Changing a baseline

Never update a baseline only to make a run green. First find out whether the
difference is intended: open the diff image, fix a layout error in the code and
run again. Only when the new look is the wanted one, regenerate and **look at
the new images** against the requirements (whole image, correct proportion,
controls visible and not over the picture, readable in light and dark, disabled
direction clearly dimmed):

```sh
pnpm exec playwright test --config tests/browser/playwright.config.ts --update-snapshots=all ticket-image-viewer.visual
```

## Running a part

```sh
# one spec or test, one project
pnpm exec playwright test --config tests/browser/playwright.config.ts --project=desktop-light -g "original defect"
```

`pnpm run browser:test` builds first; the command above runs against the
existing `build/`, so build before it after a source change.

### Seeing the original defect

`PAGES_BROWSER_SERVER_ROOT` points the suite at another checkout with its own
`build/`. With a copy of the repository in which `ticket-description.tsx` is
restored to the state before PAGE-172, `-g "original defect"` fails because the
description enters the edit mode on an image click (the edit button disappears);
with the current code it passes.

The copy needs `node_modules` (a symlink to the original works) and its own
build, made with `./node_modules/.bin/react-router build` inside the copy, as
`pnpm` there checks the dependency state of a workspace it does not own. Then:

```sh
PAGES_BROWSER_SERVER_ROOT=<copy> PAGES_BROWSER_RESULTS=<results dir> \
  pnpm exec playwright test --config tests/browser/playwright.config.ts \
  --project=desktop-light -g "original defect"
```

The same way a deliberate layout error shows what a visual failure looks like:
shrink `size-11` in `app/components/ui/image-viewer/viewer-controls.tsx` of the
copy, build it again and run `ticket-image-viewer.visual`. Every state with the
viewer fails and `<results dir>/artifacts/<test>/` holds `*-expected.png`,
`*-actual.png` and `*-diff.png`, with the changed pixels in red.

## Layout

```
playwright.config.ts   projects, tolerances, reporters, snapshot paths
support/               instance start, HTTP client, seeding, charts, page object, checks
specs/                 the specs above
__screenshots__/       reviewed baselines
```

The files follow `GUIDELINES.md` (`pnpm run lint` and `pnpm run check` cover
`tests/`), but they import nothing from `app/` or `backend/`: the application
is only ever touched through its HTTP interface and its DOM.
