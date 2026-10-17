import { createHash, randomUUID } from "node:crypto";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { WIKI_SCOPE } from "@/definition/Wiki";
import { logCaughtError } from "@/backend/logging/Logger";

import { agentTransactionScope } from "./AgentTransactionScope";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { createStructuredImportEnvironment } from "./StructuredImportEnvironment";
import { toStructuredItem } from "./StructuredImportItems";
import {
  canonicalStructuredManifest,
  readStructuredImportApply,
  readStructuredImportPlan,
} from "./StructuredImportManifestReader";
import { previewStructuredImport } from "./StructuredImportPreview";
import { StructuredImportStepService } from "./StructuredImportStepService";
import {
  buildStructuredWiki,
  readStructuredAssetMap,
  structuredWikiApplyInput,
} from "./StructuredImportWiki";
import { planStructuredImport } from "./StructuredImportPlanner";
import { readWikiImportParents } from "./WikiImportContext";
import { wikiImportPackage } from "./WikiImportPackage";
import {
  WikiImportSourceService,
  wikiImportErrorCode,
} from "./WikiImportSourceService";

import type { StoredAgentImportRun } from "@/backend/database/repositories/agents/AgentImportRepository";
import type {
  AgentStructuredImportApplied,
  AgentStructuredImportApplyInput,
  AgentStructuredImportItem,
  AgentStructuredIssue,
} from "@/definition/AgentStructuredImportManifest";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentStructuredReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentPlanningServices } from "./AgentPlanningServices";
import type { AgentWikiCreateDependencies } from "./AgentWikiCreateService";
import type { StructuredImportEnvironment } from "./StructuredImportEnvironment";
import type { StructuredImportPreview } from "./StructuredImportPreview";
import type {
  WikiImportContext,
  WikiImportSnapshot,
} from "./WikiImportContext";
import type { WikiImportRun } from "./WikiImportSourceService";

/** The server-owned collaborators of structured imports. */
export interface StructuredImportDependencies {
  readonly creation: AgentWikiCreateDependencies;
  readonly planning: Pick<
    AgentPlanningServices,
    "tickets" | "milestones" | "announcer"
  >;
}

const OPERATION = "import.structured.apply";

/** What the run keeps of the accepted plan; the manifest itself stays in the operation fingerprint. */
interface StructuredSnapshot {
  readonly wiki: WikiImportSnapshot | null;
}

interface AcceptedRun {
  readonly stored: StoredAgentImportRun;
  readonly snapshot: StructuredSnapshot;
}

/** Binds an operation ID to the exact manifest and the plan that confirmed it. */
function operationFingerprint(input: AgentStructuredImportApplyInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        manifest: canonicalStructuredManifest(input.manifest),
        fingerprint: input.fingerprint,
      }),
    )
    .digest("hex");
}

/** The code a refused plan is reported with: what cannot be done outranks what cannot be found. */
function refusalCode(
  errors: readonly AgentStructuredIssue[],
): "FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" {
  if (errors.some((found) => found.code === "FORBIDDEN")) return "FORBIDDEN";
  if (errors.some((found) => found.code === "NOT_FOUND")) return "NOT_FOUND";
  return "INVALID_REQUEST";
}

function wikiContext(
  environment: StructuredImportEnvironment,
  projectId: string,
): WikiImportContext {
  return {
    actor: environment.actor,
    projectId,
    wiki: environment.wiki,
    access: environment.access,
    viewer: environment.viewer,
  };
}

/**
 * Previews and applies structured imports of Wiki, ticket, milestone and project sources.
 *
 * @remarks
 * The preview is a read. Applying it needs the fingerprint of a fresh preview,
 * writes one source per transaction and keeps every outcome, so a lost
 * response or an interruption is recovered by repeating the call with the same
 * operation ID. Wiki pages go through the A9.8 source service unchanged.
 */
export class StructuredImportService {
  private readonly dependencies: StructuredImportDependencies;
  private readonly steps: StructuredImportStepService;
  private readonly wikiSources: WikiImportSourceService;

  public constructor(dependencies: StructuredImportDependencies) {
    this.dependencies = dependencies;
    this.steps = new StructuredImportStepService({
      database: dependencies.creation.database,
      tickets: dependencies.planning.tickets,
      milestones: dependencies.planning.milestones,
      announcer: dependencies.planning.announcer,
    });
    this.wikiSources = new WikiImportSourceService(dependencies.creation);
  }

