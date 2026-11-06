import { afterCallCommit } from "@/backend/database/CallTransaction";

import type { WikiAttachmentService } from "./WikiAttachmentService";
import type { WikiSettingsService } from "./WikiSettingsService";
import type { WikiTrashService } from "./WikiTrashService";
import type { WikiVersionService } from "./WikiVersionService";

/** Removes what outlived its retention time: trash and old versions. */
export class WikiMaintenanceService {
  private readonly settings: WikiSettingsService;
  private readonly trash: WikiTrashService;
  private readonly versions: WikiVersionService;
  private readonly attachments: WikiAttachmentService;

  /**
   * Creates the service.
   *
   * @param settings - Provides the retention times.
   * @param trash - Removes expired pages.
   * @param versions - Removes old versions.
   * @param attachments - Removes files of expired pages and orphaned files.
   */
  public constructor(
    settings: WikiSettingsService,
    trash: WikiTrashService,
    versions: WikiVersionService,
    attachments: WikiAttachmentService,
  ) {
    this.settings = settings;
    this.trash = trash;
    this.versions = versions;
    this.attachments = attachments;
  }

  /**
   * Runs one cleanup: expired trash with its files, old versions, and files
   * that no attachment refers to any more.
   *
   * @returns The trash roots that were removed for good.
   */
  public async run(): Promise<readonly string[]> {
    const settings = await this.settings.get();
    const purged = await this.trash.purgeExpired(settings.trashRetentionDays);

    // Inside an announced call, files and the other cleanups follow the committed purge.
    await afterCallCommit(async () => {
      await this.attachments.removeFiles(purged.files);
      await this.versions.prune(
        settings.versionRetentionDays,
        settings.versionKeepLast,
      );
      await this.attachments.sweep();
    });
    return purged.rootIds;
  }
}
