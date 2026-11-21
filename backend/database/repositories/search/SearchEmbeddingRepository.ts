import { postgresErrorCode } from "@/backend/database/postgres/PostgresConnection";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

/** SQLSTATE of an unknown type or function, here `vector` or its `<=>` operator. */
const UNDEFINED_OBJECT_CODES = new Set(["42704", "42883"]);

/** The most dimensions the pgvector type accepts, as checked by the schema. */
const MAX_DIMENSIONS = 16000;

/** Placeholders of the exact search itself, which a visibility query must not reuse. */
const SEARCH_PARAMETER_NAMES = [
  "model_version",
  "dimensions",
  "query_embedding",
  "limit",
] as const;

/** The kinds of sources whose text sections are embedded. */
export type SearchEmbeddingSourceType = "ticket" | "wiki_page" | "ticket_asset";

/** One version of one source, as stored with each of its sections. */
export interface SearchEmbeddingSource {
  readonly sourceType: SearchEmbeddingSourceType;
  /** Immutable identifier of the ticket, wiki page or asset. */
  readonly sourceId: string;
  /** Revision of the source that the section texts were read from. */
  readonly sourceVersion: string;
}

/** Identifies a source independently of its version. */
export interface SearchEmbeddingSourceKey {
  readonly sourceType: SearchEmbeddingSourceType;
  readonly sourceId: string;
}

/** What the indexer stores about one indexed source version. */
export interface IndexedSourceRecord extends SearchEmbeddingSource {
  readonly modelVersion: string;
  /**
   * Identifies the indexed text and the way it was cut into sections; a
   * different fingerprint means the source must be embedded again.
   */
  readonly fingerprint: string;
}

/** A source as the indexer recorded it for one model version. */
export interface IndexedSource extends SearchEmbeddingSource {
  readonly fingerprint: string;
  readonly sectionCount: number;
}

/** One embedded text section of a source. */
export interface SearchEmbeddingSection {
  /** Position of the section in the source, starting at 0. */
  readonly sectionIndex: number;
  readonly sectionText: string;
  readonly embedding: readonly number[];
}

/**
 * A query that returns the `(source_type, source_id)` pairs the reader may see.
 * @remarks
 * Its placeholders must not use the names `model_version`, `dimensions`,
 * `query_embedding` or `limit`.
 */
export interface VisibleSourceQuery {
  readonly sql: string;
  readonly parameters: SqlParameters;
}

/** What an exact similarity search asks for. */
export interface ExactSearchRequest {
  /** Only vectors of this model version are compared. */
  readonly modelVersion: string;
  /** Embedding of the question, made with the same model version. */
  readonly embedding: readonly number[];
  /** Restricts the search to the visible sources before ranking and limit. */
  readonly visibleSources: VisibleSourceQuery;
  readonly limit: number;
}

/** A section found by the exact search. */
export interface SearchEmbeddingHit extends SearchEmbeddingSource {
  readonly sectionIndex: number;
  readonly sectionText: string;
  /** Cosine distance between 0 (same direction) and 2 (opposite). */
  readonly cosineDistance: number;
}

/** Whether the database can run the vector search. */
export interface VectorSupport {
  /** The server offers the pgvector extension. */
  readonly isAvailable: boolean;
  /** The extension is activated in this database. */
  readonly isInstalled: boolean;
  readonly installedVersion: string | null;
}

/** Raised when the vector search runs without an activated pgvector extension. */
export class VectorSearchUnavailableError extends Error {
  public constructor() {
    super(
      "The vector search needs the PostgreSQL extension pgvector, which is not activated in this database.",
    );
    this.name = "VectorSearchUnavailableError";
  }
}

/** Raised when an embedding cannot be stored or compared. */
export class InvalidEmbeddingError extends Error {
  public constructor(reason: string) {
    super(`The embedding is invalid: ${reason}.`);
    this.name = "InvalidEmbeddingError";
  }
}

