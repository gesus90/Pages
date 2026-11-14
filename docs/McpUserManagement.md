# User management API for MCP (PAGE-280)

The stand-alone Pages MCP program manages accounts, roles, departments and
groups through `/api/mcp/v1`. The API offers the tasks of the user management
page of the interface, with the same services and the same rules. The MCP
program and its tool registration are not part of this repository; this file
is the server side of the shared contract.

Code: `backend/service/mcp/users/` (session, reads, writes, catalog, errors,
requests), `app/lib/mcp-user-route.server.ts`, `app/lib/mcp-user-routes.ts` and
the route files `app/routes/api-mcp-v1-{administration,user,role,department,group}*.ts`.

## Access and rights

- Every request needs `Authorization: Bearer <device token>` of a paired
  machine (PAGE-243). Cookies play no part. A revoked token, a deactivated
  account and an account that has to change its password answer
  `401 invalid_token`, on every call, for a repeated `operationId` as well.
- The rights are read again inside the transaction of every call: the
  actor's role, rank, departments and management scope as stored now. Tool
  arguments never supply actor facts; `actor`, `canManage`, `isAdmin` on a
  role or any other unknown field is refused with `invalid_request`.
- The services run on the `mcp` channel (`UserPolicyService("mcp")`):
  **personal administrator eligibility counts regardless of the role mode** of
  the interface. A call never switches the mode.
- Everyone else acts with the rights of their role (`manage_users`,
  `manage_roles`, `manage_departments`), rank and range, exactly as on the
  user management page. A project membership with the role `manager` grants
  nothing here. Without one of the three rights every route answers
  `403 forbidden`.
- Device tokens have no read-only variant; a token acts with the rights of
  its account. The internal agent and Pica tools (`definition/AgentTools/`)
  are a different surface and unchanged.

### Matrix

| Function                                                     | Administrator                                   | Project leader (role rights)                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| List, search and read users                                  | all accounts                                    | accounts in the visible range (`canSee`: own departments with `manage_users`/`manage_roles`, managed departments, departmentless accounts) |
| Read permission catalog, roles, departments, groups, options | yes                                             | role catalog = assignable or editable roles; departments of the visible range; groups with `manage_users`                                  |
| Assign a role to a person, group or department               | yes                                             | `manage_roles`, role assignable, **every** target changeable (rank, range, not oneself)                                                    |
| Read administration history                                  | yes                                             | no (`403`)                                                                                                                                 |
| Create user                                                  | yes                                             | `manage_users`, assignable role, departments within the membership policy, no administrator                                                |
| Edit username, first name, last name, email                  | yes                                             | `manage_roles`, higher or equal rank, target in range                                                                                      |
| Activate / deactivate                                        | yes                                             | `manage_users`, rank, range                                                                                                                |
| Reset password                                               | yes                                             | `manage_users`, rank, range                                                                                                                |
| Create, change, delete unused roles                          | yes                                             | `manage_roles`, delegation limits (`canEditRole`, `canAssignRole`)                                                                         |
| Change department memberships of a user                      | yes                                             | membership policy (`canSetMemberships`)                                                                                                    |
| Create, rename, delete departments                           | yes                                             | `manage_departments`, managed range                                                                                                        |
| Create, rename, change members, delete groups                | yes                                             | `manage_users`, every old and new member in range                                                                                          |
| Grant / revoke administrator eligibility                     | yes                                             | no (`403`)                                                                                                                                 |
| Change personal management scope                             | yes                                             | no (`403`)                                                                                                                                 |
| Private wiki pages of a user as placeholders, delete         | administrator in admin mode, like the interface | no (`403`)                                                                                                                                 |

All "yes" stay bound to the rules of the services: the last active
administrator keeps eligibility and stays active (`last_administrator`), an
account that had a department keeps at least one (`last_membership`), a used
role is not deleted (`in_use`), a group or department used by agents is not
deleted (`in_use`), a group keeps at least one active member. There is no
account deletion; the interface offers deactivation only.

## Common rules

- **Lists** take `text` (search, max. 200), `limit` (1–100, default 50) and
  `cursor`. They answer the named array (`users`, `roles`, `departments`,
  `groups`, `activity`, `pages`), `total` and `nextCursor` (`null` at the end).
  Entries are filtered by the policy **before** they are paged and counted;
  `total` counts nothing hidden. A cursor is opaque and bound to the actor,
  the list, the query and the actor's current rights: after a change of the
  rights or with another query it answers `400 invalid_request`.
