/** Most origins counted separately; further ones share {@link OTHER_ORIGIN}. */
const MAXIMUM_ORIGINS = 64;

const OTHER_ORIGIN = "other";

/** What one origin added to the write-ahead log since the last report. */
export interface DatabaseWalGrowthEntry {
  readonly origin: string;
  /** Growth the writer measured; a checkpointing statement adds nothing here. */
  readonly bytes: number;
  /** Statements that made the log grow. */
  readonly statements: number;
  /** Statements during which DuckDB checkpointed and the log shrank. */
  readonly checkpoints: number;
}

/**
 * Counts write-ahead log growth per kind of work, without SQL or values.
 *
 * @remarks
 * The writer runs one job at a time and DuckDB only writes the log there, so a
 * size change around a statement belongs to its job. The bytes are a lower
 * bound: the growth of a statement that also checkpointed cannot be told apart.
 */
export class DatabaseWalGrowth {
  private readonly entries = new Map<string, DatabaseWalGrowthEntry>();

  /**
   * Adds one measured statement.
   *
   * @param origin - Fixed label of the work.
   * @param before - Log size before the statement, when measured.
   * @param after - Log size after it, when measured.
   */
  public record(
    origin: string,
    before: number | null,
    after: number | null,
  ): void {
    if (before === null || after === null || before === after) return;
    const hasShrunk = after < before;
    const known = this.entryFor(origin);
    this.entries.set(known.origin, {
      origin: known.origin,
      bytes: known.bytes + (hasShrunk ? 0 : after - before),
      statements: known.statements + (hasShrunk ? 0 : 1),
      checkpoints: known.checkpoints + (hasShrunk ? 1 : 0),
    });
  }

  /** Hands out the counts since the last call, the largest growth first. */
  public drain(): readonly DatabaseWalGrowthEntry[] {
    const entries = [...this.entries.values()].sort(
      (first, second) => second.bytes - first.bytes,
    );
    this.entries.clear();
    return entries;
  }

  private entryFor(origin: string): DatabaseWalGrowthEntry {
    const name =
      this.entries.has(origin) || this.entries.size < MAXIMUM_ORIGINS
        ? origin
        : OTHER_ORIGIN;
    return (
      this.entries.get(name) ?? {
        origin: name,
        bytes: 0,
        statements: 0,
        checkpoints: 0,
      }
    );
  }
}
