/** How the next IndexedDB operation of a {@link FakeIndexedDb} is made to fail. */
export type FakeFailure = "open" | "request" | "abort" | "transactionError";

interface FakeRequest<T> {
  result: T | undefined;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: (() => void) | null;
}

interface QueuedFailure {
  readonly kind: FakeFailure;
  readonly error: Error | null;
}

function keyOf(key: unknown): string {
  return JSON.stringify(key);
}

/** One object store, with an in-line compound key or out-of-line keys. */
class FakeObjectStore {
  public readonly records = new Map<string, { key: unknown; value: unknown }>();
  private readonly keyPath: readonly string[] | null;

  /** Remembers the property names that make up the in-line key, if any. */
  public constructor(keyPath: readonly string[] | null) {
    this.keyPath = keyPath;
  }

  /** The key a value is stored under. */
  public keyFor(value: unknown, key: unknown): unknown {
    if (this.keyPath === null) return key;
    const record = value as Record<string, unknown>;
    return this.keyPath.map((name) => record[name]);
  }
}

/** The part of a transaction that the store's code observes. */
class FakeTransaction {
  public error: Error | null = null;
  public oncomplete: (() => void) | null = null;
  public onabort: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private pendingRequests = 0;
  private isFinished = false;
  private readonly database: FakeDatabase;
  private readonly storeNames: readonly string[];

  /** Opens a transaction over the named stores of a database. */
  public constructor(database: FakeDatabase, storeNames: readonly string[]) {
    this.database = database;
    this.storeNames = storeNames;
  }

  /** The named store, which the transaction must cover. */
  public objectStore(name: string): FakeStoreHandle {
    if (!this.storeNames.includes(name))
      throw new Error(`Store ${name} is not part of the transaction`);
    return new FakeStoreHandle(this, this.database.store(name));
  }

  /** Runs one operation asynchronously, as IndexedDB answers a request. */
  public request<T>(operation: () => T): FakeRequest<T> {
    const request: FakeRequest<T> = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    this.pendingRequests += 1;
    queueMicrotask(() => {
      this.pendingRequests -= 1;
      const requestFailure = this.database.takeFailure("request");
      if (requestFailure) {
        this.isFinished = true;
        request.error = requestFailure.error;
        request.onerror?.();
        return;
      }
      request.result = operation();
      request.onsuccess?.();
      this.finishWhenIdle();
    });
    return request;
  }

  private finishWhenIdle(): void {
    setTimeout(() => {
      if (this.pendingRequests > 0 || this.isFinished) return;
      this.isFinished = true;
      const abort = this.database.takeFailure("abort");
      const failure = abort ?? this.database.takeFailure("transactionError");
      if (!failure) {
        this.oncomplete?.();
        return;
      }
      this.error = failure.error;
      if (abort) this.onabort?.();
      else this.onerror?.();
    }, 0);
  }
}

/** The operations of one store inside one transaction. */
class FakeStoreHandle {
  private readonly transaction: FakeTransaction;
  private readonly store: FakeObjectStore;

  /** Binds a store to the transaction its requests belong to. */
  public constructor(transaction: FakeTransaction, store: FakeObjectStore) {
    this.transaction = transaction;
    this.store = store;
  }

  /** Reads one value by key. */
  public get(key: unknown): FakeRequest<unknown> {
    return this.transaction.request(() => {
      const record = this.store.records.get(keyOf(key));
      return record === undefined ? undefined : structuredClone(record.value);
    });
  }

  /** Reads every value of the store. */
  public getAll(): FakeRequest<unknown[]> {
    return this.transaction.request(() =>
      [...this.store.records.values()].map((record) =>
        structuredClone(record.value),
      ),
    );
  }

  /** Reads every key of the store. */
  public getAllKeys(): FakeRequest<unknown[]> {
    return this.transaction.request(() =>
      [...this.store.records.values()].map((record) => record.key),
    );
  }

  /** Stores a value under its in-line key. */
  public put(value: unknown, key?: unknown): FakeRequest<unknown> {
    return this.transaction.request(() => {
      const storedKey = this.store.keyFor(value, key);
      this.store.records.set(keyOf(storedKey), {
        key: storedKey,
        value: structuredClone(value),
      });
      return storedKey;
    });
  }

