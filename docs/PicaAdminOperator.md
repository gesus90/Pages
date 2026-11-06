# Pica administrator operator (PAGE-180)

An administrator can let Pica manage Pages: accounts, roles, groups,
departments, project members, agent connections and the instance settings, plus
every other operation of the shared agent catalog. A normal person keeps exactly
the tools and limits Pica had before. There is no second agent architecture: the
administrator catalog is registered on the same `RuntimeToolRegistry`, reaches
the same services through the same `ChatToolExecutor`, and runs in the same
ACP/MCP bridge, job, session and journal.

## Who gets which tools

`RuntimeToolRegistry` knows two access classes. A tool is `user` (the default) or
`administrator`.

- **Listing.** `describe({ includeAdministrator: false })` leaves the
  administrator tools out. A job lists them to its agent session only when the
  person is an administrator when the job starts. The instruction tells the
  model about them in the same case only.
- **Enforcement.** The listing is a convenience, not the protection. Every call of
  an administrator tool asks the registry's gate whether the person is an
  administrator right now. The answer comes from persisted account facts: an
  active account, no pending password change and the active admin mode. A denied
  call never reaches a handler (`RuntimeToolDeniedError`, reported to the agent
  as `ADMIN_REQUIRED`). A registry without a gate refuses every administrator
  tool; an error while asking counts as no answer, never as consent.
- **Normal users.** They never see an administrator tool, and guessing its name
  gets `ADMIN_REQUIRED` and an audit entry. Their own tools, rights, confirmations
  and budgets are unchanged.

The services behind the tools check the rights again: `AgentAdministrationService`
resolves the administrator inside its own transaction, the connection and
instance services check it on their own. No actor or channel comes from a model
argument.

## The catalog

The administrator catalog is derived from the static tool contracts plan agents
use (`definition/AgentTools`), so a new operation of the agent API reaches
administrators without a second description (`PicaOperatorCatalog.ts`):

| Area                      | Tools                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts                  | `list_admin_users`, `set_admin_user_name`, `set_admin_user_departments`, `set_admin_user_scope`, `set_admin_user_administrator`, `set_admin_user_active`                                                                               |
| Roles                     | `list_admin_roles`, `list_admin_permissions`, `set_admin_role_permissions`, `assign_admin_role`, `save_admin_role`, `delete_admin_role`                                                                                                |
| Groups, departments       | `list_admin_groups`, `update_admin_group`, `create_admin_group`, `delete_admin_group`, `list_admin_departments`, `rename_admin_department`, `create_admin_department`, `delete_admin_department`, `list_groups`, `list_visible_people` |
| Projects                  | `read_admin_project_members`, `read_project_members`, `assign_project_member`, `remove_project_member`, `list_project_tickets`, `read_project_activity`, `resolve_project`                                                             |
| Connections, settings     | `list_admin_connections`, `set_admin_connection_active`, `read_admin_settings`, `set_admin_company_name`                                                                                                                               |
| Agents                    | `list_agents`, `read_agent`, `list_agent_models`                                                                                                                                                                                       |
| Audit                     | `read_admin_activity`                                                                                                                                                                                                                  |
| Tickets, wiki, milestones | the ticket links, checklists, tree, wiki anchors, icons and covers, milestone dependencies and initiatives, people search and the other operations the chat catalog knows and no tool of every person covers                           |
| Host                      | `admin_files_find`, `admin_files_read`, `admin_files_edit`, `admin_browser_open`, `admin_browser_action` (see [PicaAdminTools](PicaAdminTools.md))                                                                                     |
| Operator browser          | the visual `browser_*` tools (see [PicaOperatorBrowser](PicaOperatorBrowser.md))                                                                                                                                                       |

`PICA_UNOFFERED_OPERATIONS` names the operations no native tool offers, each with
its reason. A test proves that every operation of the chat catalog is reachable
for an administrator or listed there:

- `admin.users.create` and `admin.users.resetPassword`: the one-time password
  reaches only the person in the interface. A tool result would carry it to the
  model, so these two stay in the user administration.
- `agents.create`, `agents.update`, `agents.clone`, `agents.delete`: retired.
  Nodes of a plan carry their model and instruction.

The permanent deletion of projects, imports, uploads, the workspace registry and
the deletion of chat sessions stay MCP-only, as before.

### New operations

The chat gets four operations on regular services
(`ChatInstanceAdministrationService`, wired for the chat router only):

