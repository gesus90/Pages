# z.ai account routing

Settings → Agents asks for the account type when creating a z.ai connection.
Existing connections retain **Standard API** until an administrator explicitly
chooses **GLM Coding Plan**. The key remains encrypted once with its connection.
Changing the account type invalidates access checks, model checks and the old
catalog; the existing linked-key refresh then checks access and reloads catalogs.

| Account              | Fixed API endpoint                    | Native opencode provider |
| -------------------- | ------------------------------------- | ------------------------ |
| Standard prepaid API | `https://api.z.ai/api/paas/v4`        | `zai`                    |
| GLM Coding Plan      | `https://api.z.ai/api/coding/paas/v4` | `zai-coding-plan`        |

Access checks and catalogs use `/models` without generating tokens. Catalog
availability does not prove model entitlement or remaining subscription quota.
Explicit model tests use the selected account endpoint. Existing direct API
plan nodes retain their API execution, using the saved account endpoint. Pica uses these keys only through opencode over ACP.
The first verified connection per linked provider, ordered by name, remains the
key source; changing account type does not invent a second key-selection policy.

## Model capabilities, reasoning levels and context window

The z.ai model listing (`GET /models`) names the model ID only: no name, no
context window, no reasoning level. A model choice therefore knows nothing
about a z.ai model beyond its ID, unless the documentation states it. Pages
fills in what the documentation states for a model of the GLM 5.3 family and
nothing else; no value is derived from a display name, and every other listed
model stays as the listing gave it (unknown reasoning, no window).

| Model ID         | Context window | Reasoning levels (`reasoning_effort`) | Default | Image input |
| ---------------- | -------------- | ------------------------------------- | ------- | ----------- |
| `glm-5.3`        | 1,000,000      | `low`, `high`, `max`                  | `max`   | no          |
| `glm-5.3-flash`  | 1,000,000      | `low`, `high`, `max`                  | `max`   | yes         |
| `glm-5.3-flashx` | 1,000,000      | `low`, `high`, `max`                  | `max`   | yes         |

Sources: the z.ai pages for GLM 5.3 and GLM 5.3 Flash/FlashX
(`docs.z.ai/guides/llm/glm-5.3.md`, `docs.z.ai/guides/vlm/glm-5.3-flash.md`,
read on 2026-11-19). GLM 5.3 always reasons (`thinking.type` supports only
`enabled`) and offers three levels; the Flash pages state the same text
parameters. The levels offered are only those the adapter that runs the model
supports. Plan nodes with a z.ai connection run `zai/<model>` in OpenCode over
ACP, with the base URL of the saved account type. OpenCode 1.18.34 lists the
variants `low`, `high` and `max` for these three models on both `zai` and
`zai-coding-plan`, and a request with the variant `high` or `max` carries
`reasoning_effort: high` or `max` together with `thinking.type: enabled`.
`medium` is no variant: OpenCode then sends no `reasoning_effort` at all, so
Pages neither offers nor saves it for these models.

The capabilities apply when a listing is read and when a stored snapshot is
read, so a catalog saved before they were documented shows them without a new
listing. A session takes its context window from this entry when its adapter
has not reported one; the window the adapter reports (`usage_update.size`,
1,000,000 for these models) always wins. Used context comes only from a
reported `usage_update`; without one the sidebar shows the window with an
empty occupancy (`0 / window`), never the accumulated billing tokens.

The explicit model test sends `thinking.type: enabled` and the chosen level,
or `low`, for these models, because z.ai rejects `thinking.type: disabled`
for them. Any other z.ai model is still tested with thinking disabled.

## Usage and allowance on the Agents page

Every active z.ai connection a person may use has a card on the Agents page.
A connection is usable exactly where its usage scope admits the person;
administrators get no exception, because managing a connection is not using
it. The card shows only what z.ai reports for the key of the connection.

**Data source.** One `GET https://api.z.ai/api/monitor/usage/quota/limit` per
query, the same host for both account types and without a query string. It is
the usage monitor that the usage plugin of z.ai (`glm-plan-usage`) reads; it is
not part of the documented model API, so z.ai may change it without notice. It
starts no model turn and consumes none of the allowance it reports, and a
running answer of the same connection is neither waited for nor interrupted.
The server sends the stored key as the whole `Authorization` value, as the
monitor requires (third-party clients report that a `Bearer` prefix is refused
with 401). The key never leaves the server and is not part of any answer to the
browser.

**Evidence.** The route, the `Authorization` form and the fields come from the
source of the z.ai usage plugin and from published captures of the answer.
Pages has not compared them with the answer to a live key; the parser reads
only the fields above and treats everything else as unknown, so a changed
answer shows as "Query failed" or as missing values, never as an invented one.
A `limits` that is not a list is a changed answer and fails the query; a
missing or empty list is an answer without entries.

