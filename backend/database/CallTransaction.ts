import { AsyncLocalStorage } from "node:async_hooks";

import { logCaughtError } from "@/backend/logging/Logger";

import type { DatabaseTransaction } from "./Database";

/** Whether the current transaction changed a row; an UPDATE that matched nothing does not. */
const CHANGED_ROWS =
  "SELECT CASE WHEN pg_current_xact_id_if_assigned() IS NULL THEN 0 ELSE 1 END AS changed;";

/** How a call transaction reaches the writer without being routed into itself. */
export interface CallTransactionHost {
  /** Runs `work` as one writer transaction of its own. */
  readonly runTransaction: <Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ) => Promise<Result>;
}

/**
 * One call whose database work, from its opening to its end, is a single transaction.
 *
 * @remarks
 * The writer job stays open while the call runs, so every statement, nested
 * transaction and read of the call after the opening joins it and sees its
 * own writes. Effects that must not happen before the commit, such as removed
 * files or work handed to the background, wait for it and are dropped on a
 * rollback.
 */
export class CallTransaction {
  private readonly host: CallTransactionHost;
  /** Effects kept for the commit; the last frame belongs to the innermost open savepoint. */
  private readonly frames: (() => Promise<void>)[][] = [[]];
  private opening: Promise<DatabaseTransaction> | null = null;
  private job: Promise<unknown> | null = null;
  private release: ((outcome: Error | null) => void) | null = null;
  private savepoints = 0;
  private isEnded = false;

  /**
   * Creates a call that is not open yet.
   *
   * @param host - Opens the writer transaction of the call.
   */
  public constructor(host: CallTransactionHost) {
    this.host = host;
  }

  /** Whether the call holds its transaction. */
  public get isOpen(): boolean {
    return this.opening !== null && !this.isEnded;
  }

  /** Whether the call belongs to the given host and still runs. */
  public isRunningOn(host: CallTransactionHost): boolean {
    return this.host === host && !this.isEnded;
  }

  /**
   * Opens the transaction of the call once and returns it.
   *
   * @returns The transaction every later statement of the call runs in.
   */
  public open(): Promise<DatabaseTransaction> {
    this.opening ??= new Promise<DatabaseTransaction>((resolve, reject) => {
      const held = new Promise<void>((settle, fail) => {
        this.release = (outcome) => (outcome ? fail(outcome) : settle());
      });
      this.job = this.host.runTransaction(async (transaction) => {
        resolve(transaction);
        await held;
      });
      this.job.catch(reject);
    });
    return this.opening;
  }

  /** Names the next savepoint of a nested transaction. */
  public nextSavepoint(): string {
    this.savepoints += 1;
    return `pages_call_${String(this.savepoints)}`;
  }

  /**
   * Keeps an effect until the call committed; without an open transaction it runs now.
   *
   * @param effect - Work that must never act on uncommitted changes.
   */
  public defer(effect: () => Promise<void>): void {
    this.frames[this.frames.length - 1]?.push(effect);
  }

  /** Starts keeping effects for a nested transaction of the call. */
  public beginNested(): void {
    this.frames.push([]);
  }

  /**
   * Ends a nested transaction: a released one hands its kept effects on, a
   * rolled back one drops them.
   *
   * @param isReleased - Whether the nested transaction succeeded.
   */
  public endNested(isReleased: boolean): void {
    const frame = this.frames.pop() ?? [];
    if (isReleased) this.frames[this.frames.length - 1]?.push(...frame);
  }

  /**
   * Ends the call: commits and then runs the kept effects, or rolls back and drops them.
   *
   * @param failure - The error that ended the call, `null` for a commit.
   * @throws The error of a failed commit; the effects are dropped then.
   */
  public async end(failure: Error | null): Promise<void> {
    const job = this.job;
    this.release?.(failure);
    this.isEnded = true;
    if (failure) {
      await job?.catch((error: unknown) => {
        logCaughtError("CallTransaction", error);
      });
      return;
    }
    await job;
    for (const effect of this.frames.flat()) {
      try {
        await effect();
      } catch (error: unknown) {
        // The commit stands; a failed follow-up such as a file removal is only reported.
        logCaughtError("CallTransaction", error);
      }
    }
  }
}

const calls = new AsyncLocalStorage<CallTransaction | null>();

/**
 * Returns the running call of the given host.
 *
 * @param host - The database asking.
 * @returns The call, or `null` outside of one.
 */
export function currentCall(host: CallTransactionHost): CallTransaction | null {
  const call = calls.getStore() ?? null;
  return call?.isRunningOn(host) ? call : null;
}

/**
 * Runs `work` inside a call.
 *
 * @param call - The call the work belongs to.
 * @param work - The work of the call.
 * @returns Whatever `work` returns.
 */
export function runInCall<Result>(
  call: CallTransaction,
  work: () => Promise<Result>,
): Promise<Result> {
  return calls.run(call, work);
}

/**
 * Runs `work` outside of any call, for work detached from the caller.
 *
 * @param work - The detached work.
 * @returns Whatever `work` returns.
 */
export function detachFromCall<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  return calls.run(null, work);
}

/**
 * Runs bookkeeping outside of the call while the call is not open yet.
 *
 * @remarks
 * A reserved ticket number is not the change of the call; reserved before the
 * call writes, it stays reserved like before. Once the call holds the writer,
 * the bookkeeping joins it, because a second writer job would wait for the
 * call forever.
 *
 * @param work - The bookkeeping.
 * @returns Whatever `work` returns.
 */
export function beforeCallOpens<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  const call = calls.getStore() ?? null;
  if (call?.isOpen) return work();
  return calls.run(null, work);
}

/**
 * Keeps an effect for the commit of the open call.
 *
 * @param effect - Work to repeat or start once the call committed.
 * @returns Whether an open call keeps it; without one the caller acts now.
 */
export function keepForCallCommit(effect: () => Promise<void>): boolean {
  const call = calls.getStore() ?? null;
  if (!call?.isOpen) return false;
  call.defer(effect);
  return true;
}

/**
 * Runs an effect after the commit of the open call, or now without one.
 *
 * @param effect - Work that must never act on uncommitted changes.
 * @returns Resolves once the effect ran or was kept for the commit.
 */
export async function afterCallCommit(
  effect: () => Promise<void>,
): Promise<void> {
  if (!keepForCallCommit(effect)) await effect();
}

/**
 * Tells whether the open transaction wrote a row so far.
 *
 * @param transaction - Statement access of the open transaction.
 * @returns Whether PostgreSQL assigned the transaction an id.
 *
 * @remarks
 * An UPDATE or DELETE that matched nothing and an insert skipped by
 * `ON CONFLICT DO NOTHING` assign none. A written row assigns one, also when
 * it holds the values it had, and so does a row lock or a write of a savepoint
 * that later rolled back. Callers therefore write only real changes and do
 * not continue after a failed nested transaction they caught.
 */
export async function hasChangedRows(
  transaction: Pick<DatabaseTransaction, "query">,
): Promise<boolean> {
  const rows = await transaction.query(CHANGED_ROWS);
  return rows[0]?.[0] === 1;
}
