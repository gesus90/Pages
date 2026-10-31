import { AsyncLocalStorage } from "node:async_hooks";

import type { DatabaseValue, SqlParameters } from "./Database";

/** Most statements one scope remembers. */
const MAX_ENTRIES = 4096;

/** Largest single value a scope keeps; a graph or run view is read again instead. */
const MAX_VALUE_CHARACTERS = 16_384;

/** Total text a scope keeps, so a long unit of work cannot hold on to the database. */
const MAX_TOTAL_CHARACTERS = 4_000_000;

/** Statements that start like a read. */
const READ_START = /^\s*(?:SELECT|WITH)\b/iu;

/** Words that change data or settings; a statement holding one is treated as a write. */
const WRITE_WORD =
  /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|COPY|CALL|ATTACH|DETACH|PRAGMA|SET|CHECKPOINT|EXPORT|IMPORT|INSTALL|LOAD|VACUUM|TRUNCATE|NEXTVAL|CURRVAL)\b/iu;

/** Functions that answer differently from one moment to the next. */
const CHANGING_FUNCTION =
  /\b(?:NOW|UTC_NOW|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIMESTAMP|TODAY|RANDOM|UUID|GEN_RANDOM_UUID|GETVARIABLE|READ_TEXT|READ_BLOB|GLOB)\b/iu;

/** What running a statement does to the data and to repeating it. */
export type StatementKind = "write" | "volatile" | "repeatable";

/** Most statements whose kind is remembered; repositories own a few hundred. */
const MAX_KINDS = 2048;

const kinds = new Map<string, StatementKind>();

interface ScopedRows {
  readonly epoch: number;
  readonly rows: readonly DatabaseValue[][];
  readonly characters: number;
}

/** The text one value holds, or `null` when it is too large to keep. */
function valueSize(value: DatabaseValue): number | null {
  if (typeof value === "string")
    return value.length > MAX_VALUE_CHARACTERS ? null : value.length;
  return Buffer.isBuffer(value) ? null : 8;
}

/** Counts the text a result holds, or `null` when it is too large to keep. */
function sizeOf(rows: readonly DatabaseValue[][]): number | null {
  let characters = 0;
  for (const row of rows)
    for (const value of row) {
      const size = valueSize(value);
      if (size === null) return null;
      characters += size;
    }
  return characters;
}

function copyOf(rows: readonly DatabaseValue[][]): DatabaseValue[][] {
  return rows.map((row) => [...row]);
}

/**
 * Sorts a statement by what it does.
 *
 * @param statement - SQL owned by a repository.
 * @returns `write` for anything that might change data, `volatile` for a read
 * that depends on the time or on chance, `repeatable` for a read that gives
 * the same rows until data is written.
 *
 * @remarks
 * The sorting errs towards `write`: such a statement is never remembered and
 * ends the validity of every remembered answer. The sorting of a statement is
 * remembered, because the same few hundred statements run all the time.
 */
export function statementKind(statement: string): StatementKind {
  const known = kinds.get(statement);
  if (known !== undefined) return known;
  const kind = sortStatement(statement);
  if (kinds.size < MAX_KINDS) kinds.set(statement, kind);
  return kind;
}

function sortStatement(statement: string): StatementKind {
  if (!READ_START.test(statement) || WRITE_WORD.test(statement)) return "write";
  return CHANGING_FUNCTION.test(statement) ? "volatile" : "repeatable";
}

/**
 * Names a statement together with the values it is run with.
 *
 * @param statement - SQL owned by a repository.
 * @param parameters - Values bound to the placeholders.
 * @returns The key, or `null` when a value cannot be told apart cheaply.
 */
export function readScopeKey(
  statement: string,
  parameters: SqlParameters,
): string | null {
  const bound: string[] = [];
  for (const name of Object.keys(parameters).sort()) {
    const value = parameters[name];
    if (Buffer.isBuffer(value)) return null;
    bound.push(`${name}=${typeof value}:${String(value)}`);
  }
  return `${statement}\u0000${bound.join("\u0001")}`;
}

/**
 * Remembers what repeated reads of one unit of work answered.
 *
 * @remarks
 * A plan page asks the same questions many times: who the person is, which
 * agents they may use, what a connection allows. The database has one writer,
 * so a read repeats its answer exactly until something is written. The scope
 * keeps each answer together with the number of writes that had happened when
 * it was read, and gives it out again only while that number is unchanged. It
 * lives as long as the unit of work that opened it and never answers for
 * another one.
 */
export class ReadScope {
  private readonly entries = new Map<string, ScopedRows>();
  private characters = 0;

  /**
   * Returns the rows of an earlier identical read.
   *
   * @param key - The statement with its values, see {@link readScopeKey}.
   * @param epoch - The number of writes the database has seen now.
   * @returns A copy of the rows, or `null` when nothing valid is remembered.
   */
  public find(key: string, epoch: number): DatabaseValue[][] | null {
    const known = this.entries.get(key);
    if (known === undefined) return null;
    if (known.epoch === epoch) return copyOf(known.rows);
    this.forget(key, known);
    return null;
  }

  /**
   * Remembers the rows a read answered.
   *
   * @param key - The statement with its values, see {@link readScopeKey}.
   * @param epoch - The number of writes the database had seen before the read began.
   * @param rows - What the read answered.
   */
  public store(
    key: string,
    epoch: number,
    rows: readonly DatabaseValue[][],
  ): void {
    const characters = sizeOf(rows);
    if (characters === null) return;
    if (
      this.entries.size >= MAX_ENTRIES ||
      this.characters + characters > MAX_TOTAL_CHARACTERS
    )
      return;
    const previous = this.entries.get(key);
    if (previous) this.forget(key, previous);
    this.entries.set(key, { epoch, rows: copyOf(rows), characters });
    this.characters += characters;
  }

  private forget(key: string, entry: ScopedRows): void {
    this.entries.delete(key);
    this.characters -= entry.characters;
  }
}

const scopes = new AsyncLocalStorage<ReadScope>();

/**
 * Runs a unit of work whose repeated reads are answered once.
 *
 * @param work - The unit of work; every read it starts shares the scope.
 * @returns What `work` returns.
 *
 * @remarks
 * A scope that is already open is joined, so a service call made inside
 * another one shares its answers.
 */
export function withReadScope<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  return scopes.getStore() === undefined
    ? scopes.run(new ReadScope(), work)
    : work();
}

/** Returns the scope of the running unit of work, or `undefined` outside one. */
export function currentReadScope(): ReadScope | undefined {
  return scopes.getStore();
}