**What an answer delivered.** Every successful answer is counted and logged as
the event `integration.zai.quota.answer` of the component `ZaiQuotaProbe` with
the connection id, the reported `plan` tier, these aggregate numbers:
`deliveredEntries` (entries in `limits`), `unsupportedEntries` (entries of a
type no card names), `withoutUsageEntries` (entries of a named type without a
usable share), `evaluatedEntries` (entries the card can read) and
`hiddenEntries` (evaluated entries whose reset had passed when the answer came),
and `diagnostic`: a sanitized per-entry summary (`type`, `outcome`, `kind`,
`unit`, `number`, `percentage`, `currentValue`, `usage`, `remaining` and reset
presence). Delivered is the sum of the unsupported, without-usage and
evaluated entries. The log holds neither the key nor raw response strings. An
answer with the same summary as the last one of the connection is logged at
`debug`, so the notice level shows each change once. Comparing a card with the
answer of a live key therefore needs no raw response: the numbers and entry
summaries say which of the cases below applies.

**Required permission.** Only the key of the connection. The monitor has no
separate management credential. A key the monitor rejects (HTTP 401, 403 or a
business code of the 1000 series, 1220) or a connection without a key shows
"Key missing or rejected" with a link to the connection; nothing it said
before is shown any more.

**Reported fields.** The answer is `{ code, msg, success, data: { limits,
level } }`; `code` other than 200 and `success: false` are failures.

- `level` is the plan tier badge: `lite`, `pro` or `max`; any other value
  reads unknown.
- `limits[].type`: `TOKENS_LIMIT` is "Token allowance", `CREDIT_LIMIT` is
  "Credit allowance" (the rolling five-hour and weekly credit pools of
  credit-based GLM Coding Plan tiers), `TIME_LIMIT` is "MCP usage".
- `limits[].percentage` is the used share in percent; the rest is "left".
- `limits[].nextResetTime` is the Unix time in milliseconds of the next reset;
  without it the entry shows no reset line.
- `limits[].unit` and `number` give the window length: `unit` 3 is hours, 5 is
  months and 6 is weeks.
- `currentValue`, `usage` and `remaining` are the used, total and remaining
  count, shown for `CREDIT_LIMIT` and `TIME_LIMIT` when a positive total is
  reported.

z.ai documents no table of its `unit` codes. The three above are the ones its
plugin and captured answers pair with a known window (five hours, one month,
one week); a window with another code carries no length, and an entry of
another `type` or without a usable share is dropped. Units: tokens entries
are a share only, credit entries are a share (and used/total credits when
reported), and MCP entries are a share and a count of tool calls. Periods:
a five-hour window resets five hours after consumption, the weekly window
every seven days and the MCP allowance monthly, as the plan documentation of
z.ai states; the card shows the reset time z.ai reports and never computes one.

**Unknown values.** A value z.ai does not report stays unknown: no window with
0 %, no tier ("Plan unknown"), no reset line. A successful answer that leaves
no entry on the card reads "No windows reported" with the time of the query,
and the notice names which of three cases applies, because they say different
things about the key:

- `none_reported`: the answer held no entry, so z.ai reports no allowance for
  the key.
- `unusable`: the answer held entries, but none of a type a card names or with a
  usable share; the card shows no value z.ai does not back.
- `elapsed`: the answer held usable entries, but the reset of every one has
  passed, so their period is over and the figures no longer apply. An entry
  leaves the card in the browser too once its reset passes, which also gives
  this case.

The standard prepaid API has no plan tier; whether z.ai reports entries for
such a key is not documented, so its card shows exactly what the answer holds.

**Refresh.** The page asks once when it opens, on every manual refresh of the
page, on every retry of a failed card and every minute through the open push
stream; leaving the page ends
the stream and with it the automatic query. Queries of one connection share a
running or a just finished query. After a temporary failure the card keeps
its last good figures, greyed, with the time of that answer as long as the
person may still use the connection; a replaced key never shows figures read
with the old one. The last answers are kept in memory, so after a server
restart a card is empty until its first query answers.

## Migration and rollback

`075_zai_account_type.sql` adds only `agent_connections.zai_account_type`, with
`api` as the default. It changes no key, chat, selection, profile, plan or run.
Previous SQL readers use explicit columns and can still read the database.
The previous application rejects an unknown migration at startup, as designed.

To run the previous application, stop Pages and back up its database and instance
key. On a separate copy, export the non-secret account choices if they must be
retained, then apply the following rollback before opening that copy with the
previous application. This deliberately discards only the new routing choice;
Coding Plan keys will again require the newer version to run correctly.

```sql
DROP INDEX agent_connections_name_lower;
ALTER TABLE agent_connections DROP COLUMN zai_account_type;
CREATE UNIQUE INDEX agent_connections_name_lower
    ON agent_connections (lower(name));
DELETE FROM schema_migrations WHERE name = '075_zai_account_type.sql';
CHECKPOINT;
```

DuckDB requires temporarily dropping the expression index before altering this
table; recreate it immediately on the copy as shown. No rollback is applied to
a live instance. Reapplying the additive migration
restores the standard API default; reselect Coding Plan explicitly afterwards.
New installation, synthetic upgrade, rollback and the unchanged older migration
set are checked on disposable scratch databases during validation.

Provider references: [Z.ai endpoint configuration](https://zcode.z.ai/en/docs/configuration),
[opencode providers](https://dev.opencode.ai/docs/providers/).
