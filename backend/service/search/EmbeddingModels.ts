import { createHash } from "node:crypto";

import { logEvent } from "@/backend/logging/Logger";

/** Model the local server is expected to run for German and English text. */
export const DEFAULT_LOCAL_MODEL_ID = "BAAI/bge-m3";

/** Host names that reach only this machine; no text leaves it. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Most texts sent to the local server in one request. */
const LOCAL_BATCH_SIZE = 16;

/** How long one request to the local server may take. */
const LOCAL_TIMEOUT_MILLISECONDS = 120_000;

/** Dimensions of the deterministic fake unless a caller asks for others. */
const DEFAULT_FAKE_DIMENSIONS = 64;

/**
 * Turns texts into embedding vectors with one fixed model revision.
 * @remarks
 * Sources and search questions must be embedded by the same model version,
 * which is stored with every vector; a different version is a separate
 * inventory that is indexed anew.
 */
export interface EmbeddingModel {
  /**
   * Returns the model and its revision, such as `BAAI/bge-m3@<commit>`.
   * @throws When the revision cannot be determined.
   */
  resolveVersion(): Promise<string>;
  /**
   * Embeds texts in their order.
   * @throws {EmbeddingModelChangedError} When the model revision changed
   * since {@link EmbeddingModel.resolveVersion}.
   */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** Raised when the serving model is not the revision a run started with. */
export class EmbeddingModelChangedError extends Error {
  public constructor(expected: string, actual: string) {
    super(
      `The embedding model changed from ${expected} to ${actual}; start the run again.`,
    );
    this.name = "EmbeddingModelChangedError";
  }
}

/** What the local embedding server reports about its model. */
interface LocalModelInfo {
  readonly modelId: string;
  readonly revision: string | null;
}

/** Options of the local embedding server. */
export interface LocalEmbeddingModelOptions {
  /** Address of a Text Embeddings Inference server on this machine. */
  readonly baseUrl: string;
  /** Model the server must run; defaults to `BAAI/bge-m3`. */
  readonly modelId?: string;
  /**
   * Revision the server must run. Required when the server loaded the model
   * from a local folder and reports no revision itself.
   */
  readonly revision?: string;
}

function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return vector.map((component) => component / length);
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Embeds texts deterministically from their words, without any model.
 * @remarks
 * Each word adds a fixed signed unit to one component chosen by its SHA-256,
 * so equal texts get equal vectors and texts sharing words point in similar
 * directions. It serves sample data and checks of the indexing flow; it
 * understands no meaning.
 */
export class DeterministicEmbeddingModel implements EmbeddingModel {
  private readonly dimensions: number;

  /**
   * Creates the fake model.
   * @param dimensions - Number of vector components, at least 2.
   */
  public constructor(dimensions: number = DEFAULT_FAKE_DIMENSIONS) {
    if (!Number.isSafeInteger(dimensions) || dimensions < 2)
      throw new RangeError("The fake embedding needs at least 2 dimensions.");
    this.dimensions = dimensions;
  }

  /**
   * Names the fake and its dimensions; changing the algorithm changes the name.
   * @returns The model version.
   */
  public async resolveVersion(): Promise<string> {
    return Promise.resolve(
      `pages/deterministic-word-hash@1-d${String(this.dimensions)}`,
    );
  }

  /**
   * Embeds the texts from their words.
   * @param texts - Texts to embed.
   * @returns One unit vector per text.
   */
  public async embed(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedText(text)));
  }

  private embedText(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of tokensOf(text)) {
      const digest = createHash("sha256").update(token, "utf8").digest();
      const index = digest.readUInt32BE(0) % this.dimensions;
      vector[index] = (vector[index] ?? 0) + ((digest[4] ?? 0) % 2 ? -1 : 1);
    }
    // A text without words, or whose words cancel out, still needs a direction.
    if (!vector.some((component) => component !== 0)) vector[0] = 1;
    return normalize(vector);
  }
}

function readModelInfo(body: unknown): LocalModelInfo {
  if (typeof body !== "object" || body === null || !("model_id" in body))
    throw new Error("The embedding server answered /info without model_id.");
  const modelId = body.model_id;
  const revision = "model_sha" in body ? body.model_sha : null;
  if (typeof modelId !== "string")
    throw new Error("The embedding server reported an invalid model_id.");
  return {
    modelId,
    revision: typeof revision === "string" && revision ? revision : null,
  };
}

function isVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((component: unknown) => typeof component === "number")
  );
}

function readVectors(body: unknown, count: number): number[][] {
  if (!Array.isArray(body) || body.length !== count)
    throw new Error(
      "The embedding server returned the wrong number of vectors.",
    );
  const vectors: unknown[] = body;
  return vectors.map((vector) => {
    if (!isVector(vector))
      throw new Error("The embedding server returned an invalid vector.");
    return vector;
  });
}

function requireLoopbackUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("The embedding server needs an http or https address.");
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new Error(
      "The embedding server must run on this machine (127.0.0.1, ::1 or localhost).",
    );
  return url;
}

/**
 * Embeds texts with a model served on this machine by Hugging Face Text
 * Embeddings Inference, first of all `BAAI/bge-m3` for German and English.
 * @remarks
 * The version combines the model identifier and the revision the server
 * reports at `/info`. Every batch reads `/info` again, so a model exchanged
 * during a run stops it instead of mixing two revisions in one inventory.
 * bge-m3 embeds questions and passages alike, so no prefix is added.
 */
export class LocalEmbeddingModel implements EmbeddingModel {
  private readonly baseUrl: URL;
  private readonly modelId: string;
  private readonly revision: string | null;
  private pinnedVersion: string | null = null;

