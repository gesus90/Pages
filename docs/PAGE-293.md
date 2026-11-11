# PAGE-293: Managed Claude Code CLI, shared invocation path and Fable 5.2

This file records what was observed on 10 November 2026, what PAGE-293 changes
and what still needs an explicit approval. It keeps five questions apart:
the shell version, the selection that is effective in Pages, the displayed
check values, the catalog availability and the real account access.

## Observed state before the change

| Question                     | Observation                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                        | `command -v claude` → `/home/igor/.nvm/versions/node/v24.22.1/bin/claude` → `../lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`, `2.1.322 (Claude Code)`. This is the earlier, reversible shell unification. It is not the installation Pages runs.                                                                                                                                                         |
| Effective selection in Pages | `tools/claude/active.json` of the live instance: `{"current":"2.1.293-a4502e5f-…","previous":null,"approvedTarget":"2.1.293"}`. The running ACP sessions, including the session that worked on this ticket, started `tools/claude/releases/2.1.293-a4502e5f-…/node_modules/.bin/claude` through `claude-agent-acp` 0.90.0. A direct `--version` of that file prints `2.1.293 (Claude Code)`.                           |
| Service PATH                 | `/etc/pages/default/runtime.env` starts with the nvm `bin` directory, so the system fallback would find the nvm 2.1.322. It is not used while a managed generation is active.                                                                                                                                                                                                                                          |
| Displayed check values       | The saved CLI model test of 10 November 2026 11:19 names 2.1.293 and `claude-sonnet-5-5`. It is a real earlier call and stays a dated check result; it says nothing about the CLI in effect later.                                                                                                                                                                                                                     |
| Catalog availability         | The picker of each CLI, read with the catalog request of `ClaudeCodeCli.listModels` and an empty temporary configuration (no account, `account.tokenSource: "none"`, no model call): 2.1.293 resolves `fable` to `claude-fable-5-1`; 2.1.322 resolves `fable` to `claude-fable-5-2` with the efforts `low`, `medium`, `high`, `xhigh`, `max`. The missing Fable 5.2 in the stored catalog follows from the pinned CLI. |
| Account access               | Not verified. The picker of the signed-in connection was not read, because that needs the live credentials, and no model was called.                                                                                                                                                                                                                                                                                   |

The npm registry lists 2.1.321 (9 November 2026) and 2.1.322 (10 November 2026,
dist-tag `latest`; `stable` is still 2.1.311, below the Fable 5.2 minimum).
The approved target is the exact version 2.1.322, not a dist-tag.

[Claude Fable models on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan),
read on 10 November 2026: in Claude Code, Fable 5.2 requires 2.1.321 or later.
Fable models are available on paid plans only; Pro and standard Team or
seat-based Enterprise seats use pay-as-you-go usage credits; on Team and
Enterprise an owner controls which models are available, and on Enterprise
Fable 5.2 stays off until an admin enables it. Fable usage counts toward the
weekly limits. The article names no model IDs and no effort levels.

## Effective resolution

1. `AgentToolRegistry.ts` fixes the target (`version`) and the allowlist
   (`versions`) of every tool. Health checks run `--version` and accept only an
   allowlisted version (`isAgentToolVersionSupported`).
2. `AgentToolFiles.current` reads the activated generation from
   `tools/<tool>/active.json`.
3. `AgentToolManagerService.inspect` takes that generation, otherwise the system
   location of `AgentToolServices`: `CliLocator` searches the service PATH and the
   directory of the running Node; `isTrustedSystemLocation` refuses a file whose
   real path lies in the service home outside that Node's `bin` and
   `lib/node_modules`. The checked location is cached per tool (`states`).
4. `ensureTool` returns the cached location only when its check is `ready`;
   otherwise it installs a managed generation. `locate` serves the same cache to
   `CliLocator`.
5. Login, status check, catalog, CLI test and logout (`AgentCliRuntime`) start
   the location that `ensureProvider` returned. Plan and ACP sessions get theirs
   from `ensureReady`, which pins it for the session; `planClaudeAcpLaunch` passes
   it as `CLAUDE_CODE_EXECUTABLE`. The health check of `claude_acp` initializes
   the adapter with the same location.

## Changes

- Claude Code target 2.1.322; the allowlist keeps 2.1.293 only so the retained
  generation can be rolled back to. 2.1.311, 2.1.321, 2.1.323 and `latest` are
  refused.
- `AgentCliRuntime` uses the location returned by `ensureProvider` instead of a
  second lookup, so a concurrent activation cannot split one operation across
  two CLIs.
