import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { AgentOperationError } from "../../backend/error/AgentOperationError";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "../../backend/error/WorkItemErrors";
import { LocalEmbeddingModel } from "../../backend/service/search/EmbeddingModels";

import { ASSETS, PERSONS, PROJECTS, TICKETS } from "./acceptance-data";
import { CheckLog, describeResult, hasSource } from "./check-support";

import type {
  EmbeddingModel,
  EmbeddingModelFactory,
} from "../../backend/service/search/EmbeddingModels";
import type { AgentSourceSearch } from "../../definition/AgentSourceSearch";
import type { AcceptanceContext } from "./acceptance-context";
import type { CheckResult } from "./check-support";
import type { TestInstance, AcceptanceDatabase } from "./test-instance";

const ALICE = PERSONS.alice.id;
const BOB = PERSONS.bob.id;
const CARLA = PERSONS.carla.id;

/** A literal question the keyword search answers alone. */
const LITERAL_QUESTION = "session refresh 401 password change";

function ticketId(key: string): string {
  const ticket = TICKETS.find((entry) => entry.key === key);
  if (!ticket) throw new Error(`Unknown ticket ${key}.`);
  return ticket.id;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Checks that persons see only the sources of their departments and projects, in both search parts.
 * @param context - Services of the indexed database.
 * @param hybrid - Model of the hybrid search.
 * @param results - Shared result list.
 */
export async function checkAccessSeparation(
  context: AcceptanceContext,
  hybrid: EmbeddingModelFactory,
  results: CheckResult[],
): Promise<void> {
  const log = new CheckLog("accessSeparation", results);
  const bob = await context.search(hybrid, {
    reader: BOB,
    question: LITERAL_QUESTION,
    limit: 10,
  });
  log.record(
    "Bob (Vertrieb) gets no section of the project Plattform, but his own similar ticket VK-3",
    bob.vectorSearch.status === "used" &&
      bob.sections.every(
        (section) => section.projectId !== PROJECTS.platform.id,
      ) &&
      hasSource(bob, "ticket", "VK-3"),
    describeResult(bob),
  );
  const keyQuestion = "Was steht in RAG-1 und refresh-trace.log?";
  const bobKey = await context.search(hybrid, {
    reader: BOB,
    question: keyQuestion,
    limit: 10,
  });
  log.record(
    "Bob gets neither RAG-1 by its ticket number nor its released asset",
    !hasSource(bobKey, "ticket", "RAG-1") &&
      !hasSource(bobKey, "ticket_asset", "refresh-trace.log"),
    describeResult(bobKey),
  );
  const rotation = "How often are the signing keys of session tokens rotated?";
  const alice = await context.search(hybrid, {
    reader: ALICE,
    question: rotation,
    limit: 10,
  });
  const carla = await context.search(hybrid, {
    reader: CARLA,
    question: rotation,
    limit: 10,
  });
  const carlaKey = await context.search(hybrid, {
    reader: CARLA,
    question: "RAG-3",
    limit: 10,
  });
  log.record(
    "Alice (Sicherheit) finds RAG-3 of the department Sicherheit; Carla of the same project does not, also not by its number",
    hasSource(alice, "ticket", "RAG-3") &&
      !hasSource(carla, "ticket", "RAG-3") &&
      !hasSource(carlaKey, "ticket", "RAG-3"),
    `alice: ${describeResult(alice)}; carla: ${describeResult(carla)}; carla by key: ${describeResult(carlaKey)}`,
  );
  await log.expectFailure(
    "Bob limiting the search to the project Plattform gets NOT_FOUND",
    async () =>
      context.search(hybrid, {
        reader: BOB,
        question: LITERAL_QUESTION,
        projectId: PROJECTS.platform.id,
      }),
    (error) =>
      error instanceof AgentOperationError && error.code === "NOT_FOUND",
  );
  const limited = await context.search(hybrid, {
    reader: ALICE,
    question: LITERAL_QUESTION,
    projectId: PROJECTS.platform.id,
    limit: 10,
  });
  log.record(
    "The project limit leaves out instance pages and other projects",
    limited.sections.length > 0 &&
      limited.sections.every(
        (section) => section.projectId === PROJECTS.platform.id,
      ),
    describeResult(limited),
  );
  const unreleased = await context.search(hybrid, {
    reader: ALICE,
    question: "geheime Ausnahme vom Grenzwert Marketing-Team",
    limit: 10,
  });
  log.record(
    "An asset that was never released for the search is never handed over",
    !hasSource(unreleased, "ticket_asset", "upload-ausnahmen.txt"),
    describeResult(unreleased),
  );
}

async function countFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).length;
}

