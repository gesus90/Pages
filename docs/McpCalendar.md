# Calendar API for MCP (PAGE-301)

The stand-alone Pages MCP program reads and changes the calendar of the
paired account through `/api/mcp/v1/calendar`. The API offers the tasks of
the calendar page with the same `CalendarService` that the interface, Pica
Mobile (`calendar.v1`) and Pica use, so visibility, edit rights, revisions,
recurrence and scopes follow exactly one set of rules. The MCP program and
its tool registration are not part of this repository; this file is the
server side of the shared contract.

Code: `backend/service/mcp/calendar/` (API, context, reads, writes,
lifecycle, projection, contract, requests, errors),
`app/lib/mcp-calendar-route.server.ts`, the route table entry
`mcpCalendarRoutes` in `app/routes.ts` and the route files
`app/routes/api-mcp-v1-calendar-*.ts`.

## Access and rights

- Every request needs `Authorization: Bearer <device token>` of a paired
  machine (PAGE-243). Cookies play no part. A missing, unknown or revoked
  token and a deleted or deactivated account answer `401 invalid_token` on
  every call, for a repeated `operationId` as well.
- The account acts with its own rights, read anew on every call. Tool
  arguments never supply actor facts: the creator of a new event is always
  the authenticated account, and unknown fields such as `createdBy` are
  refused with `invalid_request`.
- Reads show only what concerns the account: own events, invitations
  (directly, by group or by department), project calendars of member
  projects, project dates, due tickets and milestones.
- Only the creator of an event, or an administrator, changes or deletes it;
  only invited persons answer an invitation (agents never do).
- An **agent account** acts with its own rights as well. An agent whose
  access is "read only" (or has no stored access, the default of the agent
  administration) may call the four reads; every change, the deletion
  question included, answers `403 forbidden` before anything is looked up
  or replayed, and its read answers carry `editable: false` and no
  permission.
- An event the account cannot see answers `404 not_found`, exactly like one
  that does not exist. Errors never name data of foreign events.

## Common rules

- **Times** are ISO-8601 with an offset, answered in the account's time zone
  (`timeZone` of every list and event answer). An all-day event carries
  dates only, `end` being its last day (inclusive). Requests take a date
  `YYYY-MM-DD` or an instant with an offset or `Z`.
- **Identifiers:** `id` of a list entry names the entry (for a series: one
  occurrence), `eventId` the stored event behind it. Project dates, due
  tickets and milestones are derived, read-only entries with `eventId: null`
  and `editable: false`; reading or changing them as an event answers
  `not_found`. An event path takes the event ID or an occurrence ID.
- **Operation IDs:** every change carries `operationId`, a UUID. The same
  `operationId` with the same request answers the stored answer of the first
  call, body for body, and creates or changes nothing a second time; with
  another request it answers `409 conflict`. The first answer of a creation
  is `201`, its repetition `200`. A failed call stores nothing, so it can be
  repeated with the same ID. A deletion question (without `confirmed`) is no
  change and is never stored.
- **Expected revision:** changes and deletions take `expectedRevision`, the
  `revision` of the last read. Another stored revision answers
  `409 conflict` with `currentRevision`, and nothing changes; the client
  reads again and decides.
- **Scopes:** `this`, `following` or `all`. A series needs a `scope`
  (`invalid_request` without one); `this` and `following` also need
  `occurrenceStart`, the original start of the occurrence (or the occurrence
  ID in the path). A single event counts as `all` without a scope.
- **Change answers:** create, change and response answer the stored event
  like `read_calendar_event`.
- **Bodies** are JSON objects of at most 256 KiB (`413 too_large` above).
  Every body and query is checked strictly; an unknown or repeated
  parameter is `invalid_request`.

### Errors

The body is `{ "error": "<code>" }`, plus `currentRevision` for a stale
revision. No message of a service and no part of the request is returned.

| Code                 | Status | Meaning                                                                               |
| -------------------- | ------ | ------------------------------------------------------------------------------------- |
| `invalid_request`    | 400    | Malformed body or query, unknown field, invalid value or range, series without scope  |
| `invalid_token`      | 401    | Token missing, unknown or revoked; account gone or deactivated                        |
| `forbidden`          | 403    | No right for this change, not invited, project calendar not writable, read-only agent |
| `not_found`          | 404    | Unknown or invisible event, or a derived entry read as an event                       |
| `conflict`           | 409    | Stale `expectedRevision` (with `currentRevision`), or `operationId` reused            |
| `too_large`          | 413    | Body above 256 KiB, or a range with more than 2,000 entries                           |
| `rate_limited`       | 429    | The token check asks to slow down; `Retry-After` names the seconds                    |
| `server_unavailable` | 503    | The database is unavailable; `Retry-After` names the seconds                          |

