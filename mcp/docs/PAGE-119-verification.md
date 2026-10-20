# PAGE-119 implementation and manual verification boundary

The adapter rebuild and the previously blocked positive manual proofs are now
verified on the private snapshot copy. Igor explicitly approved short Pages APP
plan turns with the existing same-user Codex login and activation/password reset
of copied historical accounts on 2026-10-20 at 09:03 Europe/Berlin. This approval
does not include Pica runtime or other paid providers/models. Only
`gpt-6.1-sol` was used. No mock provider or synthetic successful check was used.

The pre-edit operation/field/rights matrix is in
[the inventory](PAGE-119-inventory.md). The exact commit/tree, final serial gates,
manual receipts and cleanup state are recorded externally in the required
`/home/igor/Results/page119-20261020/resume-20261020-0903/report.md` and
`status.json`. The initial blocked report and all its evidence remain intact.
New screenshots are under
`/mnt/Backup/Screenshots/PAGE-119/resume-20261020-0903/`.

| Current editor capability                                                       | Implemented MCP path                                                       | Actual evidence / remaining boundary                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find/read/create/rename/save same plan                                          | Existing plan tools retained                                               | Real HTTP writes/readbacks and editor group-name save; same owner/team/workspace retained on another account's authorized edit                                                                                                                                                                                          |
| Metadata and optimistic revisions                                               | Existing revision and operation journal                                    | Stale revision, normalized team/project name collision, identical replay and changed operationId content exercised                                                                                                                                                                                                      |
| Full graph projection                                                           | read_plan                                                                  | Node IDs, pinned configuration types, positions, edge ports, bindings and group members are represented; available script/value graph inspected in the rendered editor                                                                                                                                                  |
| Start/end, parameter, task/subtask, script nodes                                | addNode/updateNode/removeNode and parameter aliases                        | Product writes of all these families; real existing ticket and wiki/workspace references, plus one manually created scratch subtask; alias create/update/remove and script content/timeout edits                                                                                                                        |
| Integer coordinates and multiple positioning                                    | updateNode batch                                                           | 0 and 6000 accepted; 6001 refused atomically; editor parser remains authoritative                                                                                                                                                                                                                                       |
| Source/literal/result bindings and flow                                         | bind/unbind/connect/disconnect                                             | Source and literal replacements and script result binding across an explicit flow path persisted/read back; invalid frame ports refused                                                                                                                                                                                 |
| Group create/name/place/remove/dissolve                                         | addNode group, updateNode, removeNode, ungroup                             | Empty portless groups created/renamed/moved/inserted/removed; UI group-name form and save exercised                                                                                                                                                                                                                     |
| Agent membership, reparenting, internal/cross-group edges, member configuration | placeNode and the editor's shared group helpers; nested lookup/replacement | Three real configured agents placed, detached, reparented and regrouped; internal/cross-group edges, result/source bindings and configuration survived readback; populated dissolve also verified                                                                                                                       |
| Profile/model/reasoning/markdown/parameters/directory/run options               | configuration patch, read_plan_sources models/configuration/limits         | Authorized real Codex catalog; low/medium reasoning and model-profile selection saved/read back; same-model selection preserved omitted effort; markdown/parameters/directory/run patches retained other fields; UI configuration save reopened                                                                         |
| Node/group/script/parameter templates                                           | list/read/save_plan_template and insertTemplate                            | Empty-group/script/value proofs retained; populated two-member group saved and inserted twice with six independent IDs, remapped internal flow/result references and preserved configuration; external bindings intentionally excluded by shared template service                                                       |
| Template update/delete                                                          | None in current editor/service/repository                                  | Product gap: deliberately no invented tools or semantics                                                                                                                                                                                                                                                                |
| Script execution                                                                | Product reports scriptUnavailable                                          | Product gap: no script run or fake execution success                                                                                                                                                                                                                                                                    |
| Plan delete                                                                     | delete_plan                                                                | Explicit owner-only, revision-aware, journaled operation; other team account denied; deletion/replay verified on a disposable scratch plan, history preserved                                                                                                                                                           |
| Play/pause/resume/stop                                                          | Explicit saved-plan commands and read_plan_control                         | Real approved Codex APP Play, Pause to durable boundary, Resume of saved frontier revision and Stop to cancelled with confirmed closeout; cross-transport identical replays and stale/changed inputs checked; first turn returned an accepted report                                                                    |
| Sharing/access withdrawal                                                       | Same project/department services                                           | Team edit without ownership transfer; outsider private read denied; usage share remains read-only; membership withdrawal verified against an already initialized client after moving the scratch account to another scratch department                                                                                  |
| Existing private plans and run history                                          | Existing repository formats and permissions                                | Copied rightful owner activated/reset through product; original private Task1 read, explicitly moved to scratch workspace/approved model, edited/saved/reopened with same owner/plan/node IDs/layout/edges. Other plans and all 29 original run snapshots remain preserved; historical instructions were never executed |
| Existing legacy groups, aliases, globals                                        | Shared lossless read upgrade                                               | Preserved by implementation; absent in this snapshot, so historical group/alias behavior is not claimed as manually verified                                                                                                                                                                                            |
| stdio/HTTP contract                                                             | PAGE-120 operations-server retained                                        | Final committed-tree SDK catalogs/readbacks compared; only the recorded installed versions and calls are claimed                                                                                                                                                                                                        |