async function attachmentCount(context: AcceptanceContext): Promise<number> {
  const rows = await context.db.query(
    "SELECT count(*) FROM work_item_attachments;",
  );
  return Number(rows[0]?.[0] ?? -1);
}

async function storedChecksum(
  context: AcceptanceContext,
  id: string,
): Promise<string | null> {
  const rows = await context.db.query(
    "SELECT checksum FROM work_item_attachments WHERE id = $id;",
    { id },
  );
  const checksum = rows[0]?.[0];
  return typeof checksum === "string" ? checksum : null;
}

/**
 * Checks upload and download through the attachment service with the rights of each person.
 * @param context - Services of the database.
 * @param dataDirectory - Data directory with the asset files.
 * @param results - Shared result list.
 */
export async function checkUploadDownload(
  context: AcceptanceContext,
  dataDirectory: string,
  results: CheckResult[],
): Promise<void> {
  const log = new CheckLog("uploadDownload", results);
  for (const asset of ASSETS) {
    const id = await context.assetId(asset.fileName);
    const bytes =
      id === null
        ? Buffer.alloc(0)
        : await context.download(asset.uploadedBy, id);
    const stored = id === null ? null : await storedChecksum(context, id);
    log.record(
      `${asset.fileName}: the download equals the uploaded bytes and the stored SHA-256`,
      sha256(bytes) === sha256(asset.bytes) && stored === sha256(asset.bytes),
      `${String(bytes.length)} bytes, sha256 ${sha256(bytes).slice(0, 12)}…`,
    );
  }
  const traceId = (await context.assetId("refresh-trace.log")) ?? "";
  const carlaBytes = await context.download(CARLA, traceId);
  log.record(
    "Carla (read only, Entwicklung) downloads the asset of RAG-1",
    carlaBytes.length > 0,
    `${String(carlaBytes.length)} bytes`,
  );
  await log.expectFailure(
    "Bob (Vertrieb) cannot download the asset of RAG-1",
    async () => context.download(BOB, traceId),
    (error) => error instanceof WorkItemNotFoundError,
  );
  const rowsBefore = await attachmentCount(context);
  const filesBefore = await countFiles(path.join(dataDirectory, "assets"));
  const upload = {
    fileName: "notiz.txt",
    bytes: Buffer.from("Notiz\n", "utf8"),
  };
  await log.expectFailure(
    "Carla (read only) cannot upload to RAG-1",
    async () => context.upload(CARLA, ticketId("RAG-1"), upload),
    (error) => error instanceof WorkItemAccessDeniedError,
  );
  await log.expectFailure(
    "Bob cannot upload to RAG-1 of another project",
    async () => context.upload(BOB, ticketId("RAG-1"), upload),
    (error) => error instanceof WorkItemNotFoundError,
  );
  await log.expectFailure(
    "An upload that ends before the announced length is refused",
    async () =>
      context.upload(ALICE, ticketId("RAG-1"), {
        ...upload,
        contentLength: upload.bytes.length + 10,
      }),
    (error) =>
      error instanceof WorkItemValidationError &&
      error.code === "attachmentUploadIncomplete",
  );
  const rowsAfter = await attachmentCount(context);
  const filesAfter = await countFiles(path.join(dataDirectory, "assets"));
  log.record(
    "Refused uploads leave neither an attachment row nor a file",
    rowsAfter === rowsBefore && filesAfter === filesBefore,
    `rows ${String(rowsBefore)} → ${String(rowsAfter)}, files ${String(filesBefore)} → ${String(filesAfter)}`,
  );
}

/** Delays every embedding beyond the 5-second limit of the search. */
function slowModel(model: EmbeddingModel): EmbeddingModel {
  return {
    resolveVersion: async () => model.resolveVersion(),
    embed: async (texts) => {
      await sleep(5500);
      return model.embed(texts);
    },
  };
}

/** What the fallback checks need besides the search. */
export interface FallbackSetup {
  readonly instance: TestInstance;
  readonly database: AcceptanceDatabase;
  readonly hybrid: EmbeddingModelFactory;
  /** A model of another version than the inventory, so no stored vector matches. */
  readonly otherVersion: EmbeddingModelFactory;
  readonly indexModel: EmbeddingModel;
}