- Each activation and rollback of Claude Code points `tools/claude/bin/claude`
  at the active generation, written after the release pointer with an atomic
  rename. The pointer stays authoritative: a link that cannot follow it is
  logged and shown as not current, and the activation stands. Pages itself never
  starts the link; sessions keep their concrete generation.
- The Tools card names the executable of new calls, the rollback generation and
  whether the terminal entry is current. The version is labelled as the result
  of the last check; CLI connection checks label their CLI version as the one
  of that check and say that it is a stored result, not a new call. The catalog
  message says that a listing proves neither account access nor a model
  response.

Unchanged: trust check, health checks, session pins, ACP adapter allowlist
(0.90.x), other providers, plan models, efforts and connection releases.

## Functional check in an isolated instance

Production build, own temporary PostgreSQL, loopback port, own `HOME`; the
Claude card of **Settings → Agents → Tools** was driven in Chromium:

| Step         | Card                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Check        | Ready · system installation · 2.1.322 · executable `/home/igor/.nvm/versions/node/v24.22.1/bin/claude` (system fallback, outside the instance home).               |
| Repair       | Ready · Pages-managed · 2.1.322 · executable `tools/claude/releases/2.1.322-de85cc60-…/node_modules/.bin/claude` · rollback generation — · terminal entry current. |
| Repair again | Executable `…/2.1.322-01049252-…`, rollback generation `2.1.322-de85cc60-…`, terminal entry current.                                                               |
| Roll back    | Executable `…/2.1.322-de85cc60-…`, rollback generation `2.1.322-01049252-…`, terminal entry current.                                                               |

After the rollback `tools/claude/bin/claude` → `../releases/2.1.322-de85cc60-…/node_modules/.bin/claude`;
its real path equals the real path of the executable, and it prints
`2.1.322 (Claude Code)`.

ACP contract: `claude-agent-acp` 0.90.0 with `CLAUDE_CODE_EXECUTABLE` set to
that managed generation and an empty configuration, without sign-in or prompt:
`initialize` → 0.90.0, protocol 1; `session/new` started exactly that file and
answered with the models `default`, `opus`, `fable`, `sonnet`, `haiku` and the
efforts `low` to `max`; `session/close` succeeded.

No automated test was added; QA runs the existing suites.

## Activation (needs an explicit approval)

Nothing below was done by this ticket.

1. Deploy and **restart the Pages services**. The target is source code;
   `restore` applies it at start: it installs 2.1.322 as a new generation,
   checks it, activates it and keeps `2.1.293-a4502e5f-…` as the rollback
   generation. The generation switch leaves running sessions on their pinned
   file, but the restart itself can interrupt them, so schedule it without
   active runs.
2. Check the Claude card: Pages-managed, 2.1.322, executable in `releases/2.1.322-…`,
   rollback generation `2.1.293-a4502e5f-…`, terminal entry current.
3. Terminal of the administrator: start `/home/igor/.pages/tools/claude/bin/claude`,
   for example with `ln -s /home/igor/.pages/tools/claude/bin/claude /home/igor/.local/bin/claude`
   ahead of the nvm `bin` in `PATH`, or with that `bin` directory first in
   `PATH`. Set `DISABLE_AUTOUPDATER=1` for it: only Pages updates a managed
   generation. Verify that `readlink -f "$(command -v claude)"` equals the
   `readlink -f` of the card's executable. The nvm package stays as the
   previous shell state; removing the link or the `PATH` entry returns to it.
4. Refresh the catalog of the Claude connection with **Refresh catalog**. When
   the CLI offers Fable 5.2 to the signed-in account, the catalog lists
   `claude-fable-5-2` with the efforts the CLI reports. Nothing is written by
   hand and no plan model is switched.
5. If Fable 5.2 is missing although the card shows 2.1.322, the remaining limit
   is the account, plan or organization (see the article above), not the CLI.
   Only a model test or a run proves inference; it is billed and needs its own
   approval.

Rollback: **Roll back** on the Claude card checks `2.1.293-a4502e5f-…`
(still allowlisted), activates it and keeps the reviewed target, so a restart
does not update again; the terminal entry follows. Reverting the commit and
restarting returns to the old pin.

## Open

- Productive activation, the restart and the terminal switch.
- Catalog refresh with the signed-in account; until then the live catalog
  stays without Fable 5.2.
- Account, plan and organization access to Fable 5.2 and any inference are
  unconfirmed.
