import { randomUUID } from "node:crypto";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { logCaughtError } from "@/backend/logging/Logger";

import { readWikiImportApply } from "./WikiImportApplyReader";
import {
  readWikiImportParents,
  requireWikiImportPage,
  resolveWikiImportContext,
} from "./WikiImportContext";
import {
  wikiImportOperationFingerprint,
  wikiImportPackage,
} from "./WikiImportPackage";
import { WikiImportPlanner } from "./WikiImportPlanner";
import {
  wikiImportErrorCode,
  WikiImportSourceService,
} from "./WikiImportSourceService";

import type { StoredAgentImportRun } from "@/backend/database/repositories/agents/AgentImportRepository";
import type {
  AgentImportApplied,
  AgentImportApplyInput,
} from "@/definition/AgentImportApply";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentWikiCreateDependencies } from "./AgentWikiCreateService";
import type { WikiImportSnapshot } from "./WikiImportContext";
import type { WikiImportRun } from "./WikiImportSourceService";

/** Applies confirmed packages without overwrite, keeping each committed source recoverable. */
export class WikiImportService {
  private readonly dependencies: AgentWikiCreateDependencies;
  private readonly sources: WikiImportSourceService;

  public constructor(dependencies: AgentWikiCreateDependencies) {
    this.dependencies = dependencies;
    this.sources = new WikiImportSourceService(dependencies);
  }

  /** Replays completed runs exactly or resumes a running package's still unprocessed sources. */
  public async apply(
    identity: AgentIdentity,
    request: unknown,
    verify: () => Promise<AgentIdentity>,
  ): Promise<PagesAgentWriteResponse> {
    const input = readWikiImportApply(request);
    try {
      const stored = await this.begin(identity.userId, input);
      // Only begin writes snapshots, after verifying the plan on its transaction connection.
      const run: WikiImportRun = {
        ...stored,
        snapshot: JSON.parse(stored.snapshotJson) as WikiImportSnapshot,
      };
      if (stored.status === "running") {
        for (const source of wikiImportPackage(input, run.snapshot.plan))
          await this.sources.apply(run, source, input, verify);
      }
      if ((await verify()).userId !== identity.userId)
        throw new AgentOperationError("FORBIDDEN");
      const result = await this.finish(run);
      const response: PagesAgentWriteResponse = { apiVersion: "1", result };
      if (
        Buffer.byteLength(JSON.stringify(response)) >
        PAGES_AGENT_LIMITS.responseBytes
      )
        throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
          constraint: "responseBytes",
          limit: PAGES_AGENT_LIMITS.responseBytes,
        });
      return response;
    } catch (error: unknown) {
      logCaughtError("WikiImportService", error);

      if (error instanceof AgentOperationError) throw error;
      const code = wikiImportErrorCode(error);
      if (code && code !== "AUTH_INVALID" && code !== "AUTH_UNAVAILABLE")
        throw new AgentOperationError(code);
      throw error;
    }
  }

  private async begin(
    userId: string,
    input: AgentImportApplyInput,
  ): Promise<StoredAgentImportRun> {
    return this.dependencies.database.transaction(async (transaction) => {
      const context = await resolveWikiImportContext(
        transaction,
        userId,
        input.projectId,
      );
      if (!context.viewer.canWrite) throw new AgentOperationError("FORBIDDEN");
      const operations = new AgentOperationKeyRepository(transaction);
      const repository = new AgentImportRepository(transaction);
      const hash = wikiImportOperationFingerprint(input);
      const previous = await operations.find(userId, input.operationId);
      if (previous) {
        if (
          previous.operation !== "wiki.import.apply" ||
          previous.fingerprint !== hash
        )
          throw new AgentOperationError("CONFLICT");
        // The operation result contains only the run ID created in this same transaction.
        const reference = JSON.parse(previous.resultJson) as {
          readonly runId: string;
        };
        const run = await repository.findRun(
          reference.runId,
          userId,
          input.projectId,
        );
        if (!run) throw new Error("Import run unavailable.");
        return run;
      }
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
      const snapshot: WikiImportSnapshot = {
        plan: response.result,
        parents: await readWikiImportParents(context, input.parentId),
      };
      const run: StoredAgentImportRun = {
        id: randomUUID(),
        userId,
        projectId: input.projectId,
        status: "running",
        snapshotJson: JSON.stringify(snapshot),
      };
      await repository.insertRun(run);
      await operations.insert(userId, input.operationId, {
        operation: "wiki.import.apply",
        fingerprint: hash,
        resultJson: JSON.stringify({ runId: run.id }),
      });
      return run;
    });
  }

  private async finish(run: WikiImportRun): Promise<AgentImportApplied> {
    return this.dependencies.database.transaction(async (transaction) => {
      const context = await resolveWikiImportContext(
        transaction,
        run.userId,
        run.projectId,
      );
      const repository = new AgentImportRepository(transaction);
      const items = await repository.listItems(run.id);
      for (const item of items) {
        if (item.pageId) await requireWikiImportPage(context, item.pageId);
      }
      const counts = await repository.finishRun(run.id);
      return {
        runId: run.id,
        status: counts.conflict || counts.failed ? "partial" : "complete",
        counts,
        items,
      };
    });
  }
}