  /**
   * Previews a manifest without writing, visiting or contacting anything.
   *
   * @param identity - The verified owner of the call.
   * @param request - The raw operation parameters: `manifest`.
   * @returns Objects with their actions, links, assets, conflicts, errors and the fingerprint.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   */
  public async plan(
    identity: AgentIdentity,
    request: unknown,
  ): Promise<PagesAgentStructuredReadResponse> {
    const input = readStructuredImportPlan(request);
    const environment = await createStructuredImportEnvironment(
      this.dependencies.creation.database,
      identity.userId,
    );
    try {
      const preview = await previewStructuredImport(environment, input);
      const response: PagesAgentStructuredReadResponse = {
        apiVersion: "1",
        result: preview.plan,
      };
      this.requireSize(response);
      return response;
    } catch (error: unknown) {
      logCaughtError("StructuredImportService", error);

      throw translateAgentTicketError(error);
    }
  }

  /**
   * Applies a confirmed manifest, or recovers the run of its operation ID.
   *
   * @param identity - The verified owner of the call.
   * @param request - The raw operation parameters: `operationId`, `fingerprint`, `manifest`.
   * @param verify - Verifies the credential of the call anew, before each source.
   * @returns The outcome of every source, in the order they were applied.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` or `PAYLOAD_TOO_LARGE`.
   */
  public async apply(
    identity: AgentIdentity,
    request: unknown,
    verify: () => Promise<AgentIdentity>,
  ): Promise<PagesAgentWriteResponse> {
    const input = readStructuredImportApply(request);
    try {
      const accepted = await this.begin(identity.userId, input);
      if (accepted.stored.status === "running")
        await this.run(identity.userId, input, accepted, verify);
      if ((await verify()).userId !== identity.userId)
        throw new AgentOperationError("FORBIDDEN");
      const response: PagesAgentWriteResponse = {
        apiVersion: "1",
        result: await this.finish(identity.userId, accepted, input),
      };
      this.requireSize(response);
      return response;
    } catch (error: unknown) {
      logCaughtError("StructuredImportService", error);

      if (error instanceof AgentOperationError) throw error;
      const code = wikiImportErrorCode(translateAgentTicketError(error));
      if (code && code !== "AUTH_INVALID" && code !== "AUTH_UNAVAILABLE")
        throw new AgentOperationError(code);
      throw error;
    }
  }

