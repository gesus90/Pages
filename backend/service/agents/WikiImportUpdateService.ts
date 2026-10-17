import { createHash } from "node:crypto";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  requireWikiImportPage,
  resolveWikiImportContext,
} from "./WikiImportContext";
import { wikiImportFingerprint } from "./WikiImportFingerprint";
import { wikiImportPackage } from "./WikiImportPackage";
import { WikiImportPlanner } from "./WikiImportPlanner";
import { readWikiImportUpdate } from "./WikiImportUpdateReader";
import { updateWikiImportSource } from "./WikiImportUpdateSource";
import { wikiImportErrorCode } from "./WikiImportSourceService";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type {
  AgentImportUpdated,
  AgentImportUpdateInput,
  AgentImportUpdateItem,
} from "@/definition/AgentImportUpdate";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WikiImportContext } from "./WikiImportContext";

const OPERATION = "wiki.import.update";

/** The server-owned collaborators of an update; pages are changed on the shared connection. */
export interface WikiImportUpdateDependencies {
  readonly database: Database;
  readonly events: PagesEventPublisher;
}

interface UpdateOutcome {
  readonly result: AgentImportUpdated;
  readonly updatedPageIds: readonly string[];
}

/** Binds an operation ID to its whole canonical package, confirmed plan and per-source decisions. */
function updateFingerprint(input: AgentImportUpdateInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        manifest: wikiImportFingerprint(input, {
          canWrite: false,
          parents: [],
          children: [],
        }),
        fingerprint: input.fingerprint,
        updates: input.updates,
      }),
    )
    .digest("hex");
}

function summarize(
  items: readonly AgentImportUpdateItem[],
): AgentImportUpdated {
  const counts = { updated: 0, skipped: 0, conflict: 0, failed: 0 };
  for (const entry of items) counts[entry.action] += 1;
  return {
    status: counts.conflict || counts.failed ? "partial" : "complete",
    counts,
    items,
  };
}

/** Brings imported pages up to date with changed sources, all-or-nothing and without silent overwrites. */
export class WikiImportUpdateService {
  private readonly dependencies: WikiImportUpdateDependencies;

  public constructor(dependencies: WikiImportUpdateDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Updates the pages mapped to the loaded sources of a confirmed package.
   *
   * @param identity - The verified owner of the operation.
   * @param request - The raw operation parameters.
   * @param verify - Verifies the caller's credential anew; it must run outside of a transaction.
   * @returns Per-source results; a repeated operation ID returns the stored result unchanged.
   *
   * @remarks
   * Conflicts are results, not errors: a source revised in Pages since its import, or read at an
   * older revision, is left untouched unless its entry asks to overwrite. All page writes and the
   * moved baselines commit together with the stored result.
   */
  public async update(
    identity: AgentIdentity,
    request: unknown,
    verify: () => Promise<AgentIdentity>,
  ): Promise<PagesAgentWriteResponse> {
    const input = readWikiImportUpdate(request);
    try {
      if ((await verify()).userId !== identity.userId)
        throw new AgentOperationError("FORBIDDEN");
      const outcome = await this.dependencies.database.transaction(
        (transaction) => this.run(transaction, identity.userId, input),
      );
      for (const id of outcome.updatedPageIds)
        this.dependencies.events.publish({ type: "wiki.page.updated", id });
      return { apiVersion: "1", result: outcome.result };
    } catch (error: unknown) {
      logCaughtError("WikiImportUpdateService", error);

      if (error instanceof AgentOperationError) throw error;
      const code = wikiImportErrorCode(error);
      if (code && code !== "AUTH_INVALID" && code !== "AUTH_UNAVAILABLE")
        throw new AgentOperationError(code);
      throw error;
    }
  }

  private async run(
    transaction: DatabaseTransaction,
    userId: string,
    input: AgentImportUpdateInput,
  ): Promise<UpdateOutcome> {
    const context = await resolveWikiImportContext(
      transaction,
      userId,
      input.projectId,
    );
    if (!context.viewer.canWrite) throw new AgentOperationError("FORBIDDEN");
    const operations = new AgentOperationKeyRepository(transaction);
    const hash = updateFingerprint(input);
    const previous = await operations.find(userId, input.operationId);
    if (previous) return this.replay(context, previous, hash);
    const response = await new WikiImportPlanner(
      context.wiki,
      context.access,
    ).plan(context.actor, {
      projectId: input.projectId,
      parentId: input.parentId,
      manifest: input.manifest,
    });
    if (!("fingerprint" in response.result))
      throw new Error("Import plan unavailable.");
    if (response.result.fingerprint !== input.fingerprint)
      throw new AgentOperationError("CONFLICT");
    const scope = {
      context,
      repository: new AgentImportRepository(transaction),
      plan: response.result,
      input,
      marker: `update:${createHash("sha256").update(`${userId}\n${input.operationId}`).digest("hex")}`,
    };
    const items: AgentImportUpdateItem[] = [];
    for (const source of wikiImportPackage(
      { ...input, assets: [] },
      scope.plan,
    )) {
      if (input.updates.some((entry) => entry.sourceKey === source.sourceKey))
        items.push(await updateWikiImportSource(scope, source));
    }
    const result = summarize(items);
    await operations.insert(userId, input.operationId, {
      operation: OPERATION,
      fingerprint: hash,
      resultJson: JSON.stringify(result),
    });
    return {
      result,
      updatedPageIds: items.flatMap((entry) =>
        entry.action === "updated" && entry.pageId ? [entry.pageId] : [],
      ),
    };
  }

  private async replay(
    context: WikiImportContext,
    previous: StoredAgentOperation,
    hash: string,
  ): Promise<UpdateOutcome> {
    if (previous.operation !== OPERATION || previous.fingerprint !== hash)
      throw new AgentOperationError("CONFLICT");
    // The result JSON is written only by run, with the public result schema, in the same commit.
    const result = JSON.parse(previous.resultJson) as AgentImportUpdated;
    for (const entry of result.items) {
      if (entry.pageId) await requireWikiImportPage(context, entry.pageId);
    }
    return { result, updatedPageIds: [] };
  }
}
