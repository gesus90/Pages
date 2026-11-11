import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentDeletionBlocker,
  AgentDeletionCounts,
  AgentDeletionKeeps,
  DeletedAgent,
} from "@/definition/AgentDeletion";

/** Current persisted inventory used by both the preview and confirmation. */
export interface StoredAgentDeletionInventory {
  readonly deletes: AgentDeletionCounts;
  readonly keeps: AgentDeletionKeeps;
  readonly blockers: readonly AgentDeletionBlocker[];
  readonly ownedPlans: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly fingerprint: string;
}

/** A saved preview scoped to one actor and agent. */
export interface StoredAgentDeletionPreview {
  readonly agentId: string;
  readonly actorId: string;
  readonly fingerprint: string;
  readonly expiresAt: string;
}

/** One previously committed delete or restore operation. */
export interface StoredAgentDeletionOperation {
  readonly action: "delete" | "restore";
  readonly agentId: string;
  readonly actorId: string;
  readonly result: string;
}

/** The reversible record of a deleted agent. */
export interface StoredAgentDeletion {
  readonly agentId: string;
  readonly displayName: string;
  readonly deletedAt: string;
  readonly restorableUntil: string;
}

/** Disk artifacts to remove after the database transaction commits. */
export interface AgentDeletionFiles {
  readonly entries: readonly {
    readonly kind: "session" | "chat" | "plan" | "voice";
    readonly name: string;
  }[];
}

type DeletionDatabase = Pick<Database, "query" | "execute">;

function count(row: readonly DatabaseValue[], index: number): number {
  return readCountColumn(row, index, `count_${index}`);
}

/** SQL for the private and shared artifacts of one agent. */
const INVENTORY_SQL = `
  SELECT
      (SELECT COUNT(*) FROM conversations INNER JOIN conversation_members ON conversation_members.conversation_id = conversations.id WHERE conversations.kind = 'direct' AND conversation_members.user_id = $agent_id),
      (SELECT COUNT(*) FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id)) + (SELECT COUNT(*) FROM chat_acp_sessions WHERE user_id = $agent_id AND chat_session_id NOT IN (SELECT id FROM chat_sessions)) + (SELECT COUNT(*) FROM agent_session_attempts WHERE user_id = $agent_id OR run_id IN (SELECT id FROM agent_plan_runs WHERE user_id = $agent_id OR plan_id IN (SELECT id FROM agent_plans WHERE owner_id = $agent_id))),
      (SELECT COUNT(*) FROM agent_memory_archive WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM agent_memory_versions WHERE user_id = $agent_id),
      (SELECT COUNT(*) FROM agent_plans WHERE owner_id = $agent_id),
      (SELECT COUNT(*) FROM agent_plan_runs WHERE user_id = $agent_id OR plan_id IN (SELECT id FROM agent_plans WHERE owner_id = $agent_id)),
      (SELECT COUNT(*) FROM user_avatars WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM chat_attachments WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id))) + (SELECT COUNT(*) FROM agent_plan_assets WHERE owner_id = $agent_id) + (SELECT COUNT(*) FROM conversation_messages WHERE voice_storage_name IS NOT NULL AND conversation_id IN (SELECT id FROM conversations WHERE kind = 'direct' AND id IN (SELECT conversation_id FROM conversation_members WHERE user_id = $agent_id))),
      (SELECT COUNT(*) FROM personal_agent_tokens WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM mcp_device WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM agent_run_credentials WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM mcp_device_pairing WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM mcp_pairing_requests WHERE user_id = $agent_id),
      (SELECT COUNT(*) FROM user_group_members WHERE user_id = $agent_id) + (SELECT COUNT(*) FROM conversation_members INNER JOIN conversations ON conversations.id = conversation_members.conversation_id WHERE conversations.kind = 'group' AND conversation_members.user_id = $agent_id) + (SELECT COUNT(*) FROM chat_group_members WHERE contact_id = $agent_id OR owner_id = $agent_id),
      (SELECT COUNT(*) FROM work_items WHERE assignee_id = $agent_id),
      (SELECT COUNT(*) FROM conversation_messages INNER JOIN conversations ON conversations.id = conversation_messages.conversation_id WHERE conversations.kind = 'group' AND conversation_messages.sender_id = $agent_id),
      (SELECT COUNT(*) FROM work_item_history WHERE user_id = $agent_id),
      (SELECT COUNT(*) FROM wiki_comments WHERE author_id = $agent_id) + (SELECT COUNT(*) FROM wiki_pages WHERE author_id = $agent_id OR updated_by = $agent_id) + (SELECT COUNT(*) FROM wiki_page_versions WHERE author_id = $agent_id),
      (SELECT revision FROM agent_employees WHERE user_id = $agent_id);
`;

