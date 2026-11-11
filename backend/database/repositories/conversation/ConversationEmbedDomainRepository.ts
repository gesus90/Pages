import { createInClause } from "@/backend/database/repositories/task/InClause";
import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Who released a domain and when. */
export interface EmbedDomainRelease {
  readonly domain: string;
  readonly addedBy: string;
  readonly createdAt: string;
}

/**
 * The domains that may be embedded in conversations (PAGE-298): released by
 * a member for one conversation, or by an administrator for all of them.
 */
export class ConversationEmbedDomainRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the released domains of conversations by conversation ID, sorted. */
  public async forConversations(
    conversationIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const byConversation = new Map<string, string[]>();
    if (conversationIds.length === 0) return byConversation;
    const list = createInClause("conversation", conversationIds);
    const rows = await this.database.query(
      `
        SELECT
            conversation_id,
            domain
        FROM conversation_embed_domains
        WHERE conversation_id IN (${list.placeholders})
        ORDER BY
            conversation_id,
            domain;
      `,
      list.parameters,
    );
    for (const row of rows) {
      const conversationId = readTextColumn(row, 0, "conversation_id");
      const known = byConversation.get(conversationId) ?? [];
      known.push(readTextColumn(row, 1, "domain"));
      byConversation.set(conversationId, known);
    }
    return byConversation;
  }

  /** Releases a domain for one conversation; a released one stays as it is. */
  public async add(
    conversationId: string,
    release: EmbedDomainRelease,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_embed_domains (
            conversation_id,
            domain,
            added_by,
            created_at
        )
        VALUES (
            $conversation_id,
            $domain,
            $added_by,
            $created_at
        )
        ON CONFLICT (conversation_id, domain) DO NOTHING;
      `,
      {
        conversation_id: conversationId,
        domain: release.domain,
        added_by: release.addedBy,
        created_at: release.createdAt,
      },
    );
  }

  /** Takes the release of a domain from one conversation. */
  public async remove(conversationId: string, domain: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM conversation_embed_domains
        WHERE conversation_id = $conversation_id
            AND domain = $domain;
      `,
      { conversation_id: conversationId, domain },
    );
  }

  /** Returns the domains released for every conversation, sorted. */
  public async global(): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT domain
        FROM conversation_global_embed_domains
        ORDER BY domain;
      `,
    );
    return rows.map((row) => readTextColumn(row, 0, "domain"));
  }

  /** Releases a domain for every conversation; a released one stays as it is. */
  public async addGlobal(release: EmbedDomainRelease): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_global_embed_domains (
            domain,
            added_by,
            created_at
        )
        VALUES (
            $domain,
            $added_by,
            $created_at
        )
        ON CONFLICT (domain) DO NOTHING;
      `,
      {
        domain: release.domain,
        added_by: release.addedBy,
        created_at: release.createdAt,
      },
    );
  }

  /** Takes the release for every conversation from a domain. */
  public async removeGlobal(domain: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM conversation_global_embed_domains
        WHERE domain = $domain;
      `,
      { domain },
    );
  }
}
