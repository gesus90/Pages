import { createRandomUuid } from "@/app/lib/random-uuid";

/** A confirmed write, a rejected write or a revision conflict. */
export type DraftAnswer<T> =
  | { readonly ok: true; readonly saved: T }
  | { readonly ok: false; readonly error: string; readonly current?: T };

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
  /** A started write may have committed even when its response was lost. */
  readonly hasUnconfirmedWrite: boolean;
}

/** The domain-specific comparison, validation and persistence boundary. */
export interface DraftAdapter<T> {
  readonly delay: number | null;
  readonly equal: (left: T, right: T) => boolean;
  readonly validate: (draft: T) => string | null;
  readonly save: (entry: DraftEntry<T>) => Promise<DraftAnswer<T>>;
}

/** Serializes writes per object and keeps the latest desired edit on failure. */
export class DraftQueue<T> {
  private readonly adapter: DraftAdapter<T>;
  private readonly entries = new Map<string, DraftEntry<T>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private isActive = true;

  /** Creates an isolated queue; no state is shared between SSR requests. */
  public constructor(adapter: DraftAdapter<T>) {
    this.adapter = adapter;
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
      hasUnconfirmedWrite: false,
      isSaving: false,
    };
    this.entries.set(input.id, entry);
    return entry;
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
        entry.hasUnconfirmedWrite || !this.adapter.equal(entry.base, draft),
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
    const entry = this.require(id);
    if (entry.isSaving) {
      this.requested.add(id);
      return;
    }
    if (entry.current || !entry.hasChanges) return;
    const error = this.adapter.validate(entry.draft);
    if (error) {
      this.replace({ ...entry, error });
      return;
    }
    const sent = { ...entry, sequence: entry.sequence + 1 };
    this.replace({
      ...sent,
      error: null,
      isSaving: true,
      hasUnconfirmedWrite: true,
    });
    void this.write(sent);
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
      hasUnconfirmedWrite: false,
    });
    if (choice === "mine") this.save(id);
  }

  /** Adopts confirmed loader data only while no local work is outstanding. */
  public adopt(id: string, saved: T): boolean {
    const entry = this.require(id);
    if (entry.hasChanges || entry.isSaving || entry.current) return false;
    this.replace({ ...entry, base: saved, draft: saved, error: null });
    return true;
  }

  private async write(sent: DraftEntry<T>): Promise<void> {
    let answer: DraftAnswer<T>;
    try {
      answer = await this.adapter.save(sent);
    } catch (error: unknown) {
      console.warn("Pages could not confirm a background save.", error);
      answer = { error: "connection", ok: false };
    }
    const latest = this.require(sent.id);
    if (!this.isActive) return;
    const shouldContinue = this.requested.delete(sent.id);
    if (!answer.ok) {
      this.clearTimer(sent.id);
      this.replace({
        ...latest,
        current: answer.current,
        error: answer.error,
        isSaving: false,
      });
      return;
    }
    const draft = this.adapter.equal(latest.draft, sent.draft)
      ? answer.saved
      : latest.draft;
    const hasChanges = !this.adapter.equal(answer.saved, draft);
    this.replace({
      ...latest,
      base: answer.saved,
      draft,
      error: this.adapter.validate(draft),
      hasChanges,
      hasUnconfirmedWrite: false,
      isSaving: false,
    });
    if (hasChanges && (shouldContinue || this.adapter.delay !== null)) {
      this.save(sent.id);
    }
  }

  private require(id: string): DraftEntry<T> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("The draft must be opened before editing.");
    return entry;
  }

  private replace(entry: DraftEntry<T>): void {
    this.entries.set(entry.id, entry);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private clearTimer(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}