- **Details** answer `user`, `role`, `department` or `group`. An unknown and
  a hidden object both answer `404 not_found`, without names.
- **Identifiers** are stable; renaming keeps the identifier. Changes always
  name the object by its identifier, never by a name, so an ambiguous name
  never changes the first match: search with `text`, then use the `id`.
- **Changes** take `operationId` (1–200 characters). The same `operationId`
  with the same request answers the stored result with `replayed: true` and
  runs nothing again; with another request it answers `409 conflict`. The
  confirmation is not part of the request identity. A repetition still needs
  the current base right of the operation and a valid account.
- **Expected state:** changes and deletions take `expected` with the fields
  read before. Another stored state answers `409 conflict` and nothing
  changes. Omitted fields of a `PATCH` stay as they are; `email: null`
  clears the address; an empty list is an explicit change.
- **Atomicity:** a change, its history line (`administration_activity`,
  `source = mcp`) and its operation key commit in one transaction. A failed
  creation leaves no account behind. After the commit the shared cache is
  invalidated, so the interface and other sessions read the new state.
- **Confirmation:** reductions other than deletion answer
  `428 confirmation_required` with `confirmation: { target, effects,
affectedUserIds, words }` and change nothing. Only a reply the person typed
  is passed on as `confirmation`; `LÖSCHEN` or `DELETE` are accepted. A client
  never invents it. Deleting a group, department or unused role needs no word; the client acts only on the person's explicit request and still passes the last-read expected fields.
- **Change answers:** `{ result: { id, targetType, changed, affectedUserIds },
replayed }`. `targetType` is `person`, `group`, `department` or `role`.

### Errors

The body is `{ "error": "<code>" }`, plus `confirmation` for
`confirmation_required`. No message of a service and no part of the request
is returned.

| Code                    | Status | Meaning                                                                              |
| ----------------------- | ------ | ------------------------------------------------------------------------------------ |
| `invalid_token`         | 401    | Token missing, unknown, revoked; account inactive or must change its password        |
| `forbidden`             | 403    | The actor lacks the right for this action or target                                  |
| `not_found`             | 404    | Unknown or hidden object                                                             |
| `invalid_request`       | 400    | Malformed body, unknown field, invalid value, foreign cursor, duplicate catalog name |
| `too_many_targets`      | 400    | A role assignment would change more than 100 accounts                                |
| `conflict`              | 409    | Stale `expected`, or `operationId` reused for another request                        |
| `confirmation_required` | 428    | A typed confirmation is needed; nothing changed                                      |
| `in_use`                | 409    | Role still held, group or department still used by agents                            |
| `last_administrator`    | 409    | The last active administrator would lose eligibility or activity                     |
| `last_membership`       | 409    | The last department membership or the last group member would go                     |
| `username_taken`        | 409    | Username exists                                                                      |
| `email_taken`           | 409    | Email address exists                                                                 |

## Operations

All paths below `/api/mcp/v1`.

### `GET /administration/options` — read_user_management_options

Right: any of `manage_users`, `manage_roles`, `manage_departments`.
Answer: `permissions { configurable[], read: true, canDisableRead: false }`
(the catalog grants nothing by itself), `assignableRoles[] {id,name,rank}`,
`editableRoleIds`, `departments[] {id,name}`, `manageableDepartmentIds`,
`adoptableDepartmentIds`, `groups[] {id,name}`, `editableGroupIds`,
`actions { canCreateUsers, canCreateAdministrators, canManageRoles,
canManageDepartments, canManageGroups, canManageScopes, canSetAdministrators,
canReadActivity, canListPrivateWikiPages }`, `confirmationWords`.

### `GET /users`, `GET /users/{userId}` — list_users, read_user

Query: `text` over display name, username and the shown email address,
`isActive` (`true`/`false`, optional; without it active and inactive
accounts). A user: `id, username, displayName, firstName, lastName, email,
isActive, isAdmin, isAgent, roleId, departmentIds, groupIds (visible groups),
scope { managedDepartments, allDepartments, allProjects }, allowedActions
{ canEditProfile, canManageAccess, canAssignRole, canManageMemberships,
canManageScope, canSetAdministrator }`. Email addresses only appear here, in
the range of the user management, never in general directories. No password,
hash, token or session is part of any answer.

### `POST /users` — create_user

Body: `operationId, username, firstName, lastName, email (string|null,
default null), roleId (string|null; null only with isAdmin), isAdmin (default
false; administrators only), departmentIds (default [])`. Right:
`manage_users`, assignable role, departments within the membership policy.
Answer `201`: the change answer, `user { id, username }`,
`temporaryPassword` and `temporaryPasswordStatus: "issued"`. The account has
to change the password at the first sign-in.

