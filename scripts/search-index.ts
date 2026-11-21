import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { ConfigFile } from "../backend/config/ConfigFile";
import { Database } from "../backend/database/Database";
import { SearchEmbeddingRepository } from "../backend/database/repositories/search/SearchEmbeddingRepository";
import { SearchSourceRepository } from "../backend/database/repositories/search/SearchSourceRepository";
import { WorkItemAttachmentRepository } from "../backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemAccessDeniedError } from "../backend/error/WorkItemErrors";
import {
  DEFAULT_LOCAL_MODEL_ID,
  DeterministicEmbeddingModel,
  LocalEmbeddingModel,
} from "../backend/service/search/EmbeddingModels";
import { SearchIndexService } from "../backend/service/search/SearchIndexService";
import { TaskAttachmentService } from "../backend/service/task/TaskAttachmentService";
import { TicketFileStore } from "../backend/storage/TicketFileStore";

import type { EmbeddingModel } from "../backend/service/search/EmbeddingModels";
import type {
  TicketAccess,
  UploadLimitSource,
} from "../backend/service/task/TaskAttachmentService";

const USAGE = `Usage:
  pnpm run search:index /absolute/config.toml --model fake [--dimensions 64] [--interval <seconds>]
  pnpm run search:index /absolute/config.toml --model local --embedding-url http://127.0.0.1:8080
      [--model-id ${DEFAULT_LOCAL_MODEL_ID}] [--model-revision <commit>] [--interval <seconds>]
  Add --remove-model <model-version> to remove the inventory of an old model version.`;

/** The indexer acts for no person; every person-bound ticket read refuses. */
const NO_PERSON: TicketAccess = {
  getById: async () => Promise.reject(new WorkItemAccessDeniedError()),
  actionPermissions: async () =>
    Promise.reject(new WorkItemAccessDeniedError()),
};

/** The indexer only reads assets and never uploads. */
const NO_UPLOADS: UploadLimitSource = {
  getSettings: async () =>
    Promise.reject(new Error("The search indexer uploads nothing.")),
};

interface IndexerOptions {
  readonly configPath: string;
  readonly model: EmbeddingModel;
  /** Seconds between runs; `null` runs once. */
  readonly intervalSeconds: number | null;
  readonly removeModel: string | null;
}

function readPositiveInteger(
  text: string | undefined,
  name: string,
): number | null {
  if (text === undefined) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`--${name} needs a positive whole number.\n${USAGE}`);
  return value;
}

function createModel(
  values: Readonly<Record<string, string | undefined>>,
): EmbeddingModel {
  if (values.model === "fake")
    return new DeterministicEmbeddingModel(
      readPositiveInteger(values.dimensions, "dimensions") ?? undefined,
    );
  if (values.model === "local" && values["embedding-url"])
    return new LocalEmbeddingModel({
      baseUrl: values["embedding-url"],
      modelId: values["model-id"],
      revision: values["model-revision"],
    });
  throw new Error(USAGE);
}

function readOptions(): IndexerOptions {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      dimensions: { type: "string" },
      "embedding-url": { type: "string" },
      "model-id": { type: "string" },
      "model-revision": { type: "string" },
      interval: { type: "string" },
      "remove-model": { type: "string" },
    },
  });
  const [configPath, ...rest] = positionals;
  if (!configPath || !path.isAbsolute(configPath) || rest.length > 0)
    throw new Error(USAGE);
  return {
    configPath,
    model: createModel(values),
    intervalSeconds: readPositiveInteger(values.interval, "interval"),
    removeModel: values["remove-model"] ?? null,
  };
}

async function runIndexer(
  service: SearchIndexService,
  options: IndexerOptions,
): Promise<void> {
  if (options.removeModel !== null) {
    await service.removeModelInventory(options.removeModel);
    console.info(JSON.stringify({ removedModelVersion: options.removeModel }));
    return;
  }
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  do {
    console.info(JSON.stringify(await service.runOnce()));
    if (options.intervalSeconds === null) return;
    await sleep(options.intervalSeconds * 1000, undefined, {
      signal: stop.signal,
    }).catch(() => undefined);
  } while (!stop.signal.aborted);
}

/**
 * Local search indexer: embeds tickets, wiki pages and released text assets
 * of the configured Pages database with a fake or a model on this machine.
 */
async function main(): Promise<void> {
  const options = readOptions();
  const config = await new ConfigFile(options.configPath).read();
  if (!config || config.firstRun || !config.databaseUrl)
    throw new Error("A completed PostgreSQL configuration is required.");
  const database = await Database.connect(config.databaseUrl);
  try {
    const assets = new TaskAttachmentService(
      new WorkItemAttachmentRepository(database),
      NO_PERSON,
      NO_UPLOADS,
      new TicketFileStore(path.dirname(config.databasePath)),
    );
    const service = new SearchIndexService({
      embeddings: new SearchEmbeddingRepository(database),
      sources: new SearchSourceRepository(database),
      assets,
      model: options.model,
    });
    await runIndexer(service, options);
  } finally {
    await database.close();
  }
}

await main().catch((error: unknown) => {
  // Driver errors never carry the connection address; only the message is shown.
  console.error(
    error instanceof Error ? error.message : "The search indexer failed.",
  );
  process.exitCode = 1;
});