## Cleanup/reset and Eigenentscheidungen

- Removed the hidden raw group `steps/edges/parameters/bindings` replacement
  path. Explicit member operations reuse the editor's group helpers; no second
  plan service, old/new parallel semantics or transport/auth replacement.
- Shared field whitelists drive node-family admission. Configuration is a patch;
  unspecified fields survive. Model/provider facts derive from the current model
  catalog rather than client-supplied credentials or arbitrary graph JSON.
- Removed the adapter-only uniqueness rule for parameter display names. The
  editor identifies nodes by ID and permits repeated labels, including inserted
  parameter templates. The server's plan-name namespace remains unchanged.
- Edges whose endpoints are both members of one group are retained in that
  group's edge collection on read/save/reparenting. This preserves all expanded
  graph dependencies and ports and keeps those connections in group templates.
  No historical run snapshot is rewritten and no database migration is needed.
- Reused the installed official MCP SDK 2.2.0 and Pages' maintained graph,
  configuration, template, permission and operation-recorder implementations.
  No new library could replace these domain rules; no dependency was added.
- New command acknowledgements and resource reads are personal-client tools.
  The existing plan-session and chat catalogs are not expanded. PAGE-120's
  public OAuth/stdio/HTTP and internal Pica boundaries remain intact.
- Common API limits still apply: requests are at most 64 KiB and responses at
  most 1 MiB. A script/configuration accepted by the editor can exceed these
  budgets; no new chunking protocol was invented. This is a remaining boundary,
  so complete field-size parity is not claimed.

Original snapshot: stopped backup around 2026-10-20 01:17 Europe/Berlin,
migration 061, SHA-256
`83131bcdffdacb9220823f31d28eae57664c1f19463e2b7c9520898327f321f2`.
No active WAL was present. The task uses a fresh private copy under
`/home/igor/Results/page119-20261020/scratch/`, with an explicit loopback
port-3100 config, separate HOME and workspace allowlist. Copied accounts,
providers, tokens, queues and outbound integrations were disabled/sanitized
before initial serving. On authorized resume the stopped scratch state was
backed up first. Only the copied rightful owner and a new private Codex
connection/model grant were enabled. Only `auth.json` was copied into the
connection's isolated 0700/0600 store; no global configuration was copied or
changed. Scratch-only maintenance cleared the pending legacy auto-share flag
before account activation to preserve the original private scope across restart.
Source files and live data were not opened for writing.

No new/expanded tests, fixtures, mocks or harnesses were added. Non-test
check/lint/build gates do not establish functional coverage. Pica native chat-model
runtime remains separately unapproved, as in PAGE-120. The approved APP plan
proof does not establish Pica, other models, every client/version, or paused-run
survival across process shutdown (the existing product deliberately stops active
runs during shutdown). Original historical groups/aliases are absent from this
snapshot and are not claimed as manually verified.