/**
 * Checks that missing, unusable or outdated embeddings leave the keyword search answering.
 * @param context - Services of the indexed database.
 * @param setup - Instance, models and indexer model.
 * @param results - Shared result list.
 */
export async function checkFallback(
  context: AcceptanceContext,
  setup: FallbackSetup,
  results: CheckResult[],
): Promise<void> {
  const log = new CheckLog("fallback", results);
  const ask = async (
    createModel: EmbeddingModelFactory | null,
  ): Promise<AgentSourceSearch> =>
    context.search(createModel, {
      reader: ALICE,
      question: LITERAL_QUESTION,
      limit: 5,
    });
  const closedPort = new LocalEmbeddingModel({
    baseUrl: "http://127.0.0.1:9",
    revision: "none",
  });
  const cases: readonly [string, EmbeddingModelFactory | null, string][] = [
    ["no model configured", null, "notConfigured"],
    ["embedding server unreachable", () => closedPort, "embeddingFailed"],
    ["model slower than 5 seconds", () => slowModel(setup.hybrid()), "timeout"],
  ];
  for (const [name, createModel, reason] of cases) {
    const result = await ask(createModel);
    log.record(
      `${name}: reason ${reason}, the keyword search still finds RAG-1`,
      result.vectorSearch.status === "unavailable" &&
        result.vectorSearch.reason === reason &&
        hasSource(result, "ticket", "RAG-1"),
      describeResult(result),
    );
  }
  await setup.instance.setVectorExtension(setup.database, false);
  const withoutExtension = await ask(setup.hybrid);
  await setup.instance.setVectorExtension(setup.database, true);
  const reactivated = await ask(setup.hybrid);
  log.record(
    "pgvector dropped: reason vectorSearchUnavailable, keyword search finds RAG-1; reactivated: vector used again without indexing",
    withoutExtension.vectorSearch.status === "unavailable" &&
      withoutExtension.vectorSearch.reason === "vectorSearchUnavailable" &&
      hasSource(withoutExtension, "ticket", "RAG-1") &&
      reactivated.vectorSearch.status === "used" &&
      reactivated.sections.some((section) =>
        section.matchedBy.includes("vector"),
      ),
    `dropped: ${describeResult(withoutExtension)}; reactivated: ${describeResult(reactivated)}`,
  );
  const otherVersion = await ask(setup.otherVersion);
  log.record(
    "No inventory for the model version of the question: no vector hit, the keyword search finds RAG-1",
    otherVersion.sections.every(
      (section) => !section.matchedBy.includes("vector"),
    ) && hasSource(otherVersion, "ticket", "RAG-1"),
    describeResult(otherVersion),
  );
  await checkMissingEmbedding(context, setup, log);
}

async function checkMissingEmbedding(
  context: AcceptanceContext,
  setup: FallbackSetup,
  log: CheckLog,
): Promise<void> {
  const { tasks, actor } = await context.tasks(ALICE);
  const created = await tasks.create(actor, {
    projectId: PROJECTS.platform.id,
    type: "task",
    title: "Feiertagskalender importieren",
    description:
      "Der Feiertagskalender der Bundesländer wird jedes Jahr im Dezember importiert.",
    statusId: "status-todo",
    skipGitHubSync: true,
  });
  const question = "Feiertagskalender importieren";
  const before = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 5,
  });
  const found = before.sections.find(
    (section) => section.sourceId === created.id,
  );
  log.record(
    "A new ticket without embeddings is found by the keyword search alone",
    before.vectorSearch.status === "used" &&
      found !== undefined &&
      !found.matchedBy.includes("vector"),
    `${created.key}: ${found ? found.matchedBy.join("+") : "missing"}; ${describeResult(before)}`,
  );
  const report = await context.index(setup.indexModel);
  const after = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 5,
  });
  const indexed = after.sections.find(
    (section) => section.sourceId === created.id,
  );
  log.record(
    "After the next indexing run the vector search finds it too",
    report.indexedSources === 1 &&
      indexed?.matchedBy.includes("vector") === true,
    `index: ${String(report.indexedSources)} indexed; ${indexed ? indexed.matchedBy.join("+") : "missing"}`,
  );
}
