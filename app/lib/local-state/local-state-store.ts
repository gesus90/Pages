const DATABASE_NAME = "pages-local-state";
const DATABASE_VERSION = 1;
const ENTRY_STORE = "entries";
const META_STORE = "meta";
const OWNER_KEY = "owner";
/** Tells the other tabs of this browser which account a document claimed. */
const CLAIM_CHANNEL = "pages-local-state-claims";

/** Starts the route of an edit the server has not confirmed yet, instead of a path. */
export const DRAFT_ROUTE_PREFIX = "draft:";

/** One server answer kept for one account and route. */
export interface LocalStateEntry<T> {
  readonly ownerId: string;
  /**
   * Path and query of the route the answer belongs to, or a key starting
   * with {@link DRAFT_ROUTE_PREFIX} for an unconfirmed edit.
   */
  readonly route: string;
  readonly schemaVersion: number;
  /** When the browser received the answer, in milliseconds since the epoch. */
  readonly savedAt: number;
  readonly payload: T;
}

/** The stored form of one route's answers. */
export interface LocalStateKind<T> {
  /** Raised whenever the payload shape changes; an entry of another version is discarded. */
  readonly schemaVersion: number;
  readonly isPayload: (value: unknown) => value is T;
  /**
   * Whether a kept answer still applies to the signed-in context, such as
   * the account's current rights; one that does not is never shown.
   */
  readonly isCurrent?: (payload: T) => boolean;
}

/** The account whose answers this tab may keep; `undefined` until the document named it. */
type Owner = string | null | undefined;

/** What a tab announces when its document claims the store. */
interface ClaimNotice {
  readonly ownerId: string | null;
  /** A sign-out is starting; the session it ends may still answer until it finished. */
  readonly isSignOut: boolean;
}

/**
 * Whether this tab's account is still the browser's: `current`, `pending`
 * after another tab started to sign out, `settled` once another document
 * claimed the store after a sign-out or for another account.
 */
export type LocalStateSupersession = "current" | "pending" | "settled";

function isClaimNotice(value: unknown): value is ClaimNotice {
  return (
    typeof value === "object" &&
    value !== null &&
    "ownerId" in value &&
    (value.ownerId === null || typeof value.ownerId === "string") &&
    "isSignOut" in value &&
    typeof value.isSignOut === "boolean"
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function isEntry(value: unknown): value is LocalStateEntry<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ownerId" in value &&
    typeof value.ownerId === "string" &&
    "route" in value &&
    typeof value.route === "string" &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    "savedAt" in value &&
    typeof value.savedAt === "number" &&
    "payload" in value
  );
}

function readableEntry<T>(
  stored: unknown,
  expected: {
    readonly ownerId: string;
    readonly recordedOwner: unknown;
    readonly kind: LocalStateKind<T>;
  },
): LocalStateEntry<T> | null {
  const { ownerId, recordedOwner, kind } = expected;
  if (!isEntry(stored)) return null;
  if (recordedOwner !== ownerId || stored.ownerId !== ownerId) return null;
  if (stored.schemaVersion !== kind.schemaVersion) return null;
  const { payload } = stored;
  if (!kind.isPayload(payload)) return null;
  return { ...stored, payload };
}

/**
 * Whether a claim leaves an entry in place.
 *
 * @remarks
 * Only unconfirmed edits stay, and only while no other account signs in and
 * nobody signs out: an expired session must not cost the edit typed before.
 * The entry stays unreadable until its account claims the store again.
 */
function survivesClaim(
  key: IDBValidKey,
  ownerId: string | null,
  isSignOut: boolean,
): boolean {
  if (isSignOut || !Array.isArray(key)) return false;
  const [entryOwner, route] = key;
  return (
    typeof route === "string" &&
    route.startsWith(DRAFT_ROUTE_PREFIX) &&
    (ownerId === null || entryOwner === ownerId)
  );
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(ENTRY_STORE))
      database.createObjectStore(ENTRY_STORE, {
        keyPath: ["ownerId", "route"],
      });
    if (!database.objectStoreNames.contains(META_STORE))
      database.createObjectStore(META_STORE);
  };
  return requestResult(request);
}

/**
 * Keeps the last server answer per account and route in IndexedDB.
 *
 * @remarks
 * The store holds the answers of one account at a time. The document claims
 * its signed-in account; a different account or a sign-out empties the store
 * in the same transaction that records the new owner. A write is refused
 * unless that recorded owner is still its account, so a late answer of a
 * previous account, from this tab or another one, never lands after a
 * sign-out or an account change. All work of a tab runs in one queue, in the
 * order it was requested. Without IndexedDB nothing is kept. Unconfirmed
 * edits of an account outlast a claim without account (see `survivesClaim`).
 *
 * Every claim is announced to the other tabs. A tab whose document belongs
 * to an account learns at once when another tab signs out or signs in as
 * someone else: it is then superseded and shows nothing of its account
 * again, whatever answer of the earlier session still arrives.
 */
