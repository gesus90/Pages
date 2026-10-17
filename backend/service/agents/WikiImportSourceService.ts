import { createHash } from "node:crypto";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WIKI_SCOPE } from "@/definition/Wiki";
import { logCaughtError } from "@/backend/logging/Logger";

import { AgentWikiCreateTransaction } from "./AgentWikiCreateTransaction";
import {
  readWikiImportParents,
  requireWikiImportPage,
  resolveWikiImportContext,
} from "./WikiImportContext";
import {
  wikiImportSourceFingerprint,
  wikiImportSourceKey,
} from "./WikiImportPackage";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type {
  AgentImportApplyInput,
  AgentImportItem,
} from "@/definition/AgentImportApply";
import type {
  AgentImportParent,
  AgentImportPlan,
} from "@/definition/AgentImportManifest";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";
import type { AgentWikiCreated } from "@/definition/PagesAgentWrites";
import type { AgentWikiCreateDependencies } from "./AgentWikiCreateService";
import type {
  WikiImportContext,
  WikiImportSnapshot,
} from "./WikiImportContext";
import type { WikiImportSource } from "./WikiImportPackage";

/** Accepted durable run; each worker loads its authority again before processing a source. */
export interface WikiImportRun {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly snapshot: WikiImportSnapshot;
}

/** Translates anticipated source failures; infrastructure failures keep the run resumable. */
export function wikiImportErrorCode(
  error: unknown,
): AgentOperationError["code"] | "AUTH_INVALID" | "AUTH_UNAVAILABLE" | null {
  if (error instanceof AgentOperationError) return error.code;
  if (error instanceof WikiPageNotFoundError) return "NOT_FOUND";
  if (error instanceof WikiValidationError) return "INVALID_REQUEST";
  if (error instanceof McpAuthorizationError)
    return error.status === 503 ? "AUTH_UNAVAILABLE" : "AUTH_INVALID";
  if (
    error instanceof WikiAccessDeniedError ||
    error instanceof ProjectAccessDeniedError
  )
    return "FORBIDDEN";
  return null;
}

function failure(
  source: WikiImportSource,
  code: PagesAgentApiErrorCode,
): AgentImportItem {
  return {
    sourceKey: source.sourceKey,
    targetKey: source.targetKey,
    action: code === "CONFLICT" ? "conflict" : "failed",
    pageId: null,
    link: null,
    assets: [],
    errorCode: code,
  };
}

/** Rejects a source the confirmed plan reports as invalid or conflicting; title collisions are decided by the caller. */
export function diagnoseWikiImportSource(
  plan: AgentImportPlan,
  source: WikiImportSource,
): void {
  if (!source.page) throw new AgentOperationError("INVALID_REQUEST");
  const issue = [...plan.errors, ...plan.conflicts].find(
    (entry) =>
      entry.reason !== "title_conflict" &&
      (entry.targetKey === source.targetKey ||
        entry.sourceKeys.includes(source.sourceKey)),
  );
  if (issue) throw new AgentOperationError(issue.code);
}

/** Applies one source and its durable outcome atomically, with post-commit asset/page effects. */
export class WikiImportSourceService {
  private readonly dependencies: AgentWikiCreateDependencies;

  public constructor(dependencies: AgentWikiCreateDependencies) {
    this.dependencies = dependencies;
  }

  /** Re-verifies the credential, then serializes competing workers on the source transaction. */
  public async apply(
    run: WikiImportRun,
    source: WikiImportSource,
    input: AgentImportApplyInput,
    verify: () => Promise<AgentIdentity>,
  ): Promise<void> {
    const creation = new AgentWikiCreateTransaction(this.dependencies);
    try {
      if ((await verify()).userId !== run.userId)
        throw new McpAuthorizationError("invalid_token", 401);
      await this.dependencies.database.transaction(async (transaction) => {
        const context = await resolveWikiImportContext(
          transaction,
          run.userId,
          run.projectId,
        );
        if (!context.viewer.canWrite)
          throw new AgentOperationError("FORBIDDEN");
        const repository = new AgentImportRepository(transaction);
        const previous = await repository.findItem(run.id, source.sourceKey);
        if (previous) {
          if (previous.pageId)
            await requireWikiImportPage(context, previous.pageId);
          return;
        }
        const parents = await readWikiImportParents(context, input.parentId);
        if (JSON.stringify(parents) !== JSON.stringify(run.snapshot.parents))
          throw new AgentOperationError("CONFLICT");
        diagnoseWikiImportSource(run.snapshot.plan, source);
        const item = await this.applySource(
          { context, repository, transaction, creation },
          run,
          source,
          input,
        );
        await repository.recordItem(run.id, source.ordinal, item);
      });
    } catch (error: unknown) {
      logCaughtError("WikiImportSourceService", error);

      await creation.rollback();
      const code = wikiImportErrorCode(error);
      if (!code) throw error;
      await this.dependencies.database.transaction(async (transaction) => {
        const repository = new AgentImportRepository(transaction);
        if (!(await repository.findItem(run.id, source.sourceKey)))
          await repository.recordItem(
            run.id,
            source.ordinal,
            failure(source, code),
          );
      });
      return;
    }
    creation.publish();
  }