/** Hashes row contents so an equally sized but changed inventory invalidates a preview. */
const INVENTORY_FINGERPRINT_SQL = `
  SELECT md5(jsonb_build_object(
      'account', (SELECT to_jsonb(users) FROM users WHERE id = $agent_id),
      'profile', (SELECT to_jsonb(agent_employees) FROM agent_employees WHERE user_id = $agent_id),
      'memory', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM agent_memory_archive AS m WHERE m.user_id = $agent_id),
      'memoryVersions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM agent_memory_versions AS v WHERE v.user_id = $agent_id),
      'sessions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM chat_sessions AS s WHERE s.user_id = $agent_id OR s.id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id)),
      'acpSessions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.chat_session_id) FROM chat_acp_sessions AS s WHERE s.user_id = $agent_id),
      'agentConversations', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.chat_session_id) FROM agent_conversations AS c WHERE c.agent_id = $agent_id),
      'attachments', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM chat_attachments AS a WHERE a.session_id IN (SELECT id FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id))),
      'plans', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM agent_plans AS p WHERE p.owner_id = $agent_id),
      'runs', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM agent_plan_runs AS r WHERE r.user_id = $agent_id OR r.plan_id IN (SELECT id FROM agent_plans WHERE owner_id = $agent_id)),
      'directChats', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM conversations AS c WHERE c.kind = 'direct' AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = $agent_id)),
      'directMessages', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM conversation_messages AS m WHERE m.conversation_id IN (SELECT c.id FROM conversations AS c WHERE c.kind = 'direct' AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = $agent_id))),
      'personalTokens', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM personal_agent_tokens AS t WHERE t.user_id = $agent_id),
      'devices', (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM mcp_device AS d WHERE d.user_id = $agent_id),
      'pairings', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM mcp_device_pairing AS p WHERE p.user_id = $agent_id),
      'runCredentials', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM agent_run_credentials AS c WHERE c.user_id = $agent_id),
      'assets', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM agent_plan_assets AS a WHERE a.owner_id = $agent_id),
      'tickets', (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM work_items AS w WHERE w.assignee_id = $agent_id),
      'tasks', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM tasks AS t WHERE t.assignee_id = $agent_id),
      'groupMemberships', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.group_id) FROM user_group_members AS m WHERE m.user_id = $agent_id),
      'chatGroupMemberships', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.group_id) FROM chat_group_members AS m WHERE m.contact_id = $agent_id OR m.owner_id = $agent_id),
      'groupChats', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.conversation_id) FROM conversation_members AS m WHERE m.user_id = $agent_id)
  )::text);
`;

/** Persists previews, reversible deletion state, and the audit trail. */
export class AgentDeletionRepository {
  private readonly database: DeletionDatabase;

  public constructor(database: DeletionDatabase) {
    this.database = database;
  }

