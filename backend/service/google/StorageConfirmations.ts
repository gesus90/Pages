import { randomBytes } from "node:crypto";

import type {
  StorageConfirmableAction,
  StorageConfirmation,
  StorageEntry,
  StorageScope,
} from "@/definition/GoogleDriveFiles";

/** A confirmation is refused after this time. */
const CONFIRMATION_LIFETIME_MS = 10 * 60 * 1000;

/** At most this many open confirmations live in process memory. */
const MAXIMUM_OPEN_CONFIRMATIONS = 1000;

/** What one confirmation was issued for. */
export interface ConfirmationBinding {
  readonly userId: string;
  readonly action: StorageConfirmableAction;
  readonly entry: StorageEntry;
  readonly scope: StorageScope | null;
}

/** One open confirmation. */
interface StoredConfirmation {
  readonly userId: string;
  readonly action: StorageConfirmableAction;
  readonly ref: string;
  /** Version, change time and folder scope at the time of issue. */
  readonly state: string;
  readonly expiresAt: number;
}

function stateOf(entry: StorageEntry, scope: StorageScope | null): string {
  return JSON.stringify([
    entry.version,
    entry.modifiedAt,
    entry.isTrashed,
    scope?.folderCount ?? null,
    scope?.fileCount ?? null,
    scope?.totalBytes ?? null,
  ]);
}

/**
 * The one-time confirmations of destructive Storage actions (PAGE-270).
 *
 * @remarks
 * A confirmation lives only on the server and is bound to the account, the
 * action, the object and its state when it was shown: Drive's version and
 * change time and, for a folder, the counted scope. Any change of the object
 * in between, another action, another object or another account refuses it,
 * and the first use spends it. The token is random and carries no content.
 */
export class StorageConfirmations {
  private readonly open = new Map<string, StoredConfirmation>();
  private readonly now: () => number;

  /**
   * Creates the store.
   *
   * @param now - The clock.
   */
  public constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Issues a confirmation for what the person is shown right now.
   *
   * @param binding - Account, action, object and scope.
   * @returns The confirmation to show and send back.
   */
  public issue(binding: ConfirmationBinding): StorageConfirmation {
    this.prune();

    const token = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + CONFIRMATION_LIFETIME_MS;

    this.open.set(token, {
      action: binding.action,
      expiresAt,
      ref: binding.entry.ref,
      state: stateOf(binding.entry, binding.scope),
      userId: binding.userId,
    });

    return {
      action: binding.action,
      expiresAt: new Date(expiresAt).toISOString(),
      scope: binding.scope,
      target: binding.entry,
      token,
    };
  }

  /**
   * Spends a confirmation when it matches exactly what is about to happen.
   *
   * @param token - The token the client sent back.
   * @param binding - Account, action, object and its current scope.
   * @returns Whether the action may run now.
   */
  public consume(token: string, binding: ConfirmationBinding): boolean {
    const stored = this.open.get(token);

    if (!stored || stored.userId !== binding.userId) {
      return false;
    }

    this.open.delete(token);

    return (
      stored.expiresAt > this.now() &&
      stored.action === binding.action &&
      stored.ref === binding.entry.ref &&
      stored.state === stateOf(binding.entry, binding.scope)
    );
  }

  private prune(): void {
    const now = this.now();

    for (const [token, stored] of this.open) {
      if (stored.expiresAt <= now) {
        this.open.delete(token);
      }
    }

    while (this.open.size >= MAXIMUM_OPEN_CONFIRMATIONS) {
      const oldest = this.open.keys().next();

      if (oldest.done === true) {
        return;
      }

      this.open.delete(oldest.value);
    }
  }
}
