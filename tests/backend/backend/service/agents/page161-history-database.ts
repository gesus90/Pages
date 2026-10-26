import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

const COLUMNS = [
  "launch_id",
  "chunk_index",
  "byte_offset",
  "byte_length",
  "first_sequence",
  "last_sequence",
  "sha256",
  "previous_sha256",
  "events_jsonl",
] as const;

/** Models only the journal's SQL storage boundary, never opens DuckDB or a network. */
export class HistoryDatabase implements DatabaseTransaction {
  public readonly chunks = new Map<string, SqlParameters>();
  public failure: string | null = null;

  /** Captures a single atomic chunk row, with upsert behavior. */
  public async execute(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    if (this.failure) throw new Error(this.failure);
    if (!statement.includes("INSERT INTO agent_session_history_chunks"))
      throw new Error("Unexpected synthetic statement");
    const key = `${String(parameters.attempt_id)}:${String(parameters.chunk_index)}`;
    this.chunks.set(key, { ...parameters });
  }

  /** Applies the bound identity, range, ordering and limit of the chunk reader. */
  public async query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DatabaseValue[][]> {
    if (this.failure) throw new Error(this.failure);
    let chunks = [...this.chunks.values()].filter(
      (chunk) => chunk.attempt_id === parameters.attempt_id,
    );
    if (statement.includes("MIN(first_sequence)"))
      return [
        [
          chunks.length
            ? Math.min(...chunks.map((chunk) => Number(chunk.first_sequence)))
            : null,
          chunks.length
            ? Math.max(...chunks.map((chunk) => Number(chunk.last_sequence)))
            : null,
        ],
      ];
    if (statement.includes("SELECT sha256, byte_offset")) {
      const previous = chunks.find(
        (chunk) => chunk.chunk_index === parameters.chunk_index,
      );
      return previous
        ? [
            [
              String(previous.sha256),
              Number(previous.byte_offset) + Number(previous.byte_length),
              Number(previous.last_sequence),
              String(previous.launch_id),
            ],
          ]
        : [];
    }
    if (statement.includes("first_sequence < $cursor"))
      chunks = chunks.filter(
        (chunk) => Number(chunk.first_sequence) < Number(parameters.cursor),
      );
    if (statement.includes("last_sequence > $cursor"))
      chunks = chunks.filter(
        (chunk) => Number(chunk.last_sequence) > Number(parameters.cursor),
      );
    chunks.sort(
      (left, right) => Number(left.chunk_index) - Number(right.chunk_index),
    );
    if (statement.includes("DESC")) chunks.reverse();
    return chunks.slice(0, statement.includes("LIMIT 1") ? 1 : 2).map((chunk) =>
      COLUMNS.map((column) => {
        const entry = chunk[column];
        if (
          entry === null ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "bigint" ||
          Buffer.isBuffer(entry)
        )
          return entry;
        throw new Error("Invalid synthetic chunk column");
      }),
    );
  }
}
