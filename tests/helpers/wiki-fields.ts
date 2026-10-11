import { AgentWikiFieldService } from "@/backend/service/agents/AgentWikiFieldService";

import { pageInput } from "./wiki-harness";
import { useWikiImportApplyHarness } from "./wiki-import-apply";

import type { Database } from "@/backend/database/Database";
import type { WikiPage } from "@/definition/Wiki";
import type { WikiImportApplyHarness } from "./wiki-import-apply";

const WIKI_TABLES = [
  "wiki_pages",
  "wiki_page_anchors",
  "wiki_page_versions",
  "wiki_page_links",
  "wiki_attachments",
  "wiki_comments",
  "wiki_mentions",
  "wiki_favorites",
  "wiki_recent_pages",
  "wiki_expanded_pages",
  "wiki_user_state",
  "wiki_settings",
] as const;

/** Existing isolated wiki fixture extended with the granular operations and an owned page. */
export interface WikiFieldHarness extends WikiImportApplyHarness {
  readonly fields: AgentWikiFieldService;
  readonly page: WikiPage;
}

/** Reuses the migrated database and directory cleanup used by import tests. */
export function useWikiFieldHarness(): () => Promise<WikiFieldHarness> {
  const setup = useWikiImportApplyHarness();
  return async () => {
    const harness = await setup();
    const page = await harness.service.create(
      harness.actor,
      pageInput({
        title: "Original",
        content: "Original\r\ntext\r",
        icon: "📘",
        scope: "project",
        projectId: "alpha",
      }),
    );
    return {
      ...harness,
      page,
      fields: new AgentWikiFieldService(harness.dependencies),
    };
  };
}

/** Reads every persisted page column so invariance assertions include metadata. */
export async function persistedPage(
  database: Database,
  pageId: string,
): Promise<object> {
  const rows = await database.query(
    "SELECT TO_JSON(wiki_pages) FROM wiki_pages WHERE id = $id;",
    { id: pageId },
  );
  const serialized = rows[0]?.[0];
  if (typeof serialized !== "string") throw new Error("Expected page row.");
  const page: unknown = JSON.parse(serialized);
  if (typeof page !== "object" || page === null || Array.isArray(page))
    throw new Error("Expected page record.");
  return page;
}

/** Snapshots the entire wiki, optionally including operation keys, to verify atomic failures. */
export async function wikiFieldState(
  database: Database,
  options: { readonly includeOperationKeys?: boolean } = {},
): Promise<unknown[]> {
  const tables: readonly string[] = options.includeOperationKeys
    ? [...WIKI_TABLES, "agent_operation_keys"]
    : WIKI_TABLES;
  const state = [];
  for (const table of tables)
    state.push(
      await database.query(
        `SELECT TO_JSON(${table}) FROM ${table} ORDER BY 1;`,
      ),
    );
  return state;
}
