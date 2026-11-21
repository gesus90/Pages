import { createHash } from "node:crypto";
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Database } from "../../backend/database/Database";
import { readMigrations } from "../read-database-migrations";

import { AcceptanceContext } from "./acceptance-context";
import { ASSETS, PERSONS } from "./acceptance-data";
import { CheckLog, describeResult, hasSource } from "./check-support";
import { fingerprintAnswers } from "./search-measurement";

import type { EmbeddingModel } from "../../backend/service/search/EmbeddingModels";
import type { CheckResult } from "./check-support";
import type { SearchMode } from "./search-measurement";
import type { AcceptanceDatabase, TestInstance } from "./test-instance";

/** Tables whose rows a restore must keep exactly. */
const COMPARED_TABLES = [
  "work_items",
  "wiki_pages",
  "work_item_attachments",
  "ticket_asset_search_releases",
  "ticket_asset_changes",
  "department_members",
  "search_embeddings",
  "search_index_sources",
] as const;

/** What the backup check works on. */
export interface BackupSetup {
  readonly instance: TestInstance;
  readonly source: AcceptanceDatabase;
  readonly sourceContext: AcceptanceContext;
  readonly runDirectory: string;
  readonly modes: readonly SearchMode[];
  readonly indexModel: EmbeddingModel;
}

/** Sizes and durations of the backup, for the report. */
export interface BackupFigures {
  readonly dumpBytes: number;
  readonly dumpMilliseconds: number;
  readonly restoreMilliseconds: number;
}

/** Row count and checksum over all rows of every compared table. */
async function tableFingerprints(database: Database): Promise<string[]> {
  const lines: string[] = [];
  for (const table of COMPARED_TABLES) {
    const rows = await database.query(
      `SELECT count(*), md5(coalesce(string_agg(row_text, '|' ORDER BY row_text), '')) FROM (SELECT t::TEXT AS row_text FROM ${table} AS t) AS table_rows;`,
    );
    lines.push(`${table} ${String(rows[0]?.[0])} ${String(rows[0]?.[1])}`);
  }
  return lines;
}

function differences(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return left.filter((line, index) => line !== right[index]);
}

async function answersOf(
  context: AcceptanceContext,
  modes: readonly SearchMode[],
): Promise<string[]> {
  const lines: string[] = [];
  for (const mode of modes)
    lines.push(
      ...(await fingerprintAnswers(context, mode)).map(
        (line) => `${mode.name} ${line}`,
      ),
    );
  return lines;
}

async function checkRestoredAssets(
  context: AcceptanceContext,
): Promise<string[]> {
  const problems: string[] = [];
  for (const asset of ASSETS) {
    const id = await context.assetId(asset.fileName);
    if (id === null) continue;
    const bytes = await context.download(asset.uploadedBy, id);
    const expected = createHash("sha256").update(asset.bytes).digest("hex");
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      problems.push(asset.fileName);
  }
  return problems;
}

/**
 * Dumps the source database, restores it into a new database with the asset
 * files as the documented restore does, and compares rows, answers and files.
 * @param setup - Instance, source database and search modes.
 * @param results - Shared result list.
 * @returns Size and durations of dump and restore.
 */
export async function checkBackupRestore(
  setup: BackupSetup,
  results: CheckResult[],
): Promise<BackupFigures> {
  const log = new CheckLog("backupRestore", results);
  const backupDirectory = path.join(setup.runDirectory, "backup");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const dumpFile = path.join(backupDirectory, "pages.dump");
  const sourceTables = await tableFingerprints(setup.sourceContext.db);
  const sourceAnswers = await answersOf(setup.sourceContext, setup.modes);
  const dumpStarted = performance.now();
  await setup.instance.dump(setup.source, dumpFile);
  const dumpMilliseconds = performance.now() - dumpStarted;
  const restoredData = path.join(setup.runDirectory, "restored-data");
  await cp(path.join(setup.runDirectory, "data"), restoredData, {
    recursive: true,
  });
  const restoreStarted = performance.now();
  const target = await setup.instance.createDatabase("restored");
  await setup.instance.restore(
    dumpFile,
    target,
    path.join(backupDirectory, "pages.list"),
  );
  await setup.instance.setVectorExtension(target, true);
  const restoreMilliseconds = performance.now() - restoreStarted;
  const restored = await Database.connect(target.url, restoredData);
  try {
    await restored.migrate(await readMigrations("postgres/migrations"));
    log.record(
      "All migrations verify on the restored database",
      true,
      "no migration applied or changed",
    );
    const context = new AcceptanceContext(restored, restoredData);
    const tableDifferences = differences(
      sourceTables,
      await tableFingerprints(restored),
    );
    log.record(
      "Every compared table has the same rows (count and MD5) after the restore",
      tableDifferences.length === 0,
      tableDifferences.length === 0
        ? sourceTables.join("; ")
        : tableDifferences.join("; "),
    );
    const answerDifferences = differences(
      sourceAnswers,
      await answersOf(context, setup.modes),
    );
    log.record(
      "Every question of the set returns the same sections in both modes after the restore",
      answerDifferences.length === 0,
      `${String(sourceAnswers.length)} answers compared, ${String(answerDifferences.length)} differ`,
    );
    const assetProblems = await checkRestoredAssets(context);
    log.record(
      "Every remaining asset downloads with its original SHA-256 from the restored data directory",
      assetProblems.length === 0,
      assetProblems.length === 0 ? "all equal" : assetProblems.join(", "),
    );
    const report = await context.index(setup.indexModel);
    log.record(
      "The indexer finds the restored inventory complete and embeds nothing",
      report.indexedSources === 0 &&
        report.removedSources === 0 &&
        report.writtenSections === 0,
      `${String(report.unchangedSources)} unchanged, ${String(report.indexedSources)} indexed, ${String(report.removedSources)} removed`,
    );
  } finally {
    await restored.close();
  }
  await checkPlainRestore(setup, { dumpFile, restoredData, log });
  return {
    dumpBytes: (await stat(dumpFile)).size,
    dumpMilliseconds,
    restoreMilliseconds,
  };
}

async function checkPlainRestore(
  setup: BackupSetup,
  input: {
    readonly dumpFile: string;
    readonly restoredData: string;
    readonly log: CheckLog;
  },
): Promise<void> {
  const target = await setup.instance.createDatabase("plain");
  await setup.instance.restore(
    input.dumpFile,
    target,
    path.join(setup.runDirectory, "backup", "pages-plain.list"),
  );
  const plain = await Database.connect(target.url, input.restoredData);
  try {
    const context = new AcceptanceContext(plain, input.restoredData);
    const hybrid =
      setup.modes.find((mode) => mode.name === "hybrid")?.createModel ?? null;
    const result = await context.search(hybrid, {
      reader: PERSONS.alice.id,
      question: "session refresh 401 password change",
      limit: 5,
    });
    const rows = await plain.query("SELECT count(*) FROM search_embeddings;");
    input.log.record(
      "A restore without pgvector keeps every vector row; the search falls back to the keyword search",
      result.vectorSearch.status === "unavailable" &&
        result.vectorSearch.reason === "vectorSearchUnavailable" &&
        hasSource(result, "ticket", "RAG-1") &&
        Number(rows[0]?.[0]) > 0,
      `${String(rows[0]?.[0])} vector rows; ${describeResult(result)}`,
    );
  } finally {
    await plain.close();
  }
}
