/**
 * The part of the `pg` driver Pages uses; the package ships no types.
 *
 * @remarks
 * `rows` holds {@link DatabaseValue} because `PostgresValues.ts` installs a
 * parser for every column type, so the driver defaults never apply.
 */
declare module "pg" {
  import type { DatabaseValue } from "@/backend/database/Database";

  export interface QueryConfig {
    readonly text: string;
    readonly values?: readonly (string | number | bigint | Buffer | null)[];
    readonly rowMode: "array";
  }

  export interface QueryResult {
    /** The command tag of the server; a failed transaction's COMMIT says `ROLLBACK`. */
    readonly command: string;
    readonly rows: DatabaseValue[][];
  }

  export interface PoolClient {
    /** A statement list without bound values answers with one result each. */
    query(config: QueryConfig): Promise<QueryResult | QueryResult[]>;
    /** Returns the connection; `true` closes it instead of reusing it. */
    release(destroy?: boolean): void;
    on(event: "error", listener: (error: Error) => void): void;
    removeListener(event: "error", listener: (error: Error) => void): void;
  }

  export interface TypeParsers {
    getTypeParser(oid: number): (text: string) => DatabaseValue;
  }

  export interface PoolConfig {
    readonly connectionString: string;
    readonly max: number;
    readonly connectionTimeoutMillis: number;
    readonly keepAlive: boolean;
    /** Startup options of every connection, such as `-c name=value`. */
    readonly options: string;
    readonly types: TypeParsers;
  }

  /** The connection pool; it reports lost idle connections as `error` events. */
  export class Pool {
    /** Creates the pool; it opens connections when they are needed. */
    public constructor(config: PoolConfig);
    /** Checks a connection out, opening one when none is free. */
    public connect(): Promise<PoolClient>;
    /** Closes every connection once the checked-out ones returned. */
    public end(): Promise<void>;
    /** Listens for errors of idle connections. */
    public on(event: "error", listener: (error: Error) => void): void;
  }

  /** The default parsers of the driver. */
  export const types: {
    getTypeParser(oid: number): (text: string) => unknown;
  };
}