  /**
   * Creates the client of the local server.
   * @param options - Address, expected model and optional expected revision.
   * @throws When the address does not point to this machine.
   */
  public constructor(options: LocalEmbeddingModelOptions) {
    this.baseUrl = requireLoopbackUrl(options.baseUrl);
    this.modelId = options.modelId ?? DEFAULT_LOCAL_MODEL_ID;
    this.revision = options.revision ?? null;
  }

  /**
   * Reads the served model and pins its version for this client.
   * @returns `<model>@<revision>`.
   * @throws When the server runs another model or revision or reports none.
   */
  public async resolveVersion(): Promise<string> {
    const version = await this.readServedVersion();
    this.pinnedVersion ??= version;
    if (version !== this.pinnedVersion)
      throw new EmbeddingModelChangedError(this.pinnedVersion, version);
    return version;
  }

  /**
   * Embeds texts in batches as normalized vectors.
   * @param texts - Texts to embed.
   * @returns One vector per text.
   * @throws {EmbeddingModelChangedError} When the served revision changed.
   */
  public async embed(texts: readonly string[]): Promise<number[][]> {
    const pinned = this.pinnedVersion ?? (await this.resolveVersion());
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += LOCAL_BATCH_SIZE) {
      const batch = texts.slice(start, start + LOCAL_BATCH_SIZE);
      const body = await this.request("/embed", {
        inputs: batch,
        normalize: true,
        truncate: true,
      });
      vectors.push(...readVectors(body, batch.length));
      const served = await this.readServedVersion();
      if (served !== pinned)
        throw new EmbeddingModelChangedError(pinned, served);
    }
    return vectors;
  }

  private async readServedVersion(): Promise<string> {
    const info = readModelInfo(await this.request("/info", null));
    if (info.modelId !== this.modelId)
      throw new Error(
        `The embedding server runs ${info.modelId} instead of ${this.modelId}.`,
      );
    if (this.revision && info.revision && info.revision !== this.revision)
      throw new Error(
        `The embedding server runs revision ${info.revision} instead of ${this.revision}.`,
      );
    const revision = info.revision ?? this.revision;
    if (!revision)
      throw new Error(
        "The embedding server reports no model revision; pass the revision explicitly.",
      );
    return `${info.modelId}@${revision}`;
  }

  private async request(path: string, payload: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: payload === null ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: payload === null ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok)
      throw new Error(
        `The embedding server answered ${path} with status ${String(response.status)}.`,
      );
    const body: unknown = await response.json();
    return body;
  }
}

/** Builds a fresh model for every search, so each search pins the revision served at that moment. */
export type EmbeddingModelFactory = () => EmbeddingModel;

/** An environment variable that is set but empty counts as not set. */
function nonEmpty(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readDimensions(text: string | undefined): number | undefined {
  if (text === undefined || text === "") return undefined;
  const dimensions = Number(text);
  if (!Number.isSafeInteger(dimensions))
    throw new Error("PAGES_SEARCH_EMBEDDING_DIMENSIONS needs a whole number.");
  return dimensions;
}

/**
 * Chooses the model the server embeds search questions with.
 * @param environment - Environment of the server process.
 * @returns A factory, or `null` when `PAGES_SEARCH_EMBEDDING` is not set and
 * the search keeps to the keyword search.
 * @throws When the variables name an unknown model, an address off this
 * machine or invalid dimensions.
 * @remarks
 * `PAGES_SEARCH_EMBEDDING=local` uses the server at
 * `PAGES_SEARCH_EMBEDDING_URL` with the optional
 * `PAGES_SEARCH_EMBEDDING_MODEL_ID` and `PAGES_SEARCH_EMBEDDING_REVISION`, the
 * options of the indexer. `PAGES_SEARCH_EMBEDDING=fake` uses the deterministic
 * fake with `PAGES_SEARCH_EMBEDDING_DIMENSIONS`, for sample data only. The
 * questions must be embedded with the model and revision the indexer used.
 */
export function createEmbeddingModelFactory(
  environment: Readonly<Record<string, string | undefined>>,
): EmbeddingModelFactory | null {
  const kind = environment.PAGES_SEARCH_EMBEDDING?.trim();
  if (!kind) return null;
  if (kind === "fake") {
    const model = new DeterministicEmbeddingModel(
      readDimensions(environment.PAGES_SEARCH_EMBEDDING_DIMENSIONS),
    );
    return () => model;
  }
  if (kind !== "local")
    throw new Error("PAGES_SEARCH_EMBEDDING must be local or fake.");
  const options: LocalEmbeddingModelOptions = {
    baseUrl: environment.PAGES_SEARCH_EMBEDDING_URL ?? "",
    modelId: nonEmpty(environment.PAGES_SEARCH_EMBEDDING_MODEL_ID),
    revision: nonEmpty(environment.PAGES_SEARCH_EMBEDDING_REVISION),
  };
  if (!options.baseUrl)
    throw new Error(
      "PAGES_SEARCH_EMBEDDING=local needs PAGES_SEARCH_EMBEDDING_URL.",
    );
  // Checks the address once at start; every search then gets its own client.
  requireLoopbackUrl(options.baseUrl);
  return () => new LocalEmbeddingModel(options);
}

/**
 * Chooses the model the server embeds search questions with, from its environment.
 * @returns The configured model, or `null` without one or with an invalid
 * configuration, which is logged; the search then keeps to the keyword search.
 */
export function readSearchEmbeddingModel(): EmbeddingModelFactory | null {
  try {
    return createEmbeddingModelFactory(process.env);
  } catch (error: unknown) {
    logEvent({
      level: "warn",
      event: "search.embedding_configuration_invalid",
      component: "EmbeddingModels",
      message:
        "The search embedding model is not usable; the keyword search answers alone",
      error,
    });
    return null;
  }
}