  private async applySource(
    resources: {
      readonly context: WikiImportContext;
      readonly repository: AgentImportRepository;
      readonly transaction: DatabaseTransaction;
      readonly creation: AgentWikiCreateTransaction;
    },
    run: WikiImportRun,
    source: WikiImportSource,
    input: AgentImportApplyInput,
  ): Promise<AgentImportItem> {
    const { context, repository, transaction, creation } = resources;
    const parent = run.snapshot.plan.edges.find(
      (edge) => edge.childKey === source.targetKey,
    )?.parent;
    if (!parent || !source.page)
      throw new AgentOperationError("INVALID_REQUEST");
    const parentId = await this.resolveParent(repository, run, parent, context);
    const hash = wikiImportSourceFingerprint(input, source, parent);
    const mapping = await repository.findSource(
      run.projectId,
      source.sourceKey,
    );
    if (mapping) {
      const item = await this.compareSource(context, mapping, {
        source,
        parentId,
        hash,
      });
      if (item.action === "skipped")
        await repository.touchSource(run.projectId, source.sourceKey, run.id);
      return item;
    }
    const conflicts = run.snapshot.plan.conflicts.filter(
      (issue) =>
        issue.reason === "title_conflict" &&
        issue.targetKey === source.targetKey,
    );
    const children = await context.wiki.pages.listProjectChildren(
      context.viewer.scope,
      run.projectId,
      parentId,
    );
    if (
      conflicts.length ||
      children.some((page) => page.title === source.page?.title)
    )
      throw new AgentOperationError("CONFLICT");
    const created = await creation.create(
      context.actor,
      {
        operationId: `wiki.import:${run.id}:${createHash("sha256").update(source.sourceKey).digest("hex")}`,
        projectId: run.projectId,
        parentId,
        title: source.page.title,
        content:
          input.manifest.files.find(
            (file) => file.sourceKey === source.sourceKey,
          )?.content ?? "",
        icon: null,
        assetIds:
          input.assets.find((entry) => entry.sourceKey === source.sourceKey)
            ?.assetIds ?? [],
      },
      transaction,
    );
    await repository.insertSource({
      projectId: run.projectId,
      sourceKey: source.sourceKey,
      targetKind: "wiki",
      targetId: created.pageId,
      contentHash: hash,
      targetRevision: 1,
      resultJson: JSON.stringify(created),
      lastRunId: run.id,
    });
    return {
      sourceKey: source.sourceKey,
      targetKey: source.targetKey,
      action: "created",
      ...created,
      errorCode: null,
    };
  }

  private async resolveParent(
    repository: AgentImportRepository,
    run: WikiImportRun,
    parent: AgentImportParent,
    context: WikiImportContext,
  ): Promise<string | null> {
    if (parent.kind === "existing") return parent.pageId;
    const page = run.snapshot.plan.pages.find(
      (entry) => entry.key === parent.key,
    );
    if (!page) throw new AgentOperationError("INVALID_REQUEST");
    const key = wikiImportSourceKey(page);
    const item = await repository.findItem(run.id, key);
    if (item?.action === "failed" || item?.action === "conflict")
      throw new AgentOperationError("CONFLICT");
    const mapping = await repository.findSource(run.projectId, key);
    if (!mapping || mapping.targetKind !== "wiki")
      throw new AgentOperationError("CONFLICT");
    const target = await new WikiPageReader(context.wiki).require(
      context.viewer.scope,
      mapping.targetId,
    );
    if (
      target.projectId !== run.projectId ||
      target.scope !== WIKI_SCOPE.PROJECT
    )
      throw new AgentOperationError("NOT_FOUND");
    if (
      target.isTemplate ||
      target.title !== page.title ||
      target.revision !== mapping.targetRevision
    )
      throw new AgentOperationError("CONFLICT");
    return mapping.targetId;
  }

  private async compareSource(
    context: WikiImportContext,
    mapping: StoredAgentImportSource,
    expected: {
      readonly source: WikiImportSource;
      readonly parentId: string | null;
      readonly hash: string;
    },
  ): Promise<AgentImportItem> {
    if (mapping.targetKind !== "wiki")
      throw new AgentOperationError("CONFLICT");
    const page = await new WikiPageReader(context.wiki).require(
      context.viewer.scope,
      mapping.targetId,
    );
    if (
      page.projectId !== context.projectId ||
      page.scope !== WIKI_SCOPE.PROJECT
    )
      throw new AgentOperationError("NOT_FOUND");
    const hasChanged =
      mapping.contentHash !== expected.hash ||
      page.revision !== mapping.targetRevision ||
      page.parentId !== expected.parentId ||
      page.isTemplate;
    // This result was written with the source mapping in its creation transaction.
    const created = JSON.parse(mapping.resultJson) as AgentWikiCreated;
    return {
      sourceKey: expected.source.sourceKey,
      targetKey: expected.source.targetKey,
      action: hasChanged ? "conflict" : "skipped",
      ...created,
      errorCode: hasChanged ? "CONFLICT" : null,
    };
  }
}