  /** Deletes the value of a key. */
  public delete(key: unknown): FakeRequest<undefined> {
    return this.transaction.request(() => {
      this.store.records.delete(keyOf(key));
      return undefined;
    });
  }
}

/** The database handle `indexedDB.open` resolves with. */
export class FakeDatabase {
  public onversionchange: (() => void) | null = null;
  public isClosed = false;
  public readonly objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };
  private readonly stores: Map<string, FakeObjectStore>;
  private readonly failures: QueuedFailure[];

  /** Shares the persistent stores and the failure queue of the factory. */
  public constructor(
    stores: Map<string, FakeObjectStore>,
    failures: QueuedFailure[],
  ) {
    this.stores = stores;
    this.failures = failures;
  }

  /** Creates a store; only valid while the database upgrades. */
  public createObjectStore(
    name: string,
    options?: { readonly keyPath?: readonly string[] },
  ): FakeObjectStore {
    const store = new FakeObjectStore(options?.keyPath ?? null);
    this.stores.set(name, store);
    return store;
  }

  /** The persistent store of that name. */
  public store(name: string): FakeObjectStore {
    const store = this.stores.get(name);
    if (!store) throw new Error(`No store ${name}`);
    return store;
  }

  /** Starts a transaction over one store or a list of stores. */
  public transaction(names: string | readonly string[]): FakeTransaction {
    return new FakeTransaction(
      this,
      typeof names === "string" ? [names] : names,
    );
  }

  /** Marks the handle as closed. */
  public close(): void {
    this.isClosed = true;
  }

  /** Consumes the next queued failure if it is of the asked kind. */
  public takeFailure(kind: FakeFailure): QueuedFailure | undefined {
    if (this.failures[0]?.kind !== kind) return undefined;
    return this.failures.shift();
  }
}

/**
 * An in-memory `indexedDB` with the few operations the local-state store uses.
 *
 * @remarks
 * Several documents of one browser share one factory: each test builds one
 * and installs it with `vi.stubGlobal("indexedDB", factory)`.
 */
export class FakeIndexedDb {
  public openCount = 0;
  public lastDatabase: FakeDatabase | null = null;
  private readonly stores = new Map<string, FakeObjectStore>();
  private readonly failures: QueuedFailure[] = [];

  /** Queues a failure for the next operation of that kind. */
  public failNext(kind: FakeFailure, error: Error | null): void {
    this.failures.push({ kind, error });
  }

  /** Opens the database, upgrading it on first use. */
  public open(): FakeOpenRequest {
    this.openCount += 1;
    const request: FakeOpenRequest = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      if (this.failures[0]?.kind === "open") {
        request.error = this.failures.shift()?.error ?? null;
        request.onerror?.();
        return;
      }
      const database = new FakeDatabase(this.stores, this.failures);
      this.lastDatabase = database;
      request.result = database;
      if (!this.stores.has("entries") || !this.stores.has("meta"))
        request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }

  /** Creates a store before the first open, as an earlier, interrupted upgrade leaves it. */
  public createStore(name: string, keyPath: readonly string[] | null): void {
    new FakeDatabase(this.stores, this.failures).createObjectStore(
      name,
      keyPath ? { keyPath } : undefined,
    );
  }

  /** The values kept in a store, keyed as the store keys them. */
  public records(storeName: string): Map<string, unknown> {
    const store = this.stores.get(storeName);
    const records = new Map<string, unknown>();
    for (const [key, record] of store?.records ?? [])
      records.set(key, record.value);
    return records;
  }

  /** Puts a raw value into a store, bypassing the code under test. */
  public seed(storeName: string, value: unknown, key?: unknown): void {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`No store ${storeName}`);
    const storedKey = key ?? store.keyFor(value, undefined);
    store.records.set(keyOf(storedKey), { key: storedKey, value });
  }
}

/** Every `BroadcastChannel` of the test, by channel name. */
export class FakeBroadcastChannel {
  public static readonly instances: FakeBroadcastChannel[] = [];
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public readonly name: string;

  /** Joins the channel of that name. */
  public constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  /** Delivers the message to every other member of the channel at once. */
  public postMessage(message: unknown): void {
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer === this || peer.name !== this.name) continue;
      peer.onmessage?.(new MessageEvent("message", { data: message }));
    }
  }

  /** Forgets all channels between tests. */
  public static reset(): void {
    FakeBroadcastChannel.instances.length = 0;
  }
}
