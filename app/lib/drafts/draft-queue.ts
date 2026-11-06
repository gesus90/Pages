import { createRandomUuid } from "@/app/lib/random-uuid";

/** A confirmed write, a rejected write or a revision conflict. */
export type DraftAnswer<T> =
  | { readonly ok: true; readonly saved: T }
  | { readonly ok: false; readonly error: string; readonly current?: T };

/** Failures after which the server may or may not have committed the write. */
const UNCONFIRMED_ERRORS: ReadonlySet<string> = new Set([
  "connection",
  "backend",
]);

/** The longest wait before an unconfirmed write is sent again. */
const MAX_RETRY_DELAY_MS = 30_000;

/** One write, kept with its operation ID until the server confirmed or refused it. */
export interface DraftOperation<T> {
  readonly operationId: string;
  readonly base: T;
  readonly draft: T;
}

/** One attempt to send a write; a repeated attempt keeps the operation ID. */
export interface DraftAttempt<T> extends DraftOperation<T> {
  readonly id: string;
  readonly streamId: string;
  readonly sequence: number;
}

/** The state of one background edit, retained across route changes. */
export interface DraftEntry<T> {
  readonly id: string;
  readonly href: string;
  readonly label: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly base: T;
  readonly draft: T;
  readonly current?: T;
  readonly error: string | null;
  readonly isSaving: boolean;
  readonly hasChanges: boolean;
  readonly hasEdited: boolean;
  /** A started write that may have committed even when its response was lost. */
  readonly pending: DraftOperation<T> | null;
}

/** The domain-specific comparison, validation and persistence boundary. */
export interface DraftAdapter<T> {
  readonly delay: number | null;
  readonly equal: (left: T, right: T) => boolean;
  readonly validate: (draft: T) => string | null;
  readonly save: (attempt: DraftAttempt<T>) => Promise<DraftAnswer<T>>;
}

/** What survives a reload of an edit the server has not confirmed. */
export interface KeptDraft<T> {
  readonly href: string;
  readonly label: string;
  readonly base: T;
  readonly draft: T;
  readonly pending: DraftOperation<T> | null;
}

/** The browser storage of the account's unconfirmed edits. */
export interface DraftJournal<T> {
  readonly read: (id: string) => Promise<KeptDraft<T> | null>;
  readonly keep: (id: string, kept: KeptDraft<T>) => void;
  readonly drop: (id: string) => void;
}

/**
 * Serializes writes per object and keeps the latest desired edit on failure.
 *
 * @remarks
 * A write keeps its operation ID until the server confirmed or refused it.
 * When the answer is lost, the same write is sent again with the same ID,
 * automatically and before any later edit, so the server never applies it
 * twice and never mistakes it for somebody else's change. With a journal,
 * every edit the server has not confirmed is also kept in the browser.
 */
export class DraftQueue<T> {
  private readonly adapter: DraftAdapter<T>;
  private readonly journal: DraftJournal<T> | null;
  private readonly entries = new Map<string, DraftEntry<T>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly retryCounts = new Map<string, number>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private isActive = true;

  /** Creates an isolated queue; no state is shared between SSR requests. */
  public constructor(
    adapter: DraftAdapter<T>,
    journal: DraftJournal<T> | null = null,
  ) {
    this.adapter = adapter;
    this.journal = journal;
  }

  /** Subscribes React to immutable entry replacements. */
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Returns a stable snapshot token for useSyncExternalStore. */
  public readonly snapshot = (): number => this.version;

  /** Stops scheduled writes when this account's workspace is discarded. */
  public setActive(isActive: boolean): void {
    this.isActive = isActive;
    if (!isActive) {
      for (const id of this.timers.keys()) this.clearTimer(id);
      for (const id of this.retryTimers.keys()) this.clearRetry(id);
      this.requested.clear();
    }
  }

  /** Opens an object once; subsequent route loads never replace its draft. */
  public open(input: {
    readonly id: string;
    readonly href: string;
    readonly label: string;
    readonly saved: T;
  }): DraftEntry<T> {
    const existing = this.entries.get(input.id);
    if (existing) return existing;
    const entry: DraftEntry<T> = {
      ...input,
      streamId: createRandomUuid(),
      sequence: 0,
      base: input.saved,
      draft: input.saved,
      error: null,
      hasChanges: false,
      hasEdited: false,
      pending: null,
      isSaving: false,
    };
    this.entries.set(input.id, entry);
    return entry;
  }

  /**
   * Takes over an edit the browser kept from an earlier document, such as before a reload.
   *
   * @param id - The opened object.
   * @returns The kept draft when it was taken over, otherwise `null`.
   *
   * @remarks
   * Nothing happens once the object was edited in this document. A kept
   * unconfirmed write is sent again with its operation ID; a kept draft is
   * saved like a new edit, against the revision it started from, so a newer
   * saved version shows as a conflict instead of being overwritten.
   */
  public async recover(id: string): Promise<T | null> {
    if (!this.journal) return null;
    const kept = await this.journal.read(id);
    const entry = this.entries.get(id);
    if (!kept || !entry || entry.hasEdited || !this.isActive) return null;
    if (!kept.pending && this.adapter.equal(entry.base, kept.draft)) {
      this.journal.drop(id);
      return null;
    }
    this.replace({
      ...entry,
      href: kept.href,
      label: kept.label,
      base: kept.base,
      draft: kept.draft,
      pending: kept.pending,
      error: this.adapter.validate(kept.draft),
      hasChanges: true,
      hasEdited: true,
    });
    if (kept.pending || this.adapter.delay !== null) this.save(id);
    return kept.draft;
  }

