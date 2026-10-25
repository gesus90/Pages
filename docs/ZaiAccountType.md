# z.ai account routing (PAGE-157)

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
set are checked on disposable scratch databases during PAGE-157 validation.

Provider references: [Z.ai endpoint configuration](https://zcode.z.ai/en/docs/configuration),
[opencode providers](https://dev.opencode.ai/docs/providers/).