| Operation                       | Service                                     | Notes                                                                                     |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `admin.connections.list`        | `AgentConnectionService.list`               | Provider, state, `hasApiKey`, test model. Never a key, CLI account label or check detail. |
| `admin.connections.setActive`   | `AgentConnectionService.setActive`          | Always needs the confirmation. Carries `expectedIsActive`.                                |
| `admin.settings.read`           | `InstanceSettingsService.getBranding`       | Company name and whether a logo exists.                                                   |
| `admin.settings.setCompanyName` | `InstanceSettingsService.updateCompanyName` | Carries `expectedCompanyName`.                                                            |

A write needs the administrator, the last read state (`CONFLICT` otherwise) and
an `operationId`; a repetition with identical parameters returns the stored
result. Changes are recorded in the administration audit trail as source `ai`.
The audit entry and the replay key are stored right after the change in one
transaction. A crash between the change and that record loses the entry; the
connection service owns its own transaction, so it cannot share the audit one.

## Critical changes need a confirmation

Pica's administrator tools never take `operationId` or `confirmation` from the
model; their schemas do not contain them. Pages sets them:

- **Always critical:** `admin.users.setAdministrator`, `admin.users.setActive`,
  `admin.groups.delete`, `admin.departments.delete`, `admin.roles.delete`,
  `admin.connections.setActive`, `projects.member.remove`
  (`isPicaCriticalOperation`).
- **Critical when a service says so:** every change that withdraws rights or
  memberships (role permissions, role assignment, departments, scope, group
  members, role save). The service answers `CONFIRMATION_REQUIRED` and changes
  nothing.

The first call of a critical change returns `CONFIRMATION_REQUIRED` with the exact
operation, its parameters and the confirmation word of the person's language
(`LÖSCHEN` or `DELETE`). Pica names the change to the person and asks for the
word. `ChatToolExecutor.runAdmin` accepts it only when the person's **next
message consists of the word alone** and the model repeats the **identical call**
in that later turn. Neither Pica's text, history, attachments nor tool results can
confirm. The confirmation is bound to one operation with one set of parameters and
is used up by it; it expires after ten minutes. The same call in the same turn
that asked is never confirmed.

## Withdrawing the right stops the work

- Every privileged call resolves the administrator right before its handler and
  again after it (`PicaAdminService.runPrivileged`). If the right ended while the
  action ran, the agent gets `ADMIN_REQUIRED` instead of the result.
- From the first privileged call on, the scope of the job is watched every
  250 ms. Losing the right aborts the job's signal with the reason `adminRevoked`:
  running tool calls end, later ones are refused, browsers close, and the job
  ends as _failed_ with the readable status "Pica was stopped because your
  administrator rights were withdrawn".
- A database transaction that already started finishes atomically; its change is
  neither half-applied nor rolled back by the stop. The audit trail shows it.
- The scope of a chat job ends with the job. Only a task of the administrator
  console expires after ten minutes.

## Calls, results and errors are visible and can be cancelled

- The job journal records every tool call (`running`, then `completed` or
  `failed` with the stable error code), now also whether it was an administrator
  call (`isPrivileged`). Parameters and results stay out of the journal.
- The chat shows the administrator calls live and after a stop: the tool, its
  state and the reason of a failure ("waiting for your confirmation", "administrator
  right missing or withdrawn", …). Ordinary calls stay in the quiet activity row.
- _Stop_ ends the running job: the signal aborts pending calls, and an action
  that has not reached its service never starts.
- Every call counts against the 256-call budget of the turn.

## Audit

`pica.admin.tool` events record person, conversation, run, operation and status
(`started`, `executed`, `completed`, `denied` or a stable error code) and an
opaque SHA-256 digest of the arguments. `executed` precedes the final right check,
so a change that committed stays traceable even if the right was withdrawn
meanwhile. Writes of the administration are also stored in the administration
audit trail (`read_admin_activity`, source `ai`). Parameters, results, names,
passwords and keys are never log fields.

## ACP and MCP compatibility

Plan agents keep their catalog, names, schemas and descriptions. The chat-only
operations are no entries of the shared tool registry; the descriptions the native
tools show differ from the shared ones only because the chat never lets the model
pass a confirmation. The ACP bridge keeps its endpoint, token and protocol; it
lists a role-dependent catalog and marks privileged calls in the journal.

## Decisions and limits

- Creating accounts and resetting passwords stay in the interface (see above).
- The connection key, a CLI account and any credential are never read or
  changed by Pica.
- Ordinary Pica deletions (tickets, wiki pages, milestones) still run on request
  without a confirmation line (PAGE-68); the confirmation applies to the
  administration.
- Permanent project deletion stays MCP-only.
