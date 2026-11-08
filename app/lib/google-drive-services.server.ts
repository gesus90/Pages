import { GoogleDriveRepository } from "@/backend/database/repositories/google/GoogleDriveRepository";
import { GoogleDriveApiClient } from "@/backend/google/GoogleDriveApiClient";
import {
  findMissingGoogleDriveSettings,
  readGoogleOAuthApplication,
} from "@/backend/google/GoogleDriveConfig";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { GoogleDriveConnectionService } from "@/backend/service/google/GoogleDriveConnectionService";

import type { Database } from "@/backend/database/Database";

/** The Google Drive sign-in of the system settings (PAGE-170). */
export interface GoogleDriveApplicationServices {
  readonly googleDriveConnectionService: GoogleDriveConnectionService;
}

/**
 * Creates the Google Drive connection of the instance.
 *
 * @param database - Central database access.
 * @param instanceKey - The key the instance encrypts its connection secrets with.
 * @returns The connection service; without the OAuth client of the instance it
 * only names the settings that are missing.
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

  return {
    googleDriveConnectionService: new GoogleDriveConnectionService({
      cipher: new InstanceSecretCipher(instanceKey),
      missingSettings: findMissingGoogleDriveSettings(),
      repository: new GoogleDriveRepository(database),
      runtime: application
        ? { application, client: new GoogleDriveApiClient(application) }
        : null,
    }),
  };
}
