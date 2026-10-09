import type { Range } from "@tiptap/core";

/** What an open suggestion menu shows. */
export interface SuggestionSnapshot<Item> {
  readonly items: readonly Item[];
  readonly activeIndex: number;
  readonly query: string;
  readonly range: Range;
  /** Where the trigger text is on screen, to place the menu below it. */
  readonly rect: DOMRect | null;
}

/** What the suggestion plugin reports when the menu opens or changes. */
export interface SuggestionUpdate<Item> {
  readonly items: readonly Item[];
  readonly query: string;
  readonly range: Range;
  readonly clientRect?: (() => DOMRect | null) | null;
  readonly command: (item: Item) => void;
}

/**
 * Keeps the state of one suggestion menu between the editor plugin, which
 * reports typing, and the React menu, which renders it.
 *
 * @remarks
 * Keys are routed here while the menu is open: arrows move the highlight,
 * Enter and Tab choose, Escape closes. Everything else goes on to the
 * editor, so typing continues to filter the menu.
 */
export class SuggestionStore<Item> {
  private snapshot: SuggestionSnapshot<Item> | null = null;
  private choose: ((item: Item) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly isEnabled: (item: Item) => boolean;

  /**
   * Creates a store.
   *
   * @param isEnabled - Tells whether an item can be chosen.
   */
  public constructor(isEnabled: (item: Item) => boolean = () => true) {
    this.isEnabled = isEnabled;
  }

  /**
   * Registers a listener for changes, as `useSyncExternalStore` expects.
   *
   * @param listener - Called after every change.
   * @returns A function that removes the listener.
   */
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Reads the current state.
   *
   * @returns The open menu, or `null` while it is closed.
   */
  public readonly getSnapshot = (): SuggestionSnapshot<Item> | null =>
    this.snapshot;

  /**
   * Opens the menu or shows new items.
   *
   * @param update - What the plugin reports.
   */
  public show(update: SuggestionUpdate<Item>): void {
    const previous = this.snapshot;
    const activeIndex =
      previous && previous.query === update.query ? previous.activeIndex : 0;

    this.choose = update.command;
    this.set({
      activeIndex: Math.min(activeIndex, Math.max(update.items.length - 1, 0)),
      items: update.items,
      query: update.query,
      range: update.range,
      rect: update.clientRect?.() ?? null,
    });
  }

  /** Closes the menu. */
  public hide(): void {
    this.choose = null;
    this.set(null);
  }

  /**
   * Chooses an item, as a click or Enter does.
   *
   * @param index - Position of the item.
   * @returns Whether an enabled item was chosen.
   */
  public pick(index: number): boolean {
    const item = this.snapshot?.items[index];

    if (item === undefined || !this.isEnabled(item) || !this.choose) {
      return false;
    }

    this.choose(item);

    return true;
  }

  /**
   * Highlights an item.
   *
   * @param index - Position of the item.
   */
  public highlight(index: number): void {
    if (this.snapshot && index >= 0 && index < this.snapshot.items.length) {
      this.set({ ...this.snapshot, activeIndex: index });
    }
  }

  /**
   * Handles a key while the menu is open.
   *
   * @param event - The key event of the editor.
   * @returns Whether the menu used the key.
   */
  public handleKey(event: KeyboardEvent): boolean {
    const snapshot = this.snapshot;

    if (!snapshot) {
      return false;
    }

    const count = snapshot.items.length;

    switch (event.key) {
      case "ArrowDown":
        this.highlight(count === 0 ? 0 : (snapshot.activeIndex + 1) % count);

        return true;
      case "ArrowUp":
        this.highlight(
          count === 0 ? 0 : (snapshot.activeIndex - 1 + count) % count,
        );

        return true;
      case "Enter":
      case "Tab":
        return this.pick(snapshot.activeIndex);
      case "Escape":
        this.hide();

        return true;
      default:
        return false;
    }
  }

  private set(snapshot: SuggestionSnapshot<Item> | null): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