  /** Sends every unconfirmed write again now, for example when the browser is back online. */
  public retryUnconfirmed(): void {
    for (const entry of this.entries.values()) {
      if (entry.pending && !entry.isSaving && !entry.current)
        this.save(entry.id);
    }
  }

  /** Returns every edited object for the global save indicator. */
  public list(): readonly DraftEntry<T>[] {
    return [...this.entries.values()];
  }

  /** Applies an edit immediately and schedules eligible automatic writes. */
  public change(id: string, draft: T): void {
    const entry = this.require(id);
    this.replace({
      ...entry,
      draft,
      error: entry.current ? entry.error : this.adapter.validate(draft),
      hasChanges:
        entry.pending !== null || !this.adapter.equal(entry.base, draft),
      hasEdited: true,
    });
    this.clearTimer(id);
    if (this.adapter.delay !== null) {
      this.timers.set(
        id,
        setTimeout(() => this.save(id), this.adapter.delay),
      );
    }
  }

  /** Requests a write; an active write always finishes before its successor. */
  public save(id: string): void {
    if (!this.isActive) return;
    this.clearTimer(id);
    this.clearRetry(id);
    const entry = this.require(id);
    if (entry.isSaving) {
      this.requested.add(id);
      return;
    }
    if (entry.current || !entry.hasChanges) return;
    const operation = entry.pending ?? this.nextOperation(entry);
    if (!operation) return;
    // The earlier write is settled first; the latest edit follows it.
    if (!this.adapter.equal(operation.draft, entry.draft))
      this.requested.add(id);
    const sent = { ...entry, sequence: entry.sequence + 1 };
    this.replace({
      ...sent,
      error: null,
      isSaving: true,
      pending: operation,
    });
    void this.write({
      ...operation,
      id,
      streamId: sent.streamId,
      sequence: sent.sequence,
    });
  }

  /** Resolves a conflict explicitly, retaining or discarding the local edit. */
  public resolve(id: string, choice: "mine" | "theirs"): void {
    const entry = this.require(id);
    if (!entry.current) return;
    const draft = choice === "mine" ? entry.draft : entry.current;
    this.replace({
      ...entry,
      base: entry.current,
      current: undefined,
      draft,
      error: null,
      hasChanges: !this.adapter.equal(entry.current, draft),
      pending: null,
    });
    if (choice === "mine") this.save(id);
  }

  /** Adopts confirmed loader data only while no local work is outstanding. */
  public adopt(id: string, saved: T): boolean {
    const entry = this.require(id);
    if (entry.hasChanges || entry.isSaving || entry.current || entry.pending)
      return false;
    this.replace({ ...entry, base: saved, draft: saved, error: null });
    return true;
  }

  private nextOperation(entry: DraftEntry<T>): DraftOperation<T> | null {
    const error = this.adapter.validate(entry.draft);
    if (error) {
      this.replace({ ...entry, error });
      return null;
    }
    return {
      operationId: createRandomUuid(),
      base: entry.base,
      draft: entry.draft,
    };
  }

  private async write(attempt: DraftAttempt<T>): Promise<void> {
    let answer: DraftAnswer<T>;
    try {
      answer = await this.adapter.save(attempt);
    } catch (error: unknown) {
      console.warn("Pages could not confirm a background save.", error);
      answer = { error: "connection", ok: false };
    }
    const latest = this.require(attempt.id);
    if (!this.isActive) return;
    const shouldContinue = this.requested.delete(attempt.id);
    if (!answer.ok) {
      this.settleFailure(latest, answer);
      return;
    }
    this.retryCounts.delete(attempt.id);
    const draft = this.adapter.equal(latest.draft, attempt.draft)
      ? answer.saved
      : latest.draft;
    const hasChanges = !this.adapter.equal(answer.saved, draft);
    this.replace({
      ...latest,
      base: answer.saved,
      draft,
      error: this.adapter.validate(draft),
      hasChanges,
      pending: null,
      isSaving: false,
    });
    if (hasChanges && (shouldContinue || this.adapter.delay !== null)) {
      this.save(attempt.id);
    }
  }

  /** Keeps a write whose outcome is unknown and sends it again later. */
  private settleFailure(
    latest: DraftEntry<T>,
    answer: { readonly error: string; readonly current?: T },
  ): void {
    this.clearTimer(latest.id);
    const isUnconfirmed = UNCONFIRMED_ERRORS.has(answer.error);
    this.replace({
      ...latest,
      current: answer.current,
      error: answer.error,
      isSaving: false,
      pending: isUnconfirmed ? latest.pending : null,
    });
    if (!isUnconfirmed) return;
    const count = (this.retryCounts.get(latest.id) ?? 0) + 1;
    this.retryCounts.set(latest.id, count);
    this.retryTimers.set(
      latest.id,
      setTimeout(
        () => this.save(latest.id),
        Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** count),
      ),
    );
  }

  private require(id: string): DraftEntry<T> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("The draft must be opened before editing.");
    return entry;
  }

  private replace(entry: DraftEntry<T>): void {
    this.entries.set(entry.id, entry);
    this.version += 1;
    this.record(entry);
    for (const listener of this.listeners) listener();
  }

  /** Keeps what the server has not confirmed and forgets what it has. */
  private record(entry: DraftEntry<T>): void {
    if (!this.journal || !entry.hasEdited || !this.isActive) return;
    if (entry.hasChanges || entry.pending || entry.current) {
      this.journal.keep(entry.id, {
        href: entry.href,
        label: entry.label,
        base: entry.base,
        draft: entry.draft,
        pending: entry.pending,
      });
    } else {
      this.journal.drop(entry.id);
    }
  }

  private clearTimer(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  private clearRetry(id: string): void {
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
  }
}