  /** Reads the inventory and every active or paused run that blocks deletion. */
  public async inventory(
    agentId: string,
  ): Promise<StoredAgentDeletionInventory> {
    const parameters = { agent_id: agentId };
    const counts = await this.database.query(INVENTORY_SQL, parameters);
    const plans = await this.database.query(
      "SELECT id, name FROM agent_plans WHERE owner_id = $agent_id ORDER BY name, id;",
      parameters,
    );
    const runs = await this.database.query(
      `
          SELECT id, plan_id, status
          FROM agent_plan_runs
          WHERE (user_id = $agent_id OR plan_id IN (SELECT id FROM agent_plans WHERE owner_id = $agent_id))
              AND status IN ('running', 'pausing', 'paused', 'stopping')
          ORDER BY started_at, id;
        `,
      parameters,
    );
    const fingerprintRows = await this.database.query(
      INVENTORY_FINGERPRINT_SQL,
      parameters,
    );
    const row = counts[0];
    if (!row || row[12] === null)
      throw new Error("Agent inventory is missing.");
    const deletes: AgentDeletionCounts = {
      directChats: count(row, 0),
      sessions: count(row, 1),
      memoryEntries: count(row, 2),
      ownedPlans: count(row, 3),
      runs: count(row, 4),
      files: count(row, 5),
      credentials: count(row, 6),
      groupMemberships: count(row, 7),
      assignedTickets: count(row, 8),
    };
    const keeps: AgentDeletionKeeps = {
      groupChatMessages: count(row, 9),
      ticketChanges: count(row, 10),
      wikiChanges: count(row, 11),
      commits: 0,
    };
    const ownedPlans = plans.map((plan) => ({
      id: readTextColumn(plan, 0, "id"),
      name: readTextColumn(plan, 1, "name"),
    }));
    const blockers = runs.map((run) => ({
      code: "active_runs" as const,
      detail: `${readTextColumn(run, 0, "id")} (${readTextColumn(run, 2, "status")})`,
      link: `/agents/plans?planId=${encodeURIComponent(readTextColumn(run, 1, "plan_id"))}`,
    }));
    return {
      deletes,
      keeps,
      blockers,
      ownedPlans,
      fingerprint: JSON.stringify({
        inventory: fingerprintRows[0]
          ? readTextColumn(fingerprintRows[0], 0, "fingerprint")
          : "",
        deletes,
        keeps,
        ownedPlans,
        blockers,
        revision: count(row, 12),
      }),
    };
  }

  /** Stores a preview for its actor and ten-minute expiry. */
  public async savePreview(input: {
    readonly id: string;
    readonly agentId: string;
    readonly actorId: string;
    readonly fingerprint: string;
    readonly expiresAt: string;
  }): Promise<void> {
    await this.database.execute(
      `INSERT INTO agent_deletion_previews (id, agent_id, actor_id, inventory_hash, expires_at)
       VALUES ($id, $agent_id, $actor_id, $fingerprint, $expires_at);`,
      {
        id: input.id,
        agent_id: input.agentId,
        actor_id: input.actorId,
        fingerprint: input.fingerprint,
        expires_at: input.expiresAt,
      },
    );
  }

  /** Finds a preview by its unguessable identifier. */
  public async findPreview(
    id: string,
  ): Promise<StoredAgentDeletionPreview | null> {
    const rows = await this.database.query(
      "SELECT agent_id, actor_id, inventory_hash, expires_at FROM agent_deletion_previews WHERE id = $id;",
      { id },
    );
    const row = rows[0];
    return row
      ? {
          agentId: readTextColumn(row, 0, "agent_id"),
          actorId: readTextColumn(row, 1, "actor_id"),
          fingerprint: readTextColumn(row, 2, "inventory_hash"),
          expiresAt: readTextColumn(row, 3, "expires_at"),
        }
      : null;
  }

  /** Reads an idempotent operation before checking current target visibility. */
  public async findOperation(
    id: string,
  ): Promise<StoredAgentDeletionOperation | null> {
    const rows = await this.database.query(
      "SELECT action, agent_id, actor_id, result::text FROM agent_deletion_operations WHERE id = $id;",
      { id },
    );
    const row = rows[0];
    if (!row) return null;
    const action = readTextColumn(row, 0, "action");
    if (action !== "delete" && action !== "restore")
      throw new Error("Invalid deletion operation.");
    return {
      action,
      agentId: readTextColumn(row, 1, "agent_id"),
      actorId: readTextColumn(row, 2, "actor_id"),
      result: readTextColumn(row, 3, "result"),
    };
  }

  /** Stores the result together with the change for safe retries. */
  public async saveOperation(input: {
    readonly id: string;
    readonly action: "delete" | "restore";
    readonly agentId: string;
    readonly actorId: string;
    readonly result: unknown;
  }): Promise<void> {
    await this.database.execute(
      `INSERT INTO agent_deletion_operations (id, action, agent_id, actor_id, result)
       VALUES ($id, $action, $agent_id, $actor_id, $result::jsonb);`,
      {
        id: input.id,
        action: input.action,
        agent_id: input.agentId,
        actor_id: input.actorId,
        result: JSON.stringify(input.result),
      },
    );
  }