export class LocalStateStore {
  private owner: Owner = undefined;
  private supersession: LocalStateSupersession = "current";
  private channel: BroadcastChannel | null = null;
  private readonly supersededListeners = new Set<() => void>();
  private announceClaim: (() => void) | null = null;
  /** Settles once the document named its account; later work is queued behind that claim. */
  private readonly firstClaim = new Promise<void>((resolve) => {
    this.announceClaim = resolve;
  });
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Answers and removals (`null`) requested before the document named its account. */
  private readonly pending = new Map<string, LocalStateEntry<unknown> | null>();

  /** The account this tab keeps answers for, or `null` while none is signed in. */
  public currentOwner(): string | null {
    return this.owner ?? null;
  }

  /** Resolves once the document named its account, so a read sees that account's entries. */
  public whenClaimed(): Promise<void> {
    return this.firstClaim;
  }

  /**
   * The account the browser's store was last claimed for, also by an earlier document.
   *
   * @remarks
   * The static app opens without the server when the backend is down
   * (PAGE-235); it then continues with the account whose answers the
   * browser still keeps, until the server answers again.
   */
  public recordedOwner(): Promise<string | null> {
    return this.enqueue(null, async (database) => {
      const transaction = database.transaction(META_STORE, "readonly");
      const done = transactionDone(transaction);
      const recorded: unknown = await requestResult(
        transaction.objectStore(META_STORE).get(OWNER_KEY),
      );
      await done;
      return typeof recorded === "string" ? recorded : null;
    });
  }

  /**
   * Lets work that waits for the first claim go on although none came.
   *
   * @remarks
   * For a document that could name no account, such as one opened offline
   * in a browser that keeps none; reads then find nothing.
   */
  public settleWithoutClaim(): void {
    this.announceClaim?.();
  }

  /**
   * Whether another tab of this browser signed out or claimed another account
   * since this document named its account; its answers then no longer apply.
   */
  public isSuperseded(): boolean {
    return this.supersession !== "current";
  }

  /** How far another tab has taken this tab's account away, see {@link LocalStateSupersession}. */
  public supersessionState(): LocalStateSupersession {
    return this.supersession;
  }

  /**
   * Calls the listener whenever the supersession of this tab advances.
   *
   * @param listener - Called when another tab signs out or claims another account.
   * @returns Stops calling the listener.
   */
  public onSuperseded(listener: () => void): () => void {
    this.supersededListeners.add(listener);
    return () => this.supersededListeners.delete(listener);
  }