A method a resource does not serve answers `405` with `Allow`.

## Operations

All paths below `/api/mcp/v1/calendar`. The static paths `options`,
`invitees` and `entries` are siblings of `events` and are never read as
event IDs.

### `GET /options` — read_calendar_options

No parameters. Answer: `timeZone`, `targets[] { projectId, name }` (the
calendars a new event may go into; `projectId: null` is "my events"),
`frequencies`, `weekdays`, `scopes` and `limits` (`CALENDAR_LIMITS`:
title 200, description 10,000, invitees 100, range 92 days and 2,000
entries, interval up to 99, count up to 999, invitee search up to 50).

### `GET /invitees?text=&limit=` — search_calendar_invitees

`text` (part of a name, up to 200 characters, optional), `limit` (1–50,
default 20). Answer: `invitees[] { kind, id, name }` with `kind` one of
`person`, `agent`, `group`, `department`; the account itself is never
offered.

### `GET /entries?from=&to=&kinds=` — list_calendar

`from` and `to` are dates (both inclusive) or instants (`to` exclusive), at
most 92 days apart. `kinds` is an optional comma-separated subset of
`personal`, `project`, `due`, `milestone`; without it every calendar is
listed. Answer: `from`, `to`, `timeZone`, `entries[]` with `id, eventId,
occurrenceStart, title, start, end, allDay, calendar { kind, projectId, name },
source { kind, ticketKey }, myResponse, editable`. `source.kind` is `event`,
`project_event`, `ticket` or `milestone`; `ticketKey` is set for due
tickets only. More than 2,000 entries answer `413 too_large`: ask for a
shorter range.

### `GET /events/{eventId}` — read_calendar_event

Answer: `timeZone` and `event` with the fields of a list entry (`id` and
`eventId` both the stored event, `occurrenceStart: null`, `source.kind:
event`) and `description, recurrence { frequency, interval, weekdays, until,
count } | null, invitees[] { kind, id, name }, responses[] { userId, name,
response }, createdBy { id, name }, exceptions[] { occurrenceStart,
isCancelled }, permissions { canEdit, canDelete, canRespond }, revision`.

### `POST /events` — create_calendar_event

Body: `operationId, title, start, end, allDay`, optional `description`
(default `""`), `calendarProjectId` (default `null`, "my events"; otherwise
a project of `targets`), `invitees[] { kind, id }` (default `[]`, at most 100) and `recurrence` (default `null`). Answer `201`: the stored event like
`read_calendar_event`.

### `PATCH /events/{eventId}` — update_calendar_event

Body: `operationId, expectedRevision`, `scope` and `occurrenceStart` as in
the common rules, and at least one of `title, description, start, end,
allDay, calendarProjectId, invitees, recurrence`. Fields left out stay as
they are; `invitees` replaces the whole list. Answer: the stored event.

### `POST /events/{eventId}/response` — respond_calendar_event

Body: `operationId, response` (`accepted` or `declined`). The answer counts
for the whole series. Only invited persons answer; the creator, agents and
anyone else get `403 forbidden`. Answer: the stored event.

### `POST /events/{eventId}/delete` — delete_calendar_event

Body: `operationId, expectedRevision`, `scope` and `occurrenceStart` as in
the common rules, and `confirmed`. Deleting takes two steps:

1. Without `confirmed: true` nothing changes. The answer is the question
   `{ confirmationRequired: true, event: { id, title, start }, scope,
affectedOccurrences, invitedCount }`, with `affectedOccurrences` a number
   or `"unbegrenzt"` for an endless series. The client shows it to the
   person.
2. Only after the person agreed, the client repeats the call with
   `confirmed: true`. The answer is `{ deleted: true, eventId, scope }`;
   invitees no longer see the deleted occurrences.

The same rights, revision and scope rules as for a change apply to both
steps.

## Verification

`tests/backend/backend/service/mcp/calendar/` checks the requests, the
projection onto the contract, the operation IDs, the read-only agents, the
two-step deletion, the error mapping and the route answers against a mocked
`CalendarService` and token check; no database and no MCP server or client
is started.
