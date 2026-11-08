import { GoogleDriveRepository } from "@/backend/database/repositories/google/GoogleDriveRepository";
import { StorageStartFolderRepository } from "@/backend/database/repositories/google/StorageStartFolderRepository";
import { GoogleDriveApiClient } from "@/backend/google/GoogleDriveApiClient";
import {
  findMissingGoogleDriveSettings,
  readGoogleOAuthApplication,
} from "@/backend/google/GoogleDriveConfig";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { GoogleDriveFilesClient } from "@/backend/google/GoogleDriveFilesClient";
import { GoogleDriveConnectionService } from "@/backend/service/google/GoogleDriveConnectionService";
import { GoogleDriveStorageService } from "@/backend/service/google/GoogleDriveStorageService";

import type { Database } from "@/backend/database/Database";

/** The Google Drive sign-in of the system settings (PAGE-170) and the Storage area (PAGE-188). */
export interface GoogleDriveApplicationServices {
  readonly googleDriveConnectionService: GoogleDriveConnectionService;
  readonly googleDriveStorageService: GoogleDriveStorageService;
}

/**
 * Creates the Google Drive connection of the instance.
 *
 * @param database - Central database access.
 * @param instanceKey - The key the instance encrypts its connection secrets with.
 * @returns The connection service, which without the OAuth client of the
 * instance only names the settings that are missing, and the Storage area on it.
 *
 * @remarks
 * The OAuth client comes from the environment, like the Discord application,
 * and never leaves this process.
 */
export function createGoogleDriveServices(
  database: Database,
  instanceKey: Buffer,
): GoogleDriveApplicationServices {
  const application = readGoogleOAuthApplication();

  const googleDriveConnectionService = new GoogleDriveConnectionService({
    cipher: new InstanceSecretCipher(instanceKey),
    missingSettings: findMissingGoogleDriveSettings(),
    repository: new GoogleDriveRepository(database),
    runtime: application
      ? { application, client: new GoogleDriveApiClient(application) }
      : null,
  });

  return {
    googleDriveConnectionService,
    googleDriveStorageService: new GoogleDriveStorageService({
      connection: googleDriveConnectionService,
      files: new GoogleDriveFilesClient(),
      startFolders: new StorageStartFolderRepository(database),
    }),
  };
}
