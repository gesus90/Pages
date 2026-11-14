# Using Pages

[Documentation index](README.md). Navigation, archive rights and appearance.
Ticket files and image viewing are covered in [Ticket attachments](TicketAssets.md).

- [Navigation and draft saving](#navigation-and-draft-saving)
- [Ticket and milestone archive rights](#ticket-and-milestone-archive-rights)

## Navigation and draft saving

Navigation shows the destination and its loading state immediately. Already
available wiki text and ticket description drafts appear while the target loads.
Wiki edits autosave after a short pause; ticket descriptions keep their explicit
Save action and show the new text while saving. Both drafts and background saves
survive navigation, including a target route that fails to load.

The shared status shows pending changes, backend-confirmed success and failures
with Retry. Writes to one object run in order; wiki revisions and the ticket's
original description prevent silently overwriting another edit. Document sequence
numbers also fence late HTTP attempts after an aborted save, even when the new
request restores the original text. Conflicts keep
both versions until the person chooses. Retrying a confirmed text save creates
no extra edit. Every write still checks authorization and validation on the server.

Drafts belong to the current browser document and account. Reloading or closing
with pending changes triggers the browser's data-loss warning; continuing past
that warning discards unconfirmed input. Ticket drafts that have not been saved
remain available when navigating back, with an unsaved indicator.

## Ticket and milestone archive rights

UI and agent archiving share the server decision in `TaskAccessGuard`: the current
`milestones` capability plus responsibility for the visible target's project.
Project responsibility is the project's Manager assignment or the scoped
`manage_projects` capability (managed project departments or `allProjects`).
Ordinary ticket writing, assignment and membership rights do not grant archiving;
an additional `write` capability is not required. Current project access still
applies, and tickets must be public or in the account's own departments. Hidden
descendants prevent archiving an entire subtree. Milestones follow project
visibility and have no separate department assignment.

Administrators qualify in active administrator mode in the UI. Agent tools
keep the existing personal-administrator interpretation, regardless of the
browser's selected role mode; it does not change that mode. Both channels use
the same archive service and policy with their existing account interpretation.

Archiving is soft: ticket rows and workflow status remain, and active descendants
are archived recursively by default. Only newly archived tickets receive archive
history entries. A milestone leaves active views; its incident dependencies are
removed, while its tickets and their assignments remain. There is no automatic
purge. Permanent deletion is a separate administrator action in Pages.

The agent tools `delete_ticket` and `delete_milestone` mean archiving.
They follow the current explicit deletion request without a typed confirmation word
(PAGE-322); rights and target visibility are still checked server-side.
Every call, including an `operationId` replay, rechecks the account, target
visibility and archive rights. `tools/list` advertises operations and proves no
right on a target. Visible unauthorized targets return `FORBIDDEN`; hidden or
missing targets return `NOT_FOUND`. Rejected calls create no archive history,
project activity or operation key. Identical authorized repeats return the stored
result without writing again; changed input returns `CONFLICT`.

### Design themes (PAGE-36)

A design theme changes the colors and surfaces of the whole interface for one
user. Every user chooses theirs in **Settings → Personal → Appearance**; the
choice is stored per user, independently of the color mode (light, dark,
system). Only the identifier of the theme is stored, and the color mode stays a
separate setting: **Light**, **Dark** and **System** above the theme cards pick
the palette of the chosen theme. The cards show four complete designs and a
little of the next row; with more than four designs the list scrolls inside the
picker with the usual fades and opens with the chosen design in view. Pages
ships five themes, all built in and not removable: `standard`, which looks as Pages always did, `arctic-ice`
(PAGE-129), a maritime ice-glass design with one white-and-blue palette for
light and one deep polar-sea palette for dark. Arctic Ice is one card with one
identifier; under **System** it follows the device color scheme, including
changes while Pages is open. Its only texture is a static, barely visible wave
pattern on the permanent sidebar (a gradient, no image, no blur, no animation);
content surfaces, tables and fields stay plain. `jungle-botanical` (PAGE-149)
is one additional card with light botanical and dark forest palettes, selected
by the same Light/Dark/System control. Its own tropical leaf silhouettes stay
in desktop and mobile navigation; content cards remain opaque and plain.
Navigation has separate contrast roles, including its selection and focus
colors. Botanical strengthens field edges and caps the lightness of user-colored
text on light surfaces without changing the stored color or its hue. Status,
priority, workflow and plan colors and colors that users picked keep their
meaning in every theme. `neural-rgb` (PAGE-150) is one card with light graphite-white
and dark graphite/navy palettes. Cyan actions, quiet violet selection edges and
static circuit traces in desktop and mobile navigation follow the same color
mode. Its opaque content cards carry only a subtle edge; the four dashboard
metric icons use decorative cyan, violet, magenta and blue roles. Fields and
selection have accessible contours. `koi-garden` (PAGE-288) is one card with a
lilac morning palette for light and a moonlit palette for dark. An impressionist
painting of a koi pond lies fixed behind the content of every page of the
signed-in frame, washed in an arc around the sidebar edge so that headings near
the navigation stay on a calm ground; cards stay opaque. The sage-green
navigation shows three koi in the free space between the upper and lower items;
the items always win, so a low window, the mobile menu or a long tree covers the
painting with the sidebar color, and the collapsed sidebar shows none. The two
paintings (`assets/themes/koi-garden/`) are loaded only while this design is
active. No theme animation is added. The sign-in page has no signed-in user and therefore
always uses the Standard design.

More themes are installed by putting a directory into `themes/` next to the
database file (`~/.pages/data/themes/` by default). No restart is needed: the
directory is read again whenever somebody opens the appearance settings, and a
theme that was edited or removed is noticed on the next page load. A removed
theme (and one whose manifest became invalid) is no longer offered, and users
who had chosen it see the Standard design until it is installed again; their
stored choice is kept. There is no upload in the interface.

```text
themes/
└── northern-lights/          the directory name is the identifier
    ├── theme.json            manifest (required)
    └── preview.png           preview image (optional, PNG/JPEG/WebP, up to 1 MiB)
```

```json
{
  "schemaVersion": 1,
  "id": "northern-lights",
  "name": { "de": "Nordlicht", "en": "Northern lights" },
  "description": { "de": "Kühle Blautöne.", "en": "Cool blues." },
  "modes": ["light", "dark"],
  "colors": {
    "light": { "background": "#eef6fb", "primary": "#0e7fb8" },
    "dark": { "background": "#0a1822", "primary": "#38bdf8" }
  },
  "materials": { "shadowStrength": 1.5, "shadowEdgeAlpha": 6 },
  "preview": "preview.png"
}
```

- `id`: lower-case words joined by hyphens, beginning with a letter, at most 40
  characters, equal to the directory name. The identifiers of the themes Pages
  ships (`standard`, `arctic-ice`, `jungle-botanical`, `neural-rgb`, `koi-garden`) are reserved; a
  directory with one of them is skipped.
- `name` and `description` hold both languages; names have at most 48 and
  descriptions at most 200 characters.
- `modes` lists the supported color modes. A theme applies only while a mode it
  supports is in effect; in the other mode the Standard design stays.
- `colors` gives hexadecimal colors (`#rgb`, `#rrggbb`, `#rrggbbaa`) per mode.
  The roles are the color tokens `background`, `surface`, `surface-hover`,
  `card`, `sidebar`, `sidebar-hover`, `muted`, `foreground`,
  `muted-foreground`, `border`, `primary`, `primary-hover`, `primary-subtle`,
  `primary-foreground`, `ring`, `sidebar-active` (the selected entry of the
  sidebar), `field`, `field-border`, `field-border-hover` (input fields),
  `panel-body`, `auth-glow-warm`, `auth-glow-cool` and `auth-button-from` (the
  stage of the sign-in pages); a role that is left out keeps the
  Standard value. Pages turns the roles into custom properties itself; a
  manifest cannot carry CSS.
- `materials` (optional) sets `shadowStrength` (0 to 8; the Standard design uses
  1 in light and 4 in dark) and `shadowEdgeAlpha` (0 to 100, in percent).
- Unknown keys and values outside these ranges make the manifest invalid.
- The color of the browser's address bar (`theme-color`) follows the Standard
  palette in every theme.

A directory with an invalid manifest is skipped, never half applied. The reason
is written to the server log once (`Design theme directory "<name>" was
skipped: …`) and shown to administrators below the theme cards.