### `PATCH /users/{userId}` — update_user

Body: `operationId`, any of `username, firstName, lastName, email`, and
`expected` with the read value of **every** field that is sent. Right:
`manage_roles`, rank, range. Only profile fields change.

### `POST /users/{userId}/active` — set_user_active

Body: `operationId, isActive, expected { isActive }, confirmation?`. Right:
`manage_users`, rank, range. A deactivation needs a confirmation (effects
`account_deactivated`, `group_memberships_removed`); the last active
administrator stays active.

### `POST /users/{userId}/password-reset` — reset_user_password

Body: `operationId, confirmation?`. Right: `manage_users`, rank, range.
Always needs a confirmation (effects `password_replaced`,
`sessions_revoked`, `password_change_required`). The first answer holds
`temporaryPassword`; the account must change it and loses its sessions.
Nothing else of the account changes.

### Temporary passwords

The temporary password of a creation or reset exists in exactly one answer,
the first one, sent with `Cache-Control: no-store`. It is not stored in the
operation key, the history, a log or an error. A repetition with the same
`operationId` answers `replayed: true`, `user` and
`temporaryPasswordStatus: "not_retrievable"`: the operation ran once, the
password cannot be read again, and whether it reached anybody is unknown. A
lost answer is no proof of delivery; the authorized person starts a new reset
with a new `operationId` on purpose. Nothing resets automatically.

### `POST /users/{userId}/departments` — set_user_departments

Body: `operationId, departmentIds (complete list), expected { departmentIds },
confirmation?`. Right: membership policy (`manage_departments` within the
managed range, or `manage_roles` for departmentless accounts and own
departments). Removing a membership needs a confirmation. An empty list for
an account that had a department answers `last_membership`.

### `POST /users/{userId}/scope` — set_user_scope

Body: `operationId, scope { managedDepartments, allDepartments, allProjects },
expected { scope }, confirmation?`. Administrators only. A reduction needs a
confirmation. Role and administrator eligibility stay.

### `POST /users/{userId}/administrator` — set_user_administrator

Body: `operationId, isAdmin, expected { isAdmin }, confirmation?`.
Administrators only; every change needs a confirmation. The normal role stays;
an account without a role cannot lose eligibility. A role or group never
grants eligibility.

### `GET /roles`, `GET /roles/{roleId}` — list_roles, read_role

A role: `id, name, rank, departmentBound, permissions, holderIds (visible
holders), canEdit`. Project leaders see the roles they may assign or edit.

### `POST /roles`, `PATCH /roles/{roleId}`, `DELETE /roles/{roleId}` — manage_role

- create: `operationId, name, rank, departmentBound, permissions`. Right:
  `manage_roles` and the role assignable by the actor.
- update: `operationId`, any of `name, rank, departmentBound, permissions`,
  `expected` with the complete read role (`name, rank, departmentBound,
permissions`), `confirmation?`. Applies to all holders; removing
  permissions needs a confirmation.
- delete: `operationId, expected (complete role), confirmation?`. Only an
  unused role (`in_use` otherwise); always needs a confirmation.

`action` is a client field: the client maps it to the method and path.

### `POST /roles/{roleId}/assign` — assign_user_role

Body: `operationId, targetType (person|group|department), targetId,
expectedAssignments [{ userId, roleId|null }], confirmation?`.
`expectedAssignments` names **every** current target with its read role; a
missing or additional member, or another role, answers `conflict`. At most
100 targets (`too_many_targets`). Every target is checked before anything
changes; one forbidden target refuses the whole call. Taking away
permissions needs a confirmation. The assignment is atomic and applies to the
current members only: future members inherit nothing.

### `GET /departments`, `GET /departments/{departmentId}` — list_departments, read_department

A department: `id, name, memberIds (visible members), canManage`.

### `POST /departments`, `PATCH /departments/{departmentId}`, `DELETE /departments/{departmentId}` — manage_department

- create: `operationId, name`. Right: `manage_departments`; the new
  department joins the creator's managed departments, as in the interface.
- update: `operationId, name, expected { name }`. Right: managed range.
- delete: `operationId, expected { name, memberIds }, confirmation?`. Always
  needs a confirmation; members lose the membership.

### `GET /groups`, `GET /groups/{groupId}` — list_user_groups, read_user_group

A group: `id, name, memberIds (visible active members), canEdit`. Without
`manage_users` the list is empty and a detail answers `not_found`.