/**
 * Writes an embedding as a PostgreSQL array literal, the form `REAL[]` reads.
 * @param embedding - Vector components.
 * @returns The literal, such as `{0.1,-0.2}`.
 * @throws {InvalidEmbeddingError} When the vector is empty, too long, holds a
 * value that is not finite as a `REAL`, or has only zeros.
 * @remarks
 * Each component is rounded to single precision first, which is what the
 * column keeps; PostgreSQL would refuse a value too small for it instead.
 */
function toArrayLiteral(embedding: readonly number[]): string {
  if (embedding.length === 0 || embedding.length > MAX_DIMENSIONS)
    throw new InvalidEmbeddingError(
      `it needs 1 to ${String(MAX_DIMENSIONS)} dimensions`,
    );
  const components = embedding.map((component) => Math.fround(component));
  if (!components.every((component) => Number.isFinite(component)))
    throw new InvalidEmbeddingError(
      "every component must be a finite number within the REAL range",
    );
  if (components.every((component) => component === 0))
    throw new InvalidEmbeddingError("a zero vector has no direction");
  return `{${components.map((component) => String(component)).join(",")}}`;
}

function readSourceType(value: string): SearchEmbeddingSourceType {
  if (value === "ticket" || value === "wiki_page" || value === "ticket_asset")
    return value;
  throw new Error(`Database returned an invalid value for "source_type".`);
}

function readDistance(value: DatabaseValue | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value))
    throw new Error(
      `Database returned an invalid value for "cosine_distance".`,
    );
  return value;
}

function readHit(row: readonly DatabaseValue[]): SearchEmbeddingHit {
  return {
    sourceType: readSourceType(readTextColumn(row, 0, "source_type")),
    sourceId: readTextColumn(row, 1, "source_id"),
    sourceVersion: readTextColumn(row, 2, "source_version"),
    sectionIndex: readCountColumn(row, 3, "section_index"),
    sectionText: readTextColumn(row, 4, "section_text"),
    cosineDistance: readDistance(row[5]),
  };
}

/**
 * Binds the search values next to those of the visibility query.
 * @param request - The search request.
 * @param embedding - Question vector as an array literal.
 * @returns The values of every placeholder of the search.
 * @throws When the visibility query uses a name of the search, which would
 * replace one of its values and change which sources are visible.
 */
function createSearchParameters(
  request: ExactSearchRequest,
  embedding: string,
): SqlParameters {
  const visible = request.visibleSources.parameters;
  const reused = SEARCH_PARAMETER_NAMES.filter((name) => name in visible);
  if (reused.length > 0)
    throw new Error(
      `The visibility query reuses search placeholders: ${reused.join(", ")}.`,
    );
  return {
    ...visible,
    model_version: request.modelVersion,
    dimensions: request.embedding.length,
    query_embedding: embedding,
    limit: request.limit,
  };
}

function isMissingVectorType(error: unknown): boolean {
  const code = postgresErrorCode(error);
  return code !== null && UNDEFINED_OBJECT_CODES.has(code);
}

/** The sections of one source version as written in one transaction. */
interface SectionWrite {
  readonly source: SearchEmbeddingSource;
  readonly modelVersion: string;
  readonly sections: readonly SearchEmbeddingSection[];
  /** The vectors of `sections` as array literals, in the same order. */
  readonly literals: readonly string[];
}

/**
 * Replaces the sections of a source for one model version inside a transaction.
 * @param transaction - Open transaction of the caller.
 * @param write - Source, model version, sections and their vector literals.
 */
async function writeSections(
  transaction: DatabaseTransaction,
  write: SectionWrite,
): Promise<void> {
  const { source, modelVersion, sections, literals } = write;
  await transaction.execute(
    `
      DELETE FROM search_embeddings
      WHERE model_version = $model_version
          AND source_type = $source_type
          AND source_id = $source_id;
    `,
    {
      model_version: modelVersion,
      source_type: source.sourceType,
      source_id: source.sourceId,
    },
  );
  for (const [position, section] of sections.entries()) {
    await transaction.execute(
      `
        INSERT INTO search_embeddings (
            source_type,
            source_id,
            source_version,
            section_index,
            section_text,
            model_version,
            dimensions,
            embedding
        )
        VALUES (
            $source_type,
            $source_id,
            $source_version,
            $section_index,
            $section_text,
            $model_version,
            $dimensions,
            $embedding::REAL[]
        );
      `,
      {
        source_type: source.sourceType,
        source_id: source.sourceId,
        source_version: source.sourceVersion,
        section_index: section.sectionIndex,
        section_text: section.sectionText,
        model_version: modelVersion,
        dimensions: section.embedding.length,
        embedding: literals[position] ?? "",
      },
    );
  }
}