  /**
   * Records the account signed in to this document and drops every other account's answers.
   *
   * @param ownerId - The signed-in account, or `null` without one.
   * @param options - `isSignOut` also drops this account's unconfirmed edits.
   */
  public claim(
    ownerId: string | null,
    options: { readonly isSignOut?: boolean } = {},
  ): Promise<void> {
    this.owner = ownerId;
    this.supersession = "current";
    const isSignOut = options.isSignOut === true;
    this.announce({ ownerId, isSignOut });
    const waiting = [...this.pending.entries()];
    this.pending.clear();
    const claimed = this.enqueue(undefined, async (database) => {
      const transaction = database.transaction(
        [ENTRY_STORE, META_STORE],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const meta = transaction.objectStore(META_STORE);
      const entries = transaction.objectStore(ENTRY_STORE);
      const previous: unknown = await requestResult(meta.get(OWNER_KEY));
      if (previous !== ownerId || isSignOut) {
        const keys = await requestResult(entries.getAllKeys());
        for (const key of keys) {
          if (!survivesClaim(key, ownerId, isSignOut)) entries.delete(key);
        }
      }
      meta.put(ownerId, OWNER_KEY);
      for (const [route, entry] of waiting) {
        if (ownerId === null) break;
        if (entry === null) entries.delete([ownerId, route]);
        else if (entry.ownerId === ownerId) entries.put(entry);
      }
      await done;
    });
    this.announceClaim?.();
    return claimed;
  }

  /**
   * Returns the kept answer of the signed-in account for a route.
   *
   * @param route - Path and query of the route.
   * @param kind - The schema the answer must have.
   * @returns The entry, or `null` when none of this account and version exists.
   */
  public read<T>(
    route: string,
    kind: LocalStateKind<T>,
  ): Promise<LocalStateEntry<T> | null> {
    const ownerId = this.owner;
    if (!ownerId) return Promise.resolve(null);
    return this.enqueue(null, async (database) => {
      const transaction = database.transaction(
        [ENTRY_STORE, META_STORE],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const entries = transaction.objectStore(ENTRY_STORE);
      const [recordedOwner, stored] = await Promise.all([
        requestResult<unknown>(
          transaction.objectStore(META_STORE).get(OWNER_KEY),
        ),
        requestResult<unknown>(entries.get([ownerId, route])),
      ]);
      const entry = readableEntry(stored, { ownerId, recordedOwner, kind });
      if (stored !== undefined && !entry) entries.delete([ownerId, route]);
      await done;
      return entry;
    });
  }

  /**
   * Keeps a server answer for its account and route.
   *
   * @param ownerId - The account the server answered.
   * @param route - Path and query of the route.
   * @param kind - The schema of the answer.
   * @param payload - Exactly what the server delivered to this account.
   */
  public save<T>(
    ownerId: string,
    route: string,
    kind: LocalStateKind<T>,
    payload: T,
  ): Promise<void> {
    const entry: LocalStateEntry<T> = {
      ownerId,
      route,
      schemaVersion: kind.schemaVersion,
      savedAt: Date.now(),
      payload,
    };
    // An answer rendered before the document named its account waits for that claim.
    if (this.owner === undefined) {
      this.pending.set(route, entry);
      return Promise.resolve();
    }
    if (this.owner !== ownerId) return Promise.resolve();
    return this.enqueue(undefined, async (database) => {
      const transaction = database.transaction(
        [ENTRY_STORE, META_STORE],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const recordedOwner: unknown = await requestResult(
        transaction.objectStore(META_STORE).get(OWNER_KEY),
      );
      if (recordedOwner === ownerId && this.owner === ownerId)
        transaction.objectStore(ENTRY_STORE).put(entry);
      await done;
    });
  }

  /**
   * Removes the signed-in account's answer for a route, for example after a refused permission.
   *
   * @param route - Path and query of the route.
   */
  public remove(route: string): Promise<void> {
    if (this.owner === undefined) {
      this.pending.set(route, null);
      return Promise.resolve();
    }
    const ownerId = this.owner;
    if (!ownerId) return Promise.resolve();
    return this.enqueue(undefined, async (database) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(ENTRY_STORE).delete([ownerId, route]);
      await done;
    });
  }

  /**
   * Removes the signed-in account's answers that no longer apply, such as those of earlier rights.
   *
   * @remarks
   * Unconfirmed edits stay; they are not answers of the server.
   *
   * @param isOutdated - Whether a kept answer no longer applies.
   */
  public removeOutdated(
    isOutdated: (payload: unknown) => boolean,
  ): Promise<void> {
    const ownerId = this.owner;
    if (!ownerId) return Promise.resolve();
    return this.enqueue(undefined, async (database) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      const done = transactionDone(transaction);
      const entries = transaction.objectStore(ENTRY_STORE);
      const stored: unknown[] = await requestResult(entries.getAll());
      for (const entry of stored) {
        if (!isEntry(entry) || entry.ownerId !== ownerId) continue;
        if (entry.route.startsWith(DRAFT_ROUTE_PREFIX)) continue;
        if (isOutdated(entry.payload)) entries.delete([ownerId, entry.route]);
      }
      await done;
    });
  }

  /** Tells the other tabs about a claim and listens for theirs. */
  private announce(notice: ClaimNotice): void {
    if (typeof BroadcastChannel === "undefined") return;
    if (!this.channel) {
      this.channel = new BroadcastChannel(CLAIM_CHANNEL);
      this.channel.onmessage = (event: MessageEvent<unknown>) =>
        this.receiveClaim(event.data);
    }
    this.channel.postMessage(notice);
  }

  /**
   * Supersedes this tab when another tab signs out or claims another account.
   *
   * @remarks
   * A sign-out supersedes at once, but settles only with the next claim of a
   * document, such as the sign-in page: until then the ending session may
   * still answer a request of this tab.
   */
  private receiveClaim(notice: unknown): void {
    if (!isClaimNotice(notice) || typeof this.owner !== "string") return;
    const next = this.nextSupersession(notice);
    if (next === this.supersession) return;
    this.supersession = next;
    for (const listener of this.supersededListeners) listener();
  }

  private nextSupersession(notice: ClaimNotice): LocalStateSupersession {
    if (this.supersession === "current") {
      if (notice.ownerId === this.owner && !notice.isSignOut) return "current";
      return notice.isSignOut ? "pending" : "settled";
    }
    return notice.isSignOut ? this.supersession : "settled";
  }

  private enqueue<T>(
    fallback: T,
    task: (database: IDBDatabase) => Promise<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      try {
        const database = await this.connect();
        return database ? await task(database) : fallback;
      } catch (error: unknown) {
        console.warn(
          "Pages could not use the local data of this browser.",
          error,
        );
        return fallback;
      }
    };
    const result = this.queue.then(run);
    this.queue = result;
    return result;
  }

  private async connect(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;
    this.database ??= openDatabase().then((database) => {
      // Another tab's newer schema takes over; this tab reopens on its next request.
      database.onversionchange = () => {
        database.close();
        this.database = null;
      };
      return database;
    });
    try {
      return await this.database;
    } catch (error: unknown) {
      this.database = null;
      throw error;
    }
  }
}

/** The one store of this browser tab. */
export const localState = new LocalStateStore();
