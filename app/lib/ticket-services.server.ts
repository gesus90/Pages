import path from "node:path";

import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TaskDescriptionAssetService } from "@/backend/service/task/TaskDescriptionAssetService";
import { TicketAssetAuditService } from "@/backend/service/task/TicketAssetAuditService";
import { TicketTreeService } from "@/backend/service/task/TicketTreeService";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";

import { sweepTicketAttachments } from "./services-background.server";

import type { Database } from "@/backend/database/Database";
import type { TaskService } from "@/backend/service/TaskService";
import type { WikiService } from "@/backend/service/WikiService";

/** The services of ticket attachments, the ticket asset audit and the ticket tree. */
export interface TicketServices {
  readonly taskAttachmentService: TaskAttachmentService;
  readonly ticketTreeService: TicketTreeService;
  readonly ticketAssetAuditService: TicketAssetAuditService;
}

/**
 * Creates the services of ticket attachments and the ticket tree (A8.2).
 *
 * @param database - The open database.
 * @param databasePath - Path of the database; attachments lie next to it.
 * @param taskService - Checks the access to tickets.
 * @param wikiService - Provides the instance-wide upload limits.
 * @returns The services, with the attachment files tied to ticket deletion.
 */
export function createTicketServices(
  database: Database,
  databasePath: string,
  taskService: TaskService,
  wikiService: WikiService,
): TicketServices {
  const taskAttachmentService = new TaskAttachmentService(
    new WorkItemAttachmentRepository(database),
    taskService,
    wikiService,
    new TicketFileStore(path.dirname(databasePath)),
  );

  taskService.setAttachmentFiles(taskAttachmentService);
  taskService.setDescriptionAssets(
    new TaskDescriptionAssetService(database, path.dirname(databasePath)),
  );
  void sweepTicketAttachments(taskAttachmentService);

  return {
    taskAttachmentService,
    ticketAssetAuditService: new TicketAssetAuditService(
      database,
      path.dirname(databasePath),
    ),
    ticketTreeService: new TicketTreeService(
      new WorkItemTreeRepository(database),
      taskService,
    ),
  };
}