/** Owns the embedding vectors of searchable sections and their exact search. */
export class SearchEmbeddingRepository {
  private readonly database: Database;

  /**
   * Creates a search embedding repository.
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Reports whether pgvector is offered by the server and activated here.
   * @returns The availability; an operator activates the extension.
   */
  public async readVectorSupport(): Promise<VectorSupport> {
    const rows = await this.database.query(`
      SELECT
          (SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'vector') AS available_count,
          (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS installed_version;
    `);
    const row = rows[0] ?? [];
    const installedVersion = readNullableTextColumn(
      row,
      1,
      "installed_version",
    );
    return {
      isAvailable: readCountColumn(row, 0, "available_count") > 0,
      isInstalled: installedVersion !== null,
      installedVersion,
    };
  }

  /**
   * Replaces every section of a source for one model version.
   * @param source - The source and the version the sections were read from.
   * @param modelVersion - Model version that made the embeddings.
   * @param sections - All sections of that source version; an empty list
   * removes the source from this model's inventory.
   * @throws {InvalidEmbeddingError} When a vector cannot be stored.
   * @remarks
   * Sections of an older source version and sections beyond the new count
   * disappear in the same transaction, so a repeated run leaves no duplicates.
   */
  public async replaceSourceSections(
    source: SearchEmbeddingSource,
    modelVersion: string,
    sections: readonly SearchEmbeddingSection[],
  ): Promise<void> {
    const literals = sections.map((section) =>
      toArrayLiteral(section.embedding),
    );
    await this.database.transaction(async (transaction) => {
      await writeSections(transaction, {
        source,
        modelVersion,
        sections,
        literals,
      });
    });
  }

  /**
   * Replaces the sections of a source and records what was indexed, in one
   * transaction.
   * @param record - Source, version, model version and fingerprint of the text.
   * @param sections - All sections of that source version; an empty list keeps
   * only the record, so an unchanged source without text is not read again.
   * @throws {InvalidEmbeddingError} When a vector cannot be stored.
   */
  public async replaceIndexedSource(
    record: IndexedSourceRecord,
    sections: readonly SearchEmbeddingSection[],
  ): Promise<void> {
    const literals = sections.map((section) =>
      toArrayLiteral(section.embedding),
    );
    await this.database.transaction(async (transaction) => {
      await writeSections(transaction, {
        source: record,
        modelVersion: record.modelVersion,
        sections,
        literals,
      });
      await transaction.execute(
        `
          INSERT INTO search_index_sources (
              model_version,
              source_type,
              source_id,
              source_version,
              fingerprint,
              section_count
          )
          VALUES (
              $model_version,
              $source_type,
              $source_id,
              $source_version,
              $fingerprint,
              $section_count
          )
          ON CONFLICT (model_version, source_type, source_id) DO UPDATE
          SET source_version = excluded.source_version,
              fingerprint = excluded.fingerprint,
              section_count = excluded.section_count,
              indexed_at = utc_now();
        `,
        {
          model_version: record.modelVersion,
          source_type: record.sourceType,
          source_id: record.sourceId,
          source_version: record.sourceVersion,
          fingerprint: record.fingerprint,
          section_count: sections.length,
        },
      );
    });
  }

  /**
   * Lists what the indexer recorded for one model version.
   * @param modelVersion - Model version of the inventory.
   * @returns Every recorded source with version, fingerprint and section count.
   */
  public async listIndexedSources(
    modelVersion: string,
  ): Promise<IndexedSource[]> {
    const rows = await this.database.query(
      `
        SELECT
            source_type,
            source_id,
            source_version,
            fingerprint,
            section_count
        FROM search_index_sources
        WHERE model_version = $model_version
        ORDER BY
            source_type,
            source_id;
      `,
      { model_version: modelVersion },
    );
    return rows.map((row) => ({
      sourceType: readSourceType(readTextColumn(row, 0, "source_type")),
      sourceId: readTextColumn(row, 1, "source_id"),
      sourceVersion: readTextColumn(row, 2, "source_version"),
      fingerprint: readTextColumn(row, 3, "fingerprint"),
      sectionCount: readCountColumn(row, 4, "section_count"),
    }));
  }

