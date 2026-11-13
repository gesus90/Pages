import { StorageAccessRepository } from "@/backend/database/repositories/google/StorageAccessRepository";
import { StorageAccessService } from "@/backend/service/google/StorageAccessService";
import { StorageFileReader } from "@/backend/service/google/StorageFileReader";
import { GoogleDriveRepository } from "@/backend/database/repositories/google/GoogleDriveRepository";
import { StorageStartFolderRepository } from "@/backend/database/repositories/google/StorageStartFolderRepository";
import { GoogleDriveApiClient } from "@/backend/google/GoogleDriveApiClient";
import {
  findMissingGoogleDriveSettings,
  readGoogleOAuthApplication,
} from "@/backend/google/GoogleDriveConfig";
import { GoogleDriveFilesClient } from "@/backend/google/GoogleDriveFilesClient";
import { GoogleDriveItemsClient } from "@/backend/google/GoogleDriveItemsClient";
import { GoogleDriveSimulation } from "@/backend/google/GoogleDriveSimulation";
import { readGoogleDriveSimulation } from "@/backend/google/GoogleDriveSimulationConfig";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { GoogleDriveConnectionService } from "@/backend/service/google/GoogleDriveConnectionService";
import { GoogleDriveFileService } from "@/backend/service/google/GoogleDriveFileService";
import { GoogleDriveSimulatedConnection } from "@/backend/service/google/GoogleDriveSimulatedConnection";
import { GoogleDriveStorageService } from "@/backend/service/google/GoogleDriveStorageService";

import type { StorageAccessDependencies } from "@/backend/service/google/StorageAccessService";
import type { Database } from "@/backend/database/Database";
import type { GoogleFetch } from "@/backend/google/GoogleDriveResponses";
import type { GoogleDriveConnection } from "@/backend/service/google/GoogleDriveConnectionService";

/** The client id the simulation passes to the account check; it never reaches Google. */
const SIMULATED_APPLICATION = {
  clientId: "simulation.apps.googleusercontent.com",
  clientSecret: "simulation",
};

/**
 * The Google Drive sign-in of the system settings (PAGE-170), the Storage
 * area (PAGE-188) and the Storage interface for files and folders (PAGE-270).
 */
export interface GoogleDriveApplicationServices {
  readonly googleDriveConnectionService: GoogleDriveConnection;
  readonly googleDriveStorageService: GoogleDriveStorageService;
  readonly googleDriveFileService: GoogleDriveFileService;
  readonly storageAccessService: StorageAccessService;
}

/** The connection and the `fetch` the Drive clients use. */
interface DriveWiring {
  readonly connection: GoogleDriveConnection;
  readonly fetcher: GoogleFetch | undefined;
  readonly isSimulation: boolean;
  readonly canRequestWriteAccess: boolean;
}

function realWiring(database: Database, instanceKey: Buffer): DriveWiring {
  const application = readGoogleOAuthApplication();

  return {
    canRequestWriteAccess: application !== null,
    connection: new GoogleDriveConnectionService({
      cipher: new InstanceSecretCipher(instanceKey),
      missingSettings: findMissingGoogleDriveSettings(),
      repository: new GoogleDriveRepository(database),
      runtime: application
        ? { application, client: new GoogleDriveApiClient(application) }
        : null,
    }),
    fetcher: undefined,
    isSimulation: false,
  };
}

/**
 * Wires the in-memory Drive: every Drive client answers from the simulation,
 * and the connection counts as connected without a sign-in.
 */
function simulatedWiring(simulation: GoogleDriveSimulation): DriveWiring {
  return {
    canRequestWriteAccess: false,
    connection: new GoogleDriveSimulatedConnection({
      client: new GoogleDriveApiClient(SIMULATED_APPLICATION, {
        fetcher: simulation.fetch,
      }),
      grantedScopes: simulation.grantedScopes(),
    }),
    fetcher: simulation.fetch,
    isSimulation: true,
  };
}

/**
 * Creates the Google Drive connection of the instance.
 *
 * @param database - Central database access.
 * @param instanceKey - The key the instance encrypts its connection secrets with.
 * @param account - The shared administration service resolving current account facts.
 * @returns The connection service, which without the OAuth client of the
 * instance only names the settings that are missing, the Storage area and the
 * Storage interface on it.
 *
 * @remarks
 * The OAuth client comes from the environment, like the Discord application,
 * and never leaves this process. With `PAGES_GOOGLE_DRIVE_SIMULATION=1` outside
 * of production, the simulated Drive replaces Google entirely: no OAuth flow,
 * no stored credential and no request to Google.
 */
export function createGoogleDriveServices(
  database: Database,
  instanceKey: Buffer,
  account: StorageAccessDependencies["account"],
): GoogleDriveApplicationServices {
  const simulation = readGoogleDriveSimulation();
  const wiring = simulation
    ? simulatedWiring(new GoogleDriveSimulation(simulation.scenario))
    : realWiring(database, instanceKey);

  const drive = new GoogleDriveItemsClient(wiring.fetcher);
  const storageAccessService = new StorageAccessService({
    repository: new StorageAccessRepository(database),
    account,
    connection: wiring.connection,
    reader: new StorageFileReader(wiring.connection, drive),
  });
  return {
    storageAccessService,
    googleDriveConnectionService: wiring.connection,
    googleDriveFileService: new GoogleDriveFileService({
      canRequestWriteAccess: wiring.canRequestWriteAccess,
      connection: wiring.connection,
      access: storageAccessService,
      drive,
      isSimulation: wiring.isSimulation,
    }),
    googleDriveStorageService: new GoogleDriveStorageService({
      connection: wiring.connection,
      files: new GoogleDriveFilesClient(wiring.fetcher),
      isSimulation: wiring.isSimulation,
      startFolders: new StorageStartFolderRepository(database),
    }),
  };
}
