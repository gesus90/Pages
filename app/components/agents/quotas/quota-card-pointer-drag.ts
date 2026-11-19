/** Pixels the pointer travels before a press on a handle becomes a drag. */
const DRAG_THRESHOLD_PIXELS = 4;

/** Distance from the edge of the scroll area in which a drag scrolls it. */
const SCROLL_EDGE_PIXELS = 80;

/** Most pixels one frame scrolls, at the very edge. */
const SCROLL_STEP_PIXELS = 18;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ScrollBounds {
  readonly top: number;
  readonly bottom: number;
}

/** The press that starts a drag. */
export interface PointerDragStart {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** What a drag needs to know about the grid and whom it tells. */
export interface PointerDragOptions {
  readonly start: PointerDragStart;
  /** The element of the card that is dragged. */
  readonly card: HTMLElement;
  /** The elements of all cards in display order, the dragged one included. */
  readonly cells: () => readonly HTMLElement[];
  /** The pointer has travelled far enough: the card is picked up. */
  readonly onStart: () => void;
  /** The card now hovers over another place of the grid. */
  readonly onTarget: (index: number) => void;
  /** The drag ended; `null` when it was cancelled or never started. */
  readonly onEnd: (targetIndex: number | null) => void;
}

function scrollParentOf(element: HTMLElement): Element {
  for (
    let parent = element.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    const { overflowY } = getComputedStyle(parent);
    const isScrollArea = overflowY === "auto" || overflowY === "scroll";
    if (isScrollArea && parent.scrollHeight > parent.clientHeight)
      return parent;
  }
  return document.scrollingElement ?? document.documentElement;
}

function scrollSpeed(distanceToEdge: number): number {
  const closeness = 1 - Math.max(distanceToEdge, 0) / SCROLL_EDGE_PIXELS;
  return Math.ceil(SCROLL_STEP_PIXELS * closeness);
}

/** How far to scroll in one frame: up is negative, 0 away from both edges. */
function edgeScrollStep(pointerY: number, bounds: ScrollBounds): number {
  const fromTop = pointerY - bounds.top;
  const fromBottom = bounds.bottom - pointerY;
  if (fromTop < SCROLL_EDGE_PIXELS) return -scrollSpeed(fromTop);
  if (fromBottom < SCROLL_EDGE_PIXELS) return scrollSpeed(fromBottom);
  return 0;
}

function centerOf(rect: DOMRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The drag of one quota card by pointer: mouse, finger or pen.
 * @remarks
 * The card follows the pointer through a transform, so it stays in its
 * place in the grid and nothing else moves while it is dragged. The place it
 * would take is the cell whose centre is nearest to the centre of the dragged
 * card; the grid shows it, and the cards change places only when the card is
 * put down. The listeners stand on the window, so they keep working while
 * the page re-renders the grid. Near the top or bottom edge of the scroll
 * area the drag scrolls it. Escape and a cancelled pointer end the drag
 * without a move.
 */
export class QuotaCardPointerDrag {
  private readonly options: PointerDragOptions;
  private readonly startRect: DOMRect;
  private readonly scroller: Element;
  private readonly handleMove: (event: PointerEvent) => void;
  private readonly handleEnd: (event: PointerEvent) => void;
  private readonly handleKey: (event: KeyboardEvent) => void;
  private readonly tick: () => void;
  private pointer: Point;
  private translation: Point = { x: 0, y: 0 };
  private targetIndex: number;
  private isActive = false;
  private isEnded = false;
  private frame = 0;

  public constructor(options: PointerDragOptions) {
    this.options = options;
    this.startRect = options.card.getBoundingClientRect();
    this.scroller = scrollParentOf(options.card);
    this.pointer = { x: options.start.clientX, y: options.start.clientY };
    this.targetIndex = options.cells().indexOf(options.card);
    this.handleMove = (event) => this.moveTo(event);
    this.handleEnd = (event) => this.endWith(event);
    this.handleKey = (event) => {
      if (event.key === "Escape") this.finish(null);
    };
    this.tick = () => this.scrollAtEdge();
  }

  /** Starts to listen; the card is picked up once the pointer has travelled. */
  public begin(): void {
    window.addEventListener("pointermove", this.handleMove);
    window.addEventListener("pointerup", this.handleEnd);
    window.addEventListener("pointercancel", this.handleEnd);
    window.addEventListener("keydown", this.handleKey);
  }

  /** Ends the drag without a move, for example when the page closes. */
  public cancel(): void {
    this.finish(null);
  }

  private moveTo(event: PointerEvent): void {
    if (event.pointerId !== this.options.start.pointerId) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (!this.isActive) {
      const { start } = this.options;
      const travelled = Math.hypot(
        this.pointer.x - start.clientX,
        this.pointer.y - start.clientY,
      );
      if (travelled < DRAG_THRESHOLD_PIXELS) return;
      this.isActive = true;
      this.options.onStart();
      this.frame = requestAnimationFrame(this.tick);
    }
    this.follow();
  }

  private endWith(event: PointerEvent): void {
    if (event.pointerId !== this.options.start.pointerId) return;
    this.finish(event.type === "pointerup" ? this.targetIndex : null);
  }

  private finish(targetIndex: number | null): void {
    if (this.isEnded) return;
    this.isEnded = true;
    window.removeEventListener("pointermove", this.handleMove);
    window.removeEventListener("pointerup", this.handleEnd);
    window.removeEventListener("pointercancel", this.handleEnd);
    window.removeEventListener("keydown", this.handleKey);
    cancelAnimationFrame(this.frame);
    this.options.card.style.transform = "";
    this.options.onEnd(this.isActive ? targetIndex : null);
  }

  private scrollAtEdge(): void {
    this.frame = requestAnimationFrame(this.tick);
    const step = edgeScrollStep(this.pointer.y, this.scrollBounds());
    if (step === 0) return;
    this.scroller.scrollBy(0, step);
    this.follow();
  }

  private scrollBounds(): ScrollBounds {
    const viewportBottom = window.innerHeight;
    if (this.scroller === document.scrollingElement)
      return { top: 0, bottom: viewportBottom };
    const rect = this.scroller.getBoundingClientRect();
    return {
      top: Math.max(rect.top, 0),
      bottom: Math.min(rect.bottom, viewportBottom),
    };
  }

  /**
   * Keeps the card under the pointer where it was grabbed, whatever the
   * scroll area did meanwhile, and tells when it hovers over another place.
   */
  private follow(): void {
    const { card, start, onTarget } = this.options;
    const rect = card.getBoundingClientRect();
    const layout = {
      x: rect.left - this.translation.x,
      y: rect.top - this.translation.y,
    };
    const grabbed = {
      x: this.startRect.left + this.pointer.x - start.clientX,
      y: this.startRect.top + this.pointer.y - start.clientY,
    };
    const x = grabbed.x - layout.x;
    const y = grabbed.y - layout.y;
    this.translation = { x, y };
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const nearest = this.nearestCellIndex();
    if (nearest === this.targetIndex) return;
    this.targetIndex = nearest;
    onTarget(nearest);
  }

  private nearestCellIndex(): number {
    const { card, cells } = this.options;
    const dragged = centerOf(card.getBoundingClientRect());
    let nearest = this.targetIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [index, cell] of cells().entries()) {
      const center = centerOf(cell.getBoundingClientRect());
      // The dragged card's own cell lies where the card would be without its transform.
      const isOwn = cell === card;
      const distance = Math.hypot(
        dragged.x - (isOwn ? center.x - this.translation.x : center.x),
        dragged.y - (isOwn ? center.y - this.translation.y : center.y),
      );
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearest;
  }
}