  /**
   * Lists every source that has sections or an index record in any model version.
   * @returns The distinct sources, so removed ones leave every inventory.
   */
  public async listStoredSourceKeys(): Promise<SearchEmbeddingSourceKey[]> {
    const rows = await this.database.query(`
      SELECT
          source_type,
          source_id
      FROM search_index_sources
      UNION
      SELECT
          source_type,
          source_id
      FROM search_embeddings
      ORDER BY
          source_type,
          source_id;
    `);
    return rows.map((row) => ({
      sourceType: readSourceType(readTextColumn(row, 0, "source_type")),
      sourceId: readTextColumn(row, 1, "source_id"),
    }));
  }

  /**
   * Removes a source from the inventories of every model version.
   * @param sourceType - Kind of the removed source.
   * @param sourceId - Identifier of the removed source.
   * @remarks
   * The index records go with the sections, so the source is embedded anew
   * when it returns, for example after a renewed asset release.
   */
  public async removeSource(
    sourceType: SearchEmbeddingSourceType,
    sourceId: string,
  ): Promise<void> {
    const parameters = { source_type: sourceType, source_id: sourceId };
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          DELETE FROM search_embeddings
          WHERE source_type = $source_type
              AND source_id = $source_id;
        `,
        parameters,
      );
      await transaction.execute(
        `
          DELETE FROM search_index_sources
          WHERE source_type = $source_type
              AND source_id = $source_id;
        `,
        parameters,
      );
    });
  }

  /**
   * Removes the whole inventory of one model version, for example the old
   * model after a model change was indexed completely.
   * @param modelVersion - Model version whose sections and records go.
   */
  public async removeModelInventory(modelVersion: string): Promise<void> {
    const parameters = { model_version: modelVersion };
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        "DELETE FROM search_embeddings WHERE model_version = $model_version;",
        parameters,
      );
      await transaction.execute(
        "DELETE FROM search_index_sources WHERE model_version = $model_version;",
        parameters,
      );
    });
  }

  /**
   * Finds the sections closest to a question by exact cosine distance.
   * @param request - Model version, question vector, visible sources and limit.
   * @returns The nearest visible sections, closest first.
   * @throws {VectorSearchUnavailableError} When pgvector is not activated;
   * the caller then keeps to the keyword search.
   * @throws {InvalidEmbeddingError} When the question vector cannot be compared.
   * @remarks
   * The search compares every section of the model version that the visible
   * sources hold; no approximate index takes part. Visibility filters before
   * the ranking and the limit, so hidden sections never take a place.
   */
  public async searchExact(
    request: ExactSearchRequest,
  ): Promise<readonly SearchEmbeddingHit[]> {
    const embedding = toArrayLiteral(request.embedding);
    const parameters = createSearchParameters(request, embedding);
    const support = await this.readVectorSupport();
    if (!support.isInstalled) throw new VectorSearchUnavailableError();
    try {
      const rows = await this.database.query(
        `
          SELECT
              section.source_type,
              section.source_id,
              section.source_version,
              section.section_index,
              section.section_text,
              (section.embedding::vector <=> $query_embedding::REAL[]::vector)::DOUBLE PRECISION AS cosine_distance
          FROM search_embeddings AS section
          WHERE section.model_version = $model_version
              AND section.dimensions = $dimensions
              AND (section.source_type, section.source_id) IN (${request.visibleSources.sql})
          ORDER BY
              cosine_distance,
              section.source_type,
              section.source_id,
              section.section_index
          LIMIT $limit;
        `,
        parameters,
      );
      return rows.map(readHit);
    } catch (error: unknown) {
      // The extension can be deactivated between the check and the query.
      if (isMissingVectorType(error)) throw new VectorSearchUnavailableError();
      throw error;
    }
  }
}
