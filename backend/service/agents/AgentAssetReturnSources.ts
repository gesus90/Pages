import path from "node:path";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { WikiAttachmentService } from "@/backend/service/wiki/WikiAttachmentService";
import { WikiSettingsService } from "@/backend/service/wiki/WikiSettingsService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { createAgentAssetReaders } from "./AgentAssetReaders";
import { AgentAssetService } from "./AgentAssetService";
import { createAgentWikiAccess } from "./AgentWikiAccess";

import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { AgentTicketAssetService } from "./AgentTicketAssetService";

/** Reuses each origin's own access policy when a derived file is returned to a different ticket or wiki page. */
export function assetReturnSources(
  scope: TaskDatabase,
  directory: string,
): AgentTicketAssetService {
  const repository = new WikiRepository(scope);
  const settings = new WikiSettingsService(repository, new PermissionService());
  const wiki = {
    getSettings: () => settings.get(),
    openAttachment: (
      actor: Parameters<WikiAttachmentService["open"]>[0],
      id: string,
    ) =>
      new WikiAttachmentService(
        repository,
        createAgentWikiAccess(new ProjectRepository(scope), actor),
        settings,
        new WikiFileStore(path.join(directory, "wiki-attachments")),
      ).open(actor, id),
  };
  const assets = new AgentAssetService({
    repository: new AgentAssetRepository(scope),
    files: new WikiFileStore(path.join(directory, "agent-assets")),
    wiki,
  });
  return createAgentAssetReaders({ database: scope, directory, wiki, assets });
}
