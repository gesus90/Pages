import { PairingPreferenceRepository } from "@/backend/database/repositories/mcp/PairingPreferenceRepository";
import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";

import type { StoredPairingRequest } from "@/backend/database/repositories/mcp/PairingRepository";
import type { StoredPersonalToken } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";

const NEVER_REACHED = "The in-memory fake never reaches a database.";

/** Passed to the repository base classes; every call of it fails the test. */
const UNUSED_DATABASE = {
  execute: async (): Promise<void> => {
    throw new Error(NEVER_REACHED);
  },
  query: async (): Promise<never> => {
    throw new Error(NEVER_REACHED);
  },
  transaction: async (): Promise<never> => {
    throw new Error(NEVER_REACHED);
  },
};

const GRACE_PERIOD_MS = 300_000;
const USAGE_RESOLUTION_MS = 60_000;

/** Account facts the pairing repository reads inside a transaction. */
export interface StoredAccount {
  displayName: string;
  username: string;
  isEligible: boolean;
}

interface MemoryToken {
  summary: StoredPersonalToken;
  hash: string;
  previousHash: string | null;
  previousValidUntil: number;
}

interface StoreSnapshot {
  readonly requests: Map<string, StoredPairingRequest>;
  readonly tokens: Map<string, MemoryToken>;
  readonly preferences: Map<string, number>;
  readonly tokenOfRequest: Map<string, string>;
}

/**
 * Holds pairing requests, credentials and preferences in memory.
 *
 * @remarks
 * The repositories of this file replace the SQL layer. A transaction that
 * fails restores the state it started with, as the database does.
 */
export class MemoryPairingStore {
  /** Pairing requests by id. */
  public requests = new Map<string, StoredPairingRequest>();
  /** Credentials by id; the hash stays beside the public summary. */
  public tokens = new Map<string, MemoryToken>();
  /** Validity preference in days by user id. */
  public preferences = new Map<string, number>();
  /** Credential id a consumed request produced, by request id. */
  public tokenOfRequest = new Map<string, string>();
  /** Account rows by user id. */
  public readonly accounts = new Map<string, StoredAccount>();
  /** Name of every state-changing call, in call order, rollbacks included. */
  public readonly writes: string[] = [];
  /** Preference writes with the clock value that was passed. */
  public readonly preferenceWrites: {
    userId: string;
    days: number;
    now: number;
  }[] = [];
  /** Hashes `find` was asked for. */
  public readonly lookups: string[] = [];
  /** Replaces the count of open requests `maintain` reports. */
  public openRequestCount: number | null = null;
  /** Number of upcoming `find` calls that report the code as already used. */
  public takenCodeLookups = 0;
  /** Operations that fail with an error while the name is in the set. */
  public readonly failures = new Set<string>();

  /** Throws when the named operation was set to fail. */
  public failIfRequested(operation: string): void {
    if (this.failures.has(operation)) {
      throw new Error(`The ${operation} call failed.`);
    }
  }

  /** Copies the state a transaction may have to restore. */
  public snapshot(): StoreSnapshot {
    return {
      preferences: new Map(this.preferences),
      requests: new Map(this.requests),
      tokenOfRequest: new Map(this.tokenOfRequest),
      tokens: new Map(
        [...this.tokens].map(([id, token]) => [id, { ...token }]),
      ),
    };
  }

  /** Puts a snapshot back. */
  public restore(snapshot: StoreSnapshot): void {
    this.preferences = snapshot.preferences;
    this.requests = snapshot.requests;
    this.tokenOfRequest = snapshot.tokenOfRequest;
    this.tokens = snapshot.tokens;
  }
}

/** Pairing requests, accounts and preferences on a memory store. */
export class MemoryPairingRepository extends PairingRepository {
  private readonly store: MemoryPairingStore;

  /** Creates the fake on a shared store. */
  public constructor(store: MemoryPairingStore) {
    super(UNUSED_DATABASE);
    this.store = store;
  }

  /** Runs the work and restores the state when it throws. */
  public override async transaction<Result>(
    work: (repository: PairingRepository) => Promise<Result>,
  ): Promise<Result> {
    const snapshot = this.store.snapshot();

    try {
      return await work(this);
    } catch (error: unknown) {
      this.store.restore(snapshot);

      throw error;
    }
  }

  /** Returns the credential repository on the same store. */
  public override tokens(): PersonalAgentTokenRepository {
    return new MemoryTokenRepository(this.store);
  }

  /** Returns the preference repository on the same store. */
  public override preferences(): PairingPreferenceRepository {
    return new MemoryPreferenceRepository(this.store);
  }

