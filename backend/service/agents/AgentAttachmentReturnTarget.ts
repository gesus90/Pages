import path from "node:path";
import { createHash } from "node:crypto";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { WikiAttachmentService } from "@/backend/service/wiki/WikiAttachmentService";
import { WikiSettingsService } from "@/backend/service/wiki/WikiSettingsService";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { createAgentWikiAccess } from "./AgentWikiAccess";
import { createAgentTaskContext } from "./AgentTaskAccess";

import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { User } from "@/definition/User";
import type { UploadedFile } from "@/backend/service/WikiService";
import type { UploadLimitSource } from "@/backend/service/task/TaskAttachmentService";
import type { AgentAsset } from "@/definition/PagesAgentWrites";

/** Immutable destination identity; no caller-supplied directory is part of it. */
export interface AttachmentReturnDestination {
  readonly type: "ticket" | "wiki";
  readonly id: string;
}

interface StoredReturnAttachment {
  readonly id: string;
  readonly ownerId: string;
  readonly checksum: string;
  readonly storageName: string;
}

/** The original attachment services retain authorization, storage layout and MIME decisions. */
export interface AttachmentReturnTarget {
  readonly authorize: () => Promise<void>;
  readonly find: (id: string) => Promise<StoredReturnAttachment | null>;
  readonly upload: (file: UploadedFile) => Promise<AgentAsset>;
  readonly requireFile: (name: string) => Promise<void>;
  readonly digest: (name: string) => Promise<string>;
  readonly remove: (names: readonly string[]) => Promise<void>;
}

/** Chooses an existing domain service within the caller's transaction and current MCP actor policy. */
export function attachmentReturnTarget(input: {
  readonly scope: TaskDatabase;
  readonly actor: User;
  readonly directory: string;
  readonly limits: UploadLimitSource;
  readonly destination: AttachmentReturnDestination;
}): AttachmentReturnTarget {
  if (input.destination.type === "wiki") return wikiTarget(input);
  const repository = new WorkItemAttachmentRepository(input.scope);
  const files = new TicketFileStore(input.directory);
  const service = new TaskAttachmentService(
    repository,
    createAgentTaskContext(input.scope, input.actor).tasks,
    input.limits,
    files,
  );
  return {
    authorize: () => service.authorizeUpload(input.actor, input.destination.id),
    find: async (id) => {
      const stored = await repository.find(id);
      return stored ? { ...stored, ownerId: stored.workItemId } : null;
    },
    upload: async (file) => {
      const result = await service.upload(
        input.actor,
        input.destination.id,
        file,
      );
      return {
        assetId: result.id,
        link: `/aufgaben/attachments/${result.id}`,
        fileName: result.fileName,
        contentType: result.contentType,
        size: result.size,
        expiresAt: null,
      };
    },
    requireFile: (name) => files.requireFile(name),
    digest: async (name) => (await files.inspect(name)).checksum,
    remove: (names) => files.remove(names),
  };
}

function wikiTarget(
  input: Parameters<typeof attachmentReturnTarget>[0],
): AttachmentReturnTarget {
  const wiki = new WikiRepository(input.scope);
  const files = new WikiFileStore(
    path.join(input.directory, "wiki-attachments"),
  );
  const access = createAgentWikiAccess(
    new ProjectRepository(input.scope),
    input.actor,
  );
  const service = new WikiAttachmentService(
    wiki,
    access,
    new WikiSettingsService(wiki, new PermissionService()),
    files,
  );
  return {
    authorize: async () => {
      const viewer = await access.resolve(input.actor);
      if (!viewer.canWrite) throw new AgentOperationError("FORBIDDEN");
      await new WikiPageReader(wiki).require(
        viewer.scope,
        input.destination.id,
      );
    },
    find: async (id) => {
      const stored = await wiki.attachments.find(id);
      return stored ? { ...stored, ownerId: stored.pageId } : null;
    },
    upload: async (file) => {
      const result = await service.upload(
        input.actor,
        input.destination.id,
        file,
      );
      return {
        assetId: result.id,
        link: `/wiki/attachments/${result.id}`,
        fileName: result.fileName,
        contentType: result.contentType,
        size: result.size,
        expiresAt: null,
      };
    },
    requireFile: async (name) => {
      await wikiFileDigest(files, name);
    },
    digest: (name) => wikiFileDigest(files, name),
    remove: (names) => files.remove(names),
  };
}

async function wikiFileDigest(
  files: WikiFileStore,
  name: string,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of files.open(name)) hash.update(bytes);
  return hash.digest("hex");
}
