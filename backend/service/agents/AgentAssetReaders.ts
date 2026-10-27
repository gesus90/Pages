import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";

import { AgentTicketAssetService } from "./AgentTicketAssetService";
import { createAgentTaskContext } from "./AgentTaskAccess";

import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { User } from "@/definition/User";
import type { WikiService } from "@/backend/service/WikiService";
import type { AgentAssetService } from "./AgentAssetService";

/** Uses the same attachment/file services as plan input; the MCP actor policy is applied per read. */
export function createAgentAssetReaders(input: {
  readonly database: TaskDatabase;
  readonly directory: string;
  readonly wiki: Pick<WikiService, "getSettings" | "openAttachment">;
  readonly assets: AgentAssetService;
}): AgentTicketAssetService {
  function tickets(actor: User): TaskAttachmentService {
    return new TaskAttachmentService(
      new WorkItemAttachmentRepository(input.database),
      createAgentTaskContext(input.database, actor).tasks,
      input.wiki,
      new TicketFileStore(input.directory),
    );
  }
  return new AgentTicketAssetService({
    tickets: {
      list: (actor, id) => tickets(actor).list(actor, id),
      open: (actor, id) => tickets(actor).open(actor, id),
    },
    wiki: input.wiki,
    assets: input.assets,
  });
}