  /** Stores the item; fails when `insert` calls were set to fail. */
  public override async insert(request: StoredPairingRequest): Promise<void> {
    this.store.writes.push("insert");
    this.store.failIfRequested("insert");
    this.store.requests.set(request.id, request);
  }

  /** Looks a request up by code hash; honors `takenCodeLookups`. */
  public override async find(
    codeHash: string,
  ): Promise<StoredPairingRequest | null> {
    this.store.lookups.push(codeHash);

    if (this.store.takenCodeLookups > 0) {
      this.store.takenCodeLookups -= 1;

      return this.anyRequest();
    }

    return (
      [...this.store.requests.values()].find(
        (request) => request.codeHash === codeHash,
      ) ?? null
    );
  }

  /** Binds the pending request to the viewing account. */
  public override async bind(
    id: string,
    csrfHash: string,
    userId: string,
  ): Promise<void> {
    this.store.writes.push("bind");
    this.change(id, ["pending"], { csrfHash, userId });
  }

  /** Applies a decision to a pending request. */
  public override async decide(request: StoredPairingRequest): Promise<void> {
    this.store.writes.push("decide");
    this.change(request.id, ["pending"], {
      csrfHash: null,
      decidedAt: request.decidedAt,
      expiresAt: request.expiresAt,
      name: request.name,
      status: request.status,
      userId: request.userId,
      validitySeconds: request.validitySeconds,
    });
  }

  /** Ends a pending or approved request. */
  public override async complete(
    id: string,
    status: "consumed" | "cancelled" | "expired",
    tokenId: string | null = null,
  ): Promise<void> {
    this.store.writes.push(`complete:${status}`);
    this.store.failIfRequested("complete");
    this.change(id, ["pending", "approved"], { csrfHash: null, status });

    if (tokenId !== null) {
      this.store.tokenOfRequest.set(id, tokenId);
    }
  }

  /** Records the polling time and interval. */
  public override async poll(
    id: string,
    now: number,
    interval: number,
  ): Promise<void> {
    this.store.writes.push("poll");
    this.change(id, null, { lastPollAt: now, pollInterval: interval });
  }

  /** Reads the account row. */
  public override async account(userId: string): Promise<{
    displayName: string;
    username: string;
    isEligible: boolean;
  } | null> {
    return this.store.accounts.get(userId) ?? null;
  }

  /** Counts open requests, or the configured count. */
  public override async maintain(now: number): Promise<number> {
    this.store.writes.push("maintain");

    if (this.store.openRequestCount !== null) {
      return this.store.openRequestCount;
    }

    return [...this.store.requests.values()].filter(
      (request) =>
        (request.status === "pending" || request.status === "approved") &&
        request.expiresAt > now,
    ).length;
  }

  private anyRequest(): StoredPairingRequest {
    const [first] = this.store.requests.values();

    return (
      first ?? {
        clientName: "occupied",
        codeHash: "occupied",
        createdAt: 0,
        csrfHash: null,
        decidedAt: null,
        device: "occupied",
        expiresAt: 0,
        id: "occupied",
        lastPollAt: null,
        name: null,
        packageVersion: "0",
        pollInterval: 5,
        secretHash: "occupied",
        status: "consumed",
        userId: null,
        validitySeconds: null,
      }
    );
  }

  private change(
    id: string,
    allowedStatuses: readonly string[] | null,
    changes: Partial<StoredPairingRequest>,
  ): void {
    const request = this.store.requests.get(id);

    if (
      request === undefined ||
      (allowedStatuses !== null && !allowedStatuses.includes(request.status))
    ) {
      return;
    }

    this.store.requests.set(id, { ...request, ...changes });
  }
}

/** Validity preference on a memory store. */
class MemoryPreferenceRepository extends PairingPreferenceRepository {
  private readonly store: MemoryPairingStore;

  /** Creates the fake on a shared store. */
  public constructor(store: MemoryPairingStore) {
    super(UNUSED_DATABASE);
    this.store = store;
  }

  /** Reads the preference, thirty days by default. */
  public override async get(userId: string): Promise<number> {
    return this.store.preferences.get(userId) ?? 30;
  }

  /** Stores the preference and notes the clock value. */
  public override async set(
    userId: string,
    days: number,
    now: number,
  ): Promise<void> {
    this.store.writes.push("preferences.set");
    this.store.preferences.set(userId, days);
    this.store.preferenceWrites.push({ days, now, userId });
  }
}

function isValidAt(token: MemoryToken, now: number): boolean {
  const { expiresAt, revokedAt } = token.summary;

  return revokedAt === null && (expiresAt === null || expiresAt > now);
}

