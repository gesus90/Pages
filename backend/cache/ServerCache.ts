import { LRUCache } from "lru-cache";

/**
 * Time-to-live values per cache entry group in milliseconds.
 *
 * @remarks
 * TTLs are deliberately short: event-based invalidation below is the
 * primary freshness mechanism, TTLs only bound worst-case staleness (for
 * example after background GitHub synchronization writes that bypass the
 * route actions).
 */
export const CACHE_TTLS = {
  assignees: 60_000,
  github: 30_000,
  labels: 120_000,
  labelUsage: 60_000,
  project: 60_000,
  projectsList: 60_000,
  statuses: 300_000,
  users: 120_000,
  workItems: 30_000,
} as const;

/** Aggregate counters describing server cache behavior. */
export interface ServerCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly invalidations: number;
  readonly entries: number;
}

/**
 * Joins identifiers into a stable cache key fragment.
 *
 * @param ids - Identifiers in any order; output order is normalized.
 */
export function stableIdKey(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/** Estimates the byte size of a cached value for quota enforcement. */
function estimateSizeInBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 64;
  } catch {
    return 1024;
  }
}

/**
 * Provides the bounded server-side memory cache between services and SQLite.
 *
 * @remarks
 * SQLite remains the source of truth: entries carry short TTLs and mutations
 * invalidate their groups granularly through the helpers below. The cache
 * never stores unbounded collections under a single key scheme like
 * `database:everything`.
 */
export class ServerCache {
  private readonly cache: LRUCache<string, object>;
  private readonly enabled: boolean;
  private readonly debug: boolean;
  private hits = 0;
  private misses = 0;
  private invalidations = 0;

  /**
   * Creates a server cache.
   *
   * @param options - Quota, debug logging, or a disabled no-op instance.
   */
  public constructor(
    options: {
      readonly disabled?: boolean;
      readonly maxEntries?: number;
      readonly maxBytes?: number;
      readonly debug?: boolean;
    } = {},
  ) {
    this.enabled = options.disabled !== true;
    this.debug = options.debug ?? process.env.PAGES_CACHE_DEBUG === "1";
    this.cache = new LRUCache<string, object>({
      max: options.maxEntries ?? 500,
      maxSize: options.maxBytes ?? 30_000_000,
      sizeCalculation: (value) => estimateSizeInBytes(value),
    });
  }

  /** Creates a no-op cache for tests and cache-free contexts. */
  public static disabled(): ServerCache {
    return new ServerCache({ disabled: true });
  }

  /**
   * Returns the cached value or `undefined` on a miss or expiry.
   *
   * @param key - Fully qualified cache key.
   */
  public get<T extends object>(key: string): T | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const value = this.cache.get(key) as T | undefined;

    if (value === undefined) {
      this.misses += 1;
      this.log("MISS", key);
    } else {
      this.hits += 1;
      this.log("HIT", key);
    }

    return value;
  }

  /**
   * Stores a value with its group TTL.
   *
   * @param key - Fully qualified cache key.
   * @param value - JSON-compatible value to cache.
   * @param ttlMs - Time-to-live in milliseconds.
   */
  public set<T extends object>(key: string, value: T, ttlMs: number): void {
    if (!this.enabled) {
      return;
    }

    this.cache.set(key, value, { ttl: ttlMs });
  }

  /**
   * Removes exactly one cached entry.
   *
   * @param key - Fully qualified cache key.
   */
  public invalidateExact(key: string): void {
    if (!this.enabled) {
      return;
    }

    if (this.cache.delete(key)) {
      this.invalidations += 1;
      this.log("INVALIDATE", key);
    }
  }

  /**
   * Removes every cached entry below the given key prefixes.
   *
   * @remarks
   * Prefixes conventionally end with `:` (for example `projects:list:`),
   * so a single identifier can never accidentally match another entry.
   *
   * @param prefixes - Key prefixes whose entries are stale.
   */
  public invalidatePrefix(...prefixes: string[]): void {
    if (!this.enabled || prefixes.length === 0) {
      return;
    }

    for (const key of this.cache.keys()) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        this.cache.delete(key);
        this.invalidations += 1;
        this.log("INVALIDATE", key);
      }
    }
  }

  /** Returns a snapshot of the cache counters. */
  public readStats(): ServerCacheStats {
    return {
      entries: this.cache.size,
      hits: this.hits,
      invalidations: this.invalidations,
      misses: this.misses,
    };
  }

  /** Removes a project row and every listing that could contain it. */
  public invalidateProject(projectId: string): void {
    this.invalidateExact(`project:${projectId}`);
    this.invalidatePrefix("projects:list:");
  }

  /** Removes cached project listings (visibility or ordering may changed). */
  public invalidateProjectsList(): void {
    this.invalidatePrefix("projects:list:");
  }

  /** Removes cached project membership data (visibility and assignees). */
  public invalidateProjectMembership(): void {
    this.invalidatePrefix("projects:list:", "assignees:");
  }

  /** Removes cached work item queries (rows may have changed). */
  public invalidateWorkItems(): void {
    this.invalidatePrefix("workitems:");
  }

  /** Removes cached label catalogs and usage counts. */
  public invalidateLabels(): void {
    this.invalidatePrefix("labels:");
  }

  /** Removes cached assignee listings. */
  public invalidateAssignees(): void {
    this.invalidatePrefix("assignees:");
  }

  /** Removes cached user listings and derived assignee listings. */
  public invalidateUsers(): void {
    this.invalidatePrefix("users:", "assignees:");
  }

  /** Removes cached GitHub states. */
  public invalidateGitHub(): void {
    this.invalidatePrefix("github:");
  }

  private log(event: "HIT" | "MISS" | "INVALIDATE", key: string): void {
    if (this.debug) {
      console.debug(`[pages][cache] ${event} ${key}`);
    }
  }
}