> **PAGE-308:** `GET /groups/{groupId}` answers without further parameters with the readable group (`id`, `name`, `leaders`, `members`) for administrators and members of the group. The view of this section is `GET /groups/{groupId}?view=administration`. See `docs/wiki/PAGE-308.md`.

### `POST /groups`, `PATCH /groups/{groupId}`, `DELETE /groups/{groupId}` — manage_user_group

- create: `operationId, name, memberIds` (at least one active member).
- update: `operationId`, any of `name, memberIds`, `expected { name,
memberIds }`, `confirmation?`. Removing members needs a confirmation; an
  empty list answers `last_membership`.
- delete: `operationId, expected { name, memberIds }, confirmation?`. Always
  needs a confirmation; ticket assignments of the group go with it.

Right: `manage_users`, every old and new member in range.

### `GET /administration/activity` — read_user_management_activity

Administrators only. Newest first: `id, actorId, operation, source (mcp|ai),
targetType, targetId, affectedUserIds, createdAt`. The history holds only
public results, never a password or raw request parameters. Project leaders
get no history right through this API.

### `GET /users/{userId}/private-wiki` — list_user_private_wiki_pages

The private wiki pages of an account as placeholders: `id, ownerId,
allowedActions { canDelete }`, never a title or text. The wiki keeps its own
rule, the same as the user management page: an administrator in the active
admin mode. Everyone else gets `403`. Deletion uses the existing wiki route
`POST /wiki/pages/{id}/delete`: without `confirmed: true` it answers
`{ confirmationRequired: true, placeholder: { id, ownerId } }`; with it the
page moves into its owner's trash. A placeholder has no readable revision, so
`expectedRevision` is optional for it and required for every other page.

## Verification

The functional check of PAGE-280 ran against an isolated instance: its own
temporary PostgreSQL, a production build on a free loopback port, synthetic
accounts (administrator, project leader with `manage_users` and
`manage_roles` bound to one department, project manager without user rights)
and paired device tokens. It covered positive and refused calls, conflicts,
repetitions, confirmations, revocation and the absence of temporary
passwords in operation keys, history and server log. No live data was used.

## PAGE-316: protected Management role and business contract

`role-administration` (Verwaltung / Management) grants business-wide account,
project, ticket, plan-reading/editing and wiki access directly in role mode.
It never grants administrator mode, administrator-account access, credential
management, account deletion, YOLO grants or core-system configuration.
Only administrators assign or revoke this protected role.

The user resources now use the PAGE-316 projection: `kind`, `role`, `status`,
`departments`, `groups`, and on detail reads `email`, `projects`, `revision` and
`agent`. Creation accepts `displayName`, `username`, `role`, `departmentIds`,
`groupIds`, `kind`, human `email` and agent documents/model configuration.
Human credentials are sent only through `AccountInvitationDelivery`; no public
creation response contains authentication material. The standard adapter
speaks to local `sendmail` without a shell.

The added resources are `POST /users/{id}/status`, `PUT /users/{id}/avatar`,
`PUT /projects/{id}/members` and `PUT /projects/{id}/departments`, all under
`/api/mcp/v1/`. Group creation and patching also accept `description` and
`leaderIds`. These mutations require `expectedRevision` except on creation,
including avatar replacement, and optionally accept `operationId`. The opaque
revision covers the complete current editable state, including changes from
older UI clients. A stale request receives `CONFLICT` and `currentRevision`.
The same operation ID and input replay the stored public result.

Read group revisions through `GET /groups/{id}?view=management` or the companion
`groups_read` tool; project reads include the revision used by membership and
department replacement. All ten PAGE-316 contract tools and `groups_read` are
registered in the common Pages tool catalog used by `pages-pica`.

Failures of the new contract use uppercase `FORBIDDEN` with `reason`
(`core_system`, `admin_target`, `self_escalation`, `role_grant`, `access_level`),
`NOT_FOUND`, `CONFLICT`, `INVALID_REQUEST` with `reason`, or `PAYLOAD_TOO_LARGE`.
Avatars are limited to 5 MiB, decoded with their declared image signature,
and stored as server-rendered PNG; SVG is rebuilt from inert drawing elements
without scripts, entities, styles, links or external resources before rendering.

The verified management actor is carried into the database call. Migration
`057_business_administration.sql` records sanitized before/after changes in
`management_audit`; the service records completed reads too. Administrators
see account, ISO time, operation, target and change in the user management
activity tab. The role itself cannot read that audit view.