function matchesHash(token: MemoryToken, hash: string, now: number): boolean {
  return (
    token.hash === hash ||
    (token.previousHash === hash && token.previousValidUntil > now)
  );
}

/** Personal credentials on a memory store. */
export class MemoryTokenRepository extends PersonalAgentTokenRepository {
  private readonly store: MemoryPairingStore;

  /** Creates the fake on a shared store. */
  public constructor(store: MemoryPairingStore) {
    super(UNUSED_DATABASE);
    this.store = store;
  }

  /** Runs the work and restores the state when it throws. */
  public override async transaction<Result>(
    work: (repository: PersonalAgentTokenRepository) => Promise<Result>,
  ): Promise<Result> {
    const snapshot = this.store.snapshot();

    try {
      return await work(this);
    } catch (error: unknown) {
      this.store.restore(snapshot);

      throw error;
    }
  }

  /** Stores the item; fails when `insert` calls were set to fail. */
  public override async insert(
    token: StoredPersonalToken,
    tokenHash: string,
  ): Promise<void> {
    this.store.writes.push("tokens.insert");
    this.store.failIfRequested("tokens.insert");
    this.store.tokens.set(token.id, {
      hash: tokenHash,
      previousHash: null,
      previousValidUntil: 0,
      summary: token,
    });
  }

  /** Lists the summaries of one account, newest first. */
  public override async list(userId: string): Promise<StoredPersonalToken[]> {
    return [...this.store.tokens.values()]
      .map((token) => token.summary)
      .filter((summary) => summary.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  /** Resolves the owner of a currently valid hash. */
  public override async findOwner(
    tokenHash: string,
    now: number,
  ): Promise<string | null> {
    return (
      [...this.store.tokens.values()].find(
        (token) => matchesHash(token, tokenHash, now) && isValidAt(token, now),
      )?.summary.userId ?? null
    );
  }

  /** Revokes a credential of the given owner once. */
  public override async revoke(
    userId: string,
    id: string,
    now: number,
  ): Promise<void> {
    this.store.writes.push("tokens.revoke");
    const token = this.store.tokens.get(id);

    if (
      token === undefined ||
      token.summary.userId !== userId ||
      token.summary.revokedAt !== null
    ) {
      return;
    }

    token.previousHash = null;
    token.summary = {
      ...token.summary,
      revokedAt: now,
      rotationRequestedAt: null,
    };
  }

  /** Describes the credential of a currently valid hash. */
  public override async describe(
    tokenHash: string,
    now: number,
  ): Promise<StoredPersonalToken | null> {
    if ((await this.findOwner(tokenHash, now)) === null) {
      return null;
    }

    return (
      [...this.store.tokens.values()].find((token) =>
        matchesHash(token, tokenHash, now),
      )?.summary ?? null
    );
  }

  /** Records the use of a credential. */
  public override async used(tokenHash: string, now: number): Promise<void> {
    this.store.writes.push("tokens.used");

    for (const token of this.store.tokens.values()) {
      if (!matchesHash(token, tokenHash, now) || !isValidAt(token, now)) {
        continue;
      }

      const lastUsedAt = token.summary.lastUsedAt;

      if (lastUsedAt === null || lastUsedAt <= now - USAGE_RESOLUTION_MS) {
        token.summary = { ...token.summary, lastUsedAt: now };
      }

      if (token.hash === tokenHash) {
        token.previousHash = null;
      }
    }
  }

  /** Marks an active paired credential for rotation. */
  public override async requestRotation(
    userId: string,
    id: string,
    now: number,
  ): Promise<void> {
    this.store.writes.push("tokens.requestRotation");
    const token = this.store.tokens.get(id);

    if (
      token === undefined ||
      token.summary.userId !== userId ||
      token.summary.source !== "pairing" ||
      !isValidAt(token, now)
    ) {
      return;
    }

    token.summary = {
      ...token.summary,
      rotationRequestedAt: token.summary.rotationRequestedAt ?? now,
    };
  }

  /** Replaces the hash of a paired credential in place. */
  public override async replaceHash(
    currentHash: string,
    replacementHash: string,
    now: number,
  ): Promise<boolean> {
    this.store.writes.push("tokens.replaceHash");
    const token = [...this.store.tokens.values()].find(
      (candidate) => candidate.hash === currentHash,
    );

    if (
      token === undefined ||
      token.summary.source !== "pairing" ||
      !isValidAt(token, now)
    ) {
      return false;
    }

    token.hash = replacementHash;
    token.previousHash = currentHash;
    token.previousValidUntil = now + GRACE_PERIOD_MS;
    token.summary = {
      ...token.summary,
      rotatedAt: now,
      rotationRequestedAt: null,
    };

    return true;
  }
}
