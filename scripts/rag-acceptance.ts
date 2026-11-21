/**
 * The RAG acceptance, `pnpm run rag:acceptance`: builds a fresh Pages
 * database with synthetic data on a disposable PostgreSQL instance, indexes
 * it, compares the keyword search with the hybrid search on a fixed German
 * and English question set and checks access separation, withdrawn rights,
 * archiving, changed sources, upload and download, the keyword fallback and
 * backup and restore. See `docs/RagAcceptance.md`.
 */
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { pagesTempDirectory } from "../backend/config/PagesTempDirectory";
import {
  DEFAULT_LOCAL_MODEL_ID,
  DeterministicEmbeddingModel,
  LocalEmbeddingModel,
} from "../backend/service/search/EmbeddingModels";

import {
  AcceptanceContext,
  loadSyntheticData,
} from "./rag-acceptance/acceptance-context";
import { writeReport } from "./rag-acceptance/acceptance-report";
import {
  checkAccessSeparation,
  checkFallback,
  checkUploadDownload,
} from "./rag-acceptance/access-checks";
import { checkBackupRestore } from "./rag-acceptance/backup-check";
import {
  checkArchiving,
  checkRevocation,
  checkSourceChanges,
} from "./rag-acceptance/change-checks";
import { CheckLog } from "./rag-acceptance/check-support";
import { measureMode } from "./rag-acceptance/search-measurement";
import { TestInstance } from "./rag-acceptance/test-instance";

import type { Database } from "../backend/database/Database";
import type {
  EmbeddingModel,
  EmbeddingModelFactory,
} from "../backend/service/search/EmbeddingModels";
import type { SearchIndexRunReport } from "../backend/service/search/SearchIndexService";
import type { AcceptanceReport } from "./rag-acceptance/acceptance-report";
import type { BackupFigures } from "./rag-acceptance/backup-check";
import type { CheckResult } from "./rag-acceptance/check-support";
import type {
  ModeMeasurement,
  SearchMode,
} from "./rag-acceptance/search-measurement";

const USAGE = `Usage:
  pnpm run rag:acceptance --admin-url-file <file> --model fake [--dimensions 64]
  pnpm run rag:acceptance --admin-url-file <file> --model local --embedding-url http://127.0.0.1:8080
      [--model-id ${DEFAULT_LOCAL_MODEL_ID}] [--model-revision <commit>]
  Options: [--repetitions 5] [--output <directory>] [--keep]
  The file holds the superuser address of a disposable PostgreSQL instance with pgvector on this machine.`;

interface AcceptanceOptions {
  readonly adminUrlFile: string;
  readonly createModel: EmbeddingModelFactory;
  /** A model of another version, whose inventory stays empty. */
  readonly otherVersion: EmbeddingModelFactory;
  readonly repetitions: number;
  readonly output: string | null;
  readonly shouldKeep: boolean;
  readonly modelKind: string;
}

function readCount(text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(USAGE);
  return value;
}

function readModels(
  values: Readonly<Record<string, string | boolean | undefined>>,
): {
  readonly createModel: EmbeddingModelFactory;
  readonly otherVersion: EmbeddingModelFactory;
} {
  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
  };
  if (values.model === "fake") {
    const dimensions = readCount(text("dimensions"), 64);
    const model = new DeterministicEmbeddingModel(dimensions);
    const other = new DeterministicEmbeddingModel(dimensions === 32 ? 48 : 32);
    return { createModel: () => model, otherVersion: () => other };
  }
  const baseUrl = text("embedding-url");
  if (values.model !== "local" || !baseUrl) throw new Error(USAGE);
  const options = {
    baseUrl,
    modelId: text("model-id"),
    revision: text("model-revision"),
  };
  // Like the server, every search builds its own client and pins the served revision.
  const other = new DeterministicEmbeddingModel();
  return {
    createModel: () => new LocalEmbeddingModel(options),
    otherVersion: () => other,
  };
}

function readOptions(): AcceptanceOptions {
  const { values } = parseArgs({
    options: {
      "admin-url-file": { type: "string" },
      model: { type: "string" },
      dimensions: { type: "string" },
      "embedding-url": { type: "string" },
      "model-id": { type: "string" },
      "model-revision": { type: "string" },
      repetitions: { type: "string" },
      output: { type: "string" },
      keep: { type: "boolean" },
    },
  });
  const adminUrlFile = values["admin-url-file"];
  if (!adminUrlFile) throw new Error(USAGE);
  return {
    adminUrlFile,
    ...readModels(values),
    repetitions: readCount(values.repetitions, 5),
    output: values.output ?? null,
    shouldKeep: values.keep === true,
    modelKind: values.model ?? "",
  };
}

function newRunId(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "z")
    .replace("T", "t")
    .toLowerCase();
}

/** Everything the run collects before the report. */
interface RunState {
  readonly indexing: SearchIndexRunReport[];
  readonly measurements: ModeMeasurement[];
  readonly checks: CheckResult[];
  backup: BackupFigures | null;
}

