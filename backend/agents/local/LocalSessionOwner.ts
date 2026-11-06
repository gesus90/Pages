import path from "node:path";
import { rm } from "node:fs/promises";

import { getApplicationServices } from "@/app/lib/services.server";
import { Database } from "@/backend/database/Database";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { initializePagesRuntime } from "@/backend/runtime/PagesRuntime";
import { initializeLogging } from "@/backend/logging/Logger";
import {
  installProcessLogging,
  registerShutdownTask,
  shutdownProcess,
} from "@/backend/runtime/ProcessLifecycle";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";

import { enterLocalSessionOwner } from "./LocalSessionMode";
import { localOwnerManifestSchema } from "./LocalSessionContracts";
import { readLocalRecord, writeLocalRecord } from "./LocalSessionFiles";
import { captureLocalOwner } from "./LocalSessionOwnership";
import { LocalSessionJournal } from "./LocalSessionJournal";
import { LocalOwnerSession } from "./LocalOwnerSession";
import { LocalOwnerHttp } from "./LocalOwnerHttp";

import type { LocalOwnerManifest } from "./LocalSessionContracts";

/** Product entrypoint for an independent native owner; it never starts an HTTP application listener. */
export async function startLocalSessionOwner(
  argumentsList: readonly string[],
): Promise<void> {
  const manifest = await readStartupManifest(argumentsList);
  const { configPath, directory } = manifest;
  enterLocalSessionOwner(directory);
  installProcessLogging();
  await initializeLogging(configPath);
  const runtime = await initializePagesRuntime(configPath);
  await writeLocalRecord(
    path.join(directory, "proof.json"),
    await captureLocalOwner(manifest),
  );
  await rm(path.join(directory, "owner.env"), { force: true });
  const databaseUrl = runtime.getDatabaseUrl();
  if (!databaseUrl) throw new Error("Local owner requires PostgreSQL");
  const database = await Database.connect(
    databaseUrl,
    path.dirname(runtime.getDatabasePath()),
  );
  const services = await getApplicationServices();
  const run = await new AgentPlanRunRepository(database).find(
    manifest.launch.runId,
  );
  if (!run) throw new Error("Local owner run is missing");
  const journal = new LocalSessionJournal(
    directory,
    run.planId,
    requireAgentFiles(database),
  );
  await journal.initialize();
  const owner = new LocalOwnerSession(manifest, journal, {
    database,
    runs: new AgentPlanRunRepository(database),
    preparation: services.agentLocalSessionPreparation,
    execution: services.agentPlanExecution,
  });
  const channel = new LocalOwnerHttp(manifest, owner, journal, () =>
    shutdownProcess(0, "local_owner_released"),
  );
  registerShutdownTask(
    async () => {
      await owner.close();
      await channel.close();
      await database.close();
    },
    { step: "local_native_owner", budgetMs: 35_000 },
  );
  await channel.listen();
  await writeLocalRecord(path.join(directory, "current.json"), manifest.launch);
  await writeLocalRecord(path.join(directory, "ready.json"), {
    instanceId: manifest.launch.instanceId,
  });
  void owner.start().catch((error: unknown) => owner.fail(error));
}

async function readStartupManifest(
  argumentsList: readonly string[],
): Promise<LocalOwnerManifest> {
  if (
    argumentsList.length !== 4 ||
    argumentsList[0] !== "--config" ||
    argumentsList[2] !== "--directory"
  )
    throw new Error("Invalid local owner arguments");
  const configPath = argumentsList[1];
  const directory = argumentsList[3];
  if (
    !configPath ||
    !directory ||
    !path.isAbsolute(configPath) ||
    !path.isAbsolute(directory)
  )
    throw new Error("Invalid local owner path");
  const manifest = localOwnerManifestSchema.parse(
    await readLocalRecord(path.join(directory, "manifest.json")),
  );
  try {
    await readLocalRecord(path.join(directory, "proof.json"));
    throw new Error(
      "A native owner already claimed this session; it cannot be restarted as a new prompt",
    );
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (manifest.directory !== directory || manifest.configPath !== configPath)
    throw new Error("Local owner startup binding mismatch");
  return manifest;
}