  private requireSize(response: object): void {
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
        constraint: "responseBytes",
        limit: PAGES_AGENT_LIMITS.responseBytes,
      });
  }

  /** Accepts the plan atomically, or finds the run the operation ID belongs to. */
  private async begin(
    userId: string,
    input: AgentStructuredImportApplyInput,
  ): Promise<AcceptedRun> {
    return this.dependencies.creation.database.transaction(
      async (transaction) => {
        const environment = await createStructuredImportEnvironment(
          agentTransactionScope(transaction),
          userId,
        );
        const operations = new AgentOperationKeyRepository(transaction);
        const hash = operationFingerprint(input);
        const previous = await operations.find(userId, input.operationId);
        if (previous) {
          if (previous.operation !== OPERATION || previous.fingerprint !== hash)
            throw new AgentOperationError("CONFLICT");
          // The operation result holds only the run created in the same transaction.
          const reference = JSON.parse(previous.resultJson) as {
            readonly runId: string;
            readonly projectId: string;
          };
          const stored = await environment.imports.findRun(
            reference.runId,
            userId,
            reference.projectId,
          );
          if (!stored) throw new Error("Import run unavailable.");
          return {
            stored,
            snapshot: JSON.parse(stored.snapshotJson) as StructuredSnapshot,
          };
        }
        const preview = await previewStructuredImport(environment, input);
        if (preview.plan.errors.length > 0)
          throw new AgentOperationError(refusalCode(preview.plan.errors));
        if (preview.plan.fingerprint !== input.fingerprint)
          throw new AgentOperationError("CONFLICT");
        const snapshot = await this.snapshotOf(environment, preview);
        const stored: StoredAgentImportRun = {
          id: randomUUID(),
          userId,
          projectId: [...preview.projectIds.values()][0] ?? "",
          status: "running",
          snapshotJson: JSON.stringify(snapshot),
        };
        await environment.imports.insertRun(stored);
        await operations.insert(userId, input.operationId, {
          operation: OPERATION,
          fingerprint: hash,
          resultJson: JSON.stringify({
            runId: stored.id,
            projectId: stored.projectId,
          }),
        });
        return { stored, snapshot };
      },
    );
  }

  private async snapshotOf(
    environment: StructuredImportEnvironment,
    preview: StructuredImportPreview,
  ): Promise<StructuredSnapshot> {
    if (!preview.wiki) return { wiki: null };
    const { package: pack, plan } = preview.wiki;
    return {
      wiki: {
        plan,
        parents: await readWikiImportParents(
          wikiContext(environment, pack.projectId),
          pack.request.parentId,
        ),
      },
    };
  }

  /** Applies milestones, tickets and dependencies, then the pages; recorded sources are never repeated. */
  private async run(
    userId: string,
    input: AgentStructuredImportApplyInput,
    accepted: AcceptedRun,
    verify: () => Promise<AgentIdentity>,
  ): Promise<void> {
    const graph = planStructuredImport(input.manifest);
    const projectIds = new Map(
      [...graph.sources.projects.values()].map((project) => [
        project.key,
        project.projectId,
      ]),
    );
    const run = { id: accepted.stored.id, userId, graph, projectIds };
    let ordinal = 0;
    for (const step of graph.steps)
      await this.steps.apply(run, step, ordinal++, verify);
    const wiki = accepted.snapshot.wiki;
    if (!wiki) return;
    const { assets } = readStructuredAssetMap(input.manifest);
    const pack = buildStructuredWiki(input.manifest, assets, projectIds);
    if (!pack) return;
    const wikiInput = structuredWikiApplyInput(pack, wiki.plan.fingerprint);
    const wikiRun: WikiImportRun = {
      id: run.id,
      userId,
      projectId: pack.projectId,
      snapshot: wiki,
    };
    for (const source of wikiImportPackage(wikiInput, wiki.plan))
      await this.wikiSources.apply(
        wikiRun,
        { ...source, ordinal: source.ordinal + ordinal },
        wikiInput,
        verify,
      );
  }

  /** Re-checks visibility of every target before an identifier leaves the server, then closes the run. */
  private async finish(
    userId: string,
    accepted: AcceptedRun,
    input: AgentStructuredImportApplyInput,
  ): Promise<AgentStructuredImportApplied> {
    const projectIds = new Map(
      input.manifest.sources.flatMap((source) =>
        source.kind === "project"
          ? [[source.key, source.projectId] as const]
          : [],
      ),
    );
    const wikiProjectId = input.manifest.wiki
      ? projectIds.get(input.manifest.wiki.project)
      : undefined;
    return this.dependencies.creation.database.transaction(
      async (transaction) => {
        const environment = await createStructuredImportEnvironment(
          agentTransactionScope(transaction),
          userId,
        );
        const items = (
          await environment.imports.listStoredItems(accepted.stored.id)
        ).map(toStructuredItem);
        for (const entry of items)
          await this.requireVisible(environment, entry, wikiProjectId);
        const counts = await environment.imports.finishRun(accepted.stored.id);
        return {
          runId: accepted.stored.id,
          status:
            counts.conflict > 0 || counts.failed > 0 ? "partial" : "complete",
          counts,
          items,
        };
      },
    );
  }

  private async requireVisible(
    environment: StructuredImportEnvironment,
    entry: AgentStructuredImportItem,
    wikiProjectId: string | undefined,
  ): Promise<void> {
    if (entry.targetId === null) return;
    if (entry.kind === "ticket") {
      await environment.tasks.tasks.getById(environment.actor, entry.targetId);
      return;
    }
    if (entry.kind !== "wiki") return;
    let page;
    try {
      page = await new WikiPageReader(environment.wiki).require(
        environment.viewer.scope,
        entry.targetId,
      );
    } catch (error: unknown) {
      logCaughtError("StructuredImportService", error);

      if (error instanceof WikiPageNotFoundError)
        throw new AgentOperationError("NOT_FOUND");
      throw error;
    }
    if (page.projectId !== wikiProjectId || page.scope !== WIKI_SCOPE.PROJECT)
      throw new AgentOperationError("NOT_FOUND");
  }
}