async function runChecks(
  context: AcceptanceContext,
  input: {
    readonly instance: TestInstance;
    readonly options: AcceptanceOptions;
    readonly source: Awaited<ReturnType<TestInstance["createDatabase"]>>;
    readonly runDirectory: string;
    readonly state: RunState;
  },
): Promise<void> {
  const { options, state } = input;
  const indexModel: EmbeddingModel = options.createModel();
  const hybrid = options.createModel;
  const modes: SearchMode[] = [
    { name: "keyword", createModel: null },
    { name: "hybrid", createModel: hybrid },
  ];
  for (const mode of modes)
    state.measurements.push(
      await measureMode(context, mode, options.repetitions),
    );
  const links = new CheckLog("sourceLinks", state.checks);
  for (const measurement of state.measurements)
    links.record(
      `${measurement.mode}: every source link resolves for its reader to the handed-over revision`,
      measurement.links.checked > 0 &&
        measurement.links.valid === measurement.links.checked,
      `${String(measurement.links.valid)}/${String(measurement.links.checked)} valid${measurement.links.problems.length ? `: ${measurement.links.problems.join("; ")}` : ""}`,
    );
  await checkAccessSeparation(context, hybrid, state.checks);
  await checkUploadDownload(
    context,
    path.join(input.runDirectory, "data"),
    state.checks,
  );
  await checkFallback(
    context,
    {
      instance: input.instance,
      database: input.source,
      hybrid,
      otherVersion: options.otherVersion,
      indexModel,
    },
    state.checks,
  );
  await checkSourceChanges(context, { hybrid, indexModel }, state.checks);
  await checkRevocation(context, { hybrid, indexModel }, state.checks);
  state.backup = await checkBackupRestore(
    {
      instance: input.instance,
      source: input.source,
      sourceContext: context,
      runDirectory: input.runDirectory,
      modes,
      indexModel,
    },
    state.checks,
  );
  await checkArchiving(context, hybrid, state.checks);
}

async function prepareSource(
  instance: TestInstance,
  runDirectory: string,
): Promise<{
  readonly database: Database;
  readonly source: Awaited<ReturnType<TestInstance["createDatabase"]>>;
}> {
  const dataDirectory = path.join(runDirectory, "data");
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const source = await instance.createDatabase("source");
  const database = await instance.migrate(source, dataDirectory);
  await instance.setVectorExtension(source, true);
  return { database, source };
}

/**
 * Indexes the synthetic data twice; the second run must find everything unchanged.
 * @param context - Services of the source database.
 * @param model - Model of the inventory.
 * @param state - Collected results of the run.
 */
async function indexTwice(
  context: AcceptanceContext,
  model: EmbeddingModel,
  state: RunState,
): Promise<void> {
  const first = await context.index(model);
  const second = await context.index(model);
  state.indexing.push(first, second);
  new CheckLog("indexing", state.checks).record(
    "A repeated indexing run embeds nothing again; the PNG asset is recorded without sections",
    second.indexedSources === 0 &&
      second.unchangedSources === first.indexedSources &&
      first.skippedAssets === 1,
    `first: ${JSON.stringify(first)}; second: ${JSON.stringify(second)}`,
  );
}

function describeEnvironment(
  options: AcceptanceOptions,
  instance: TestInstance,
): Record<string, string> {
  const [cpu] = os.cpus();
  return {
    node: process.version,
    cpus: `${String(os.cpus().length)} × ${cpu?.model ?? "unknown"}`,
    model: options.modelKind,
    repetitions: String(options.repetitions),
    keptDatabases: options.shouldKeep ? `${instance.role}_*` : "dropped",
  };
}

async function runAcceptance(
  options: AcceptanceOptions,
  runId: string,
  runDirectory: string,
): Promise<AcceptanceReport> {
  const startedAt = new Date().toISOString();
  const state: RunState = {
    indexing: [],
    measurements: [],
    checks: [],
    backup: null,
  };
  const instance = await TestInstance.open(options.adminUrlFile, runId);
  try {
    const { database, source } = await prepareSource(instance, runDirectory);
    try {
      const context = new AcceptanceContext(
        database,
        path.join(runDirectory, "data"),
      );
      await loadSyntheticData(context);
      await indexTwice(context, options.createModel(), state);
      await runChecks(context, {
        instance,
        options,
        source,
        runDirectory,
        state,
      });
    } finally {
      await database.close();
    }
  } finally {
    if (!options.shouldKeep) await instance.close();
  }
  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: describeEnvironment(options, instance),
    modelVersion: state.indexing[0]?.modelVersion ?? "",
    indexing: state.indexing,
    measurements: state.measurements,
    checks: state.checks,
    backup: state.backup,
    isPassed:
      state.checks.length > 0 && state.checks.every((check) => check.isPassed),
  };
}

async function main(): Promise<void> {
  const options = readOptions();
  const runId = newRunId();
  const runDirectory =
    options.output ?? pagesTempDirectory("rag-acceptance", runId);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const report = await runAcceptance(options, runId, runDirectory);
  const written = await writeReport(runDirectory, report);
  for (const measurement of report.measurements)
    console.info(
      JSON.stringify({
        mode: measurement.mode,
        top5: measurement.top5,
        p95Milliseconds: measurement.latency.p95,
        latencySamples: measurement.latency.samples,
        validLinks: `${String(measurement.links.valid)}/${String(measurement.links.checked)}`,
      }),
    );
  for (const check of report.checks.filter((entry) => !entry.isPassed))
    console.error(
      JSON.stringify({ failed: check.name, observed: check.observed }),
    );
  console.info(
    JSON.stringify({
      isPassed: report.isPassed,
      checks: report.checks.length,
      report: written.markdown,
    }),
  );
  process.exitCode = report.isPassed ? 0 : 1;
}

await main().catch((error: unknown) => {
  // Driver errors never carry the connection address; only the message is shown.
  console.error(
    error instanceof Error ? error.message : "The RAG acceptance failed.",
  );
  process.exitCode = 1;
});