  /** Soft-deletes the account, revokes credentials and keeps a restore record. */
  public async delete(input: {
    readonly agentId: string;
    readonly actorId: string;
    readonly displayName: string;
    readonly deletedAt: string;
    readonly restorableUntil: string;
    readonly counts: AgentDeletionCounts;
    readonly eventId: string;
  }): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_deletions (
            agent_id, display_name, deleted_at, deleted_by, restorable_until,
            was_active, token_state, assigned_tickets, assigned_tasks, counts
        )
        SELECT
            users.id, $display_name, $deleted_at, $actor_id, $restorable_until,
            users.is_active = 1,
            jsonb_build_object(
                'personal', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revokedAt', revoked_at)), '[]'::jsonb) FROM personal_agent_tokens WHERE user_id = $agent_id),
                'device', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revokedAt', revoked_at)), '[]'::jsonb) FROM mcp_device WHERE user_id = $agent_id),
                'run', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revokedAt', revoked_at)), '[]'::jsonb) FROM agent_run_credentials WHERE user_id = $agent_id)
            ),
            (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM work_items WHERE assignee_id = $agent_id),
            (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM tasks WHERE assignee_id = $agent_id),
            $counts::jsonb
        FROM users
        WHERE users.id = $agent_id AND users.account_kind = 'agent' AND users.removed_at IS NULL;
      `,
      {
        agent_id: input.agentId,
        actor_id: input.actorId,
        display_name: input.displayName,
        deleted_at: input.deletedAt,
        restorable_until: input.restorableUntil,
        counts: JSON.stringify(input.counts),
      },
    );
    await this.database.execute(
      `UPDATE users SET is_active = 0, removed_at = $deleted_at,
          display_name = 'Gelöschter Agent (' || $display_name || ')', updated_at = $deleted_at
       WHERE id = $agent_id AND account_kind = 'agent' AND removed_at IS NULL;`,
      {
        agent_id: input.agentId,
        display_name: input.displayName,
        deleted_at: input.deletedAt,
      },
    );
    await this.database.execute(
      "UPDATE personal_agent_tokens SET revoked_at = $revoked_at WHERE user_id = $agent_id AND revoked_at IS NULL;",
      { agent_id: input.agentId, revoked_at: Date.parse(input.deletedAt) },
    );
    await this.database.execute(
      "UPDATE mcp_device SET revoked_at = $revoked_at WHERE user_id = $agent_id AND revoked_at IS NULL;",
      { agent_id: input.agentId, revoked_at: Date.parse(input.deletedAt) },
    );
    await this.database.execute(
      "UPDATE agent_run_credentials SET revoked_at = $revoked_at WHERE user_id = $agent_id AND revoked_at IS NULL;",
      { agent_id: input.agentId, revoked_at: Date.parse(input.deletedAt) },
    );
    await this.database.execute(
      "UPDATE work_items SET assignee_id = NULL WHERE assignee_id = $agent_id;",
      { agent_id: input.agentId },
    );
    await this.database.execute(
      "UPDATE tasks SET assignee_id = NULL WHERE assignee_id = $agent_id;",
      { agent_id: input.agentId },
    );
    await this.database.execute(
      `UPDATE conversations SET deleted_agent_id = $agent_id
       WHERE kind = 'direct' AND id IN (SELECT conversation_id FROM conversation_members WHERE user_id = $agent_id);`,
      { agent_id: input.agentId },
    );
    await this.database.execute(
      `INSERT INTO agent_deletion_events (id, agent_id, actor_id, action, occurred_at, counts)
       VALUES ($event_id, $agent_id, $actor_id, 'delete', $deleted_at, $counts::jsonb);`,
      {
        agent_id: input.agentId,
        actor_id: input.actorId,
        deleted_at: input.deletedAt,
        counts: JSON.stringify(input.counts),
        event_id: input.eventId,
      },
    );
    await this.database.execute(
      "DELETE FROM agent_deletion_previews WHERE agent_id = $agent_id;",
      { agent_id: input.agentId },
    );
  }

  /** Reads an unpurged deletion for restoration. */
  public async findDeletion(
    agentId: string,
  ): Promise<StoredAgentDeletion | null> {
    const rows = await this.database.query(
      `SELECT agent_id, display_name, deleted_at, restorable_until
       FROM agent_deletions WHERE agent_id = $agent_id AND purged_at IS NULL;`,
      { agent_id: agentId },
    );
    const row = rows[0];
    return row
      ? {
          agentId: readTextColumn(row, 0, "agent_id"),
          displayName: readTextColumn(row, 1, "display_name"),
          deletedAt: readTextColumn(row, 2, "deleted_at"),
          restorableUntil: readTextColumn(row, 3, "restorable_until"),
        }
      : null;
  }

  /** Restores account visibility, original active state, assignments and token states. */
  public async restore(
    agentId: string,
    actorId: string,
    restoredAt: string,
    eventId: string,
  ): Promise<void> {
    const parameters = {
      agent_id: agentId,
      actor_id: actorId,
      restored_at: restoredAt,
      event_id: eventId,
    };
    await this.database.execute(
      `UPDATE users SET is_active = CASE WHEN agent_deletions.was_active THEN 1 ELSE 0 END,
          removed_at = NULL, display_name = agent_deletions.display_name, updated_at = $restored_at
       FROM agent_deletions WHERE users.id = agent_deletions.agent_id AND users.id = $agent_id;`,
      { agent_id: agentId, restored_at: restoredAt },
    );
    for (const table of [
      { name: "personal_agent_tokens", key: "personal" },
      { name: "mcp_device", key: "device" },
      { name: "agent_run_credentials", key: "run" },
    ]) {
      await this.database.execute(
        `UPDATE ${table.name} SET revoked_at = (tokens.item->>'revokedAt')::bigint
         FROM agent_deletions, LATERAL jsonb_array_elements(agent_deletions.token_state->'${table.key}') AS tokens(item)
         WHERE ${table.name}.id = tokens.item->>'id' AND agent_deletions.agent_id = $agent_id;`,
        { agent_id: agentId },
      );
    }
    await this.database.execute(
      `UPDATE work_items SET assignee_id = $agent_id WHERE assignee_id IS NULL
       AND id IN (SELECT jsonb_array_elements_text(assigned_tickets) FROM agent_deletions WHERE agent_id = $agent_id);`,
      { agent_id: agentId },
    );
    await this.database.execute(
      `UPDATE tasks SET assignee_id = $agent_id WHERE assignee_id IS NULL
       AND id IN (SELECT jsonb_array_elements_text(assigned_tasks) FROM agent_deletions WHERE agent_id = $agent_id);`,
      { agent_id: agentId },
    );
    await this.database.execute(
      "UPDATE conversations SET deleted_agent_id = NULL WHERE deleted_agent_id = $agent_id;",
      { agent_id: agentId },
    );
    await this.database.execute(
      `INSERT INTO agent_deletion_events (id, agent_id, actor_id, action, occurred_at, counts)
       SELECT $event_id, agent_id, $actor_id, 'restore', $restored_at, counts
       FROM agent_deletions WHERE agent_id = $agent_id;`,
      parameters,
    );
    await this.database.execute(
      "DELETE FROM agent_deletions WHERE agent_id = $agent_id;",
      { agent_id: agentId },
    );
  }

  /** Lists the restorable agents, with a stable cursor by deletion time and ID. */
  public async listDeleted(
    cursor: string | null,
    limit: number,
    now: string,
  ): Promise<{
    readonly agents: readonly DeletedAgent[];
    readonly nextCursor: string | null;
  }> {
    const rows = await this.database.query(
      `SELECT agent_deletions.agent_id, agent_deletions.display_name, agent_deletions.deleted_at,
          agent_deletions.deleted_by, users.display_name, agent_deletions.restorable_until
       FROM agent_deletions INNER JOIN users ON users.id = agent_deletions.deleted_by
       WHERE agent_deletions.purged_at IS NULL AND agent_deletions.restorable_until > $now
          AND (CAST($cursor AS TEXT) IS NULL OR agent_deletions.agent_id > CAST($cursor AS TEXT))
       ORDER BY agent_deletions.agent_id LIMIT $limit;`,
      { cursor, limit: limit + 1, now },
    );
    const agents = rows.slice(0, limit).map((row) => ({
      agentId: readTextColumn(row, 0, "agent_id"),
      displayName: readTextColumn(row, 1, "display_name"),
      deletedAt: readTextColumn(row, 2, "deleted_at"),
      deletedBy: {
        id: readTextColumn(row, 3, "deleted_by"),
        displayName: readTextColumn(row, 4, "display_name"),
      },
      restorableUntil: readTextColumn(row, 5, "restorable_until"),
    }));
    return {
      agents,
      nextCursor: rows.length > limit ? (agents.at(-1)?.agentId ?? null) : null,
    };
  }
}
