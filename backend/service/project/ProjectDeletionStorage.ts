import path from "node:path";

import { TicketFileStore } from "@/backend/storage/TicketFileStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import type { ProjectDeletionFiles } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { ProjectDeletionEffects } from "./ProjectDeletionService";

/** What a project deletion needs from the plan runs: ending them and clearing their record files. */
export interface ProjectRunControl {
  stopProject(projectId: string): Promise<void>;
  removeRunRecordFiles(
    keys: ProjectDeletionFiles["agentRunRecords"],
  ): Promise<void>;
}

/**
 * Reaches the plan runs and the attachment directories next to the database.
 *
 * @remarks
 * The interface and MCP build it the same way, so a deleted project leaves the
 * same files behind no matter where the deletion came from.
 */
export class ProjectDeletionStorage implements ProjectDeletionEffects {
  private readonly runs: ProjectRunControl;
  private readonly wikiFiles: WikiFileStore;
  private readonly ticketFiles: TicketFileStore;

  /**
   * Creates the effects.
   *
   * @param runs - The plan service, which owns the running plans and their record files.
   * @param directory - The directory that holds the database and the attachment folders.
   */
  public constructor(runs: ProjectRunControl, directory: string) {
    this.runs = runs;
    this.wikiFiles = new WikiFileStore(
      path.join(directory, "wiki-attachments"),
    );
    this.ticketFiles = new TicketFileStore(directory);
  }

  /** Stops the plan runs of the project and waits until they have closed. */
  public async stopRuns(projectId: string): Promise<void> {
    await this.runs.stopProject(projectId);
  }

  /** Removes every file whose row the deletion removed. */
  public async removeFiles(files: ProjectDeletionFiles): Promise<void> {
    await this.wikiFiles.remove(files.wikiAttachments);
    await this.ticketFiles.remove(files.ticketAttachments);
    await this.runs.removeRunRecordFiles(files.agentRunRecords);
  }
}
