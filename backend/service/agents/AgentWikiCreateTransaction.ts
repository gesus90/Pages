import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { AgentOperationKeyService } from "./AgentOperationKeyService";
import { agentTransactionScope } from "./AgentTransactionScope";
import { createAgentWikiAccess } from "./AgentWikiAccess";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAgentAsset } from "@/backend/database/repositories/agents/AgentAssetRepository";
import type {
  AgentWikiCreateInput,
  AgentWikiCreated,
} from "@/definition/PagesAgentWrites";
import type { User } from "@/definition/User";
import type { AgentWikiCreateDependencies } from "./AgentWikiCreateService";

/** Shares A9.6 creation with an outer import transaction and defers effects until its commit. */
export class AgentWikiCreateTransaction {
  private readonly dependencies: AgentWikiCreateDependencies;
  private readonly copies: string[] = [];
  private created: AgentWikiCreated | null = null;

  public constructor(dependencies: AgentWikiCreateDependencies) {
    this.dependencies = dependencies;
  }

  /** Creates a page, attachments and operation result on the already locked connection. */
  public async create(
    actor: User,
    input: AgentWikiCreateInput,
    transaction: DatabaseTransaction,
  ): Promise<AgentWikiCreated> {
    const scope = agentTransactionScope(transaction);
    const channel = this.dependencies.channel ?? "mcp";
    const wiki = new WikiRepository(scope, agentChannelPolicy(channel).source);
    const access = createAgentWikiAccess(
      new ProjectRepository(scope),
      actor,
      channel,
    );
    const viewer = await access.resolve(actor);
    if (!viewer.canWrite) throw new AgentOperationError("FORBIDDEN");
    if (
      input.projectId !== null &&
      !viewer.scope.projectIds.includes(input.projectId)
    )
      throw new AgentOperationError("NOT_FOUND");
    const reader = new WikiPageReader(wiki);
    if (input.parentId !== null) {
      const parent = await reader.require(viewer.scope, input.parentId);
      if (
        parent.projectId !== input.projectId ||
        parent.scope !== (input.scope ?? WIKI_SCOPE.PROJECT)
      )
        throw new AgentOperationError("NOT_FOUND");
    }
    const operations = new AgentOperationKeyService(
      new AgentOperationKeyRepository(transaction),
    );
    const previous = await operations.replay(actor.id, input);
    if (previous) {
      await reader.require(viewer.scope, previous.pageId);
      return previous;
    }
    const assets = new AgentAssetRepository(transaction);
    const owned = await this.requireAssets(assets, actor.id, input.assetIds);
    const page = await new WikiPageService(wiki, access).create(actor, {
      ...input,
      scope: input.scope ?? WIKI_SCOPE.PROJECT,
      anchors: [],
      isTemplate: false,
      templateId: null,
    });
    const created: AgentWikiCreated = {
      pageId: page.id,
      link: `/wiki/${page.id}`,
      assets: await this.linkAssets(wiki, assets, actor.id, {
        pageId: page.id,
        owned,
      }),
    };
    await operations.save(actor.id, input, created);
    this.created = created;
    return created;
  }

  /** Publishes only once the outermost transaction committed all associated records. */
  public publish(): void {
    if (!this.created) return;
    this.dependencies.events.publish({
      type: "wiki.page.created",
      id: this.created.pageId,
    });
    for (const asset of this.created.assets)
      this.dependencies.events.publish({
        type: "asset.linked",
        id: asset.assetId,
      });
  }

  /** Removes copied bytes after any outer rollback, preserving the original staged files. */
  public async rollback(): Promise<void> {
    await this.dependencies.wikiFiles.remove(this.copies);
  }

  private async requireAssets(
    repository: AgentAssetRepository,
    userId: string,
    assetIds: readonly string[],
  ): Promise<StoredAgentAsset[]> {
    const owned: StoredAgentAsset[] = [];
    for (const id of assetIds) {
      const asset = await repository.find(id);
      if (
        !asset ||
        asset.userId !== userId ||
        asset.status !== "staged" ||
        asset.expiresAt <= Date.now()
      )
        throw new AgentOperationError("NOT_FOUND");
      owned.push(asset);
    }
    return owned;
  }

  private async linkAssets(
    wiki: WikiRepository,
    assets: AgentAssetRepository,
    userId: string,
    input: {
      readonly pageId: string;
      readonly owned: readonly StoredAgentAsset[];
    },
  ): Promise<AgentWikiCreated["assets"]> {
    const linked: AgentWikiCreated["assets"][number][] = [];
    for (const asset of input.owned) {
      const storageName = await this.dependencies.staging.copyTo(
        asset.storageName,
        this.dependencies.wikiFiles,
      );
      this.copies.push(storageName);
      const attachment = await wiki.attachments.insert({
        ...asset,
        storageName,
        pageId: input.pageId,
        uploadedBy: userId,
      });
      await assets.link(asset.id, input.pageId, attachment.id);
      linked.push({
        assetId: asset.id,
        attachmentId: attachment.id,
        link: `/agent-assets/${asset.id}`,
      });
    }
    return linked;
  }
}
