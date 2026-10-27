import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled, so register React DOM cleanup explicitly.
afterEach(cleanup);

const MEASURED_WIDTH = 200;
const MEASURED_HEIGHT = 100;

/** Reports a fixed size once, after the first layout, as a browser would. */
class MeasuringResizeObserver {
  private readonly callback: ResizeObserverCallback;

  /** Remembers the callback that receives the measurements. */
  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  /** Reports the fixed size of the target asynchronously, so a flow has its container by then. */
  public observe(target: Element): void {
    setTimeout(() => {
      const rect = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: MEASURED_WIDTH,
        bottom: MEASURED_HEIGHT,
        width: MEASURED_WIDTH,
        height: MEASURED_HEIGHT,
      };
      const size = [{ inlineSize: MEASURED_WIDTH, blockSize: MEASURED_HEIGHT }];
      this.callback(
        [
          {
            target,
            contentRect: { ...rect, toJSON: () => rect },
            borderBoxSize: size,
            contentBoxSize: size,
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      );
    }, 0);
  }

  /** Nothing to release; the measurement is a one-time report. */
  public unobserve(): void {}

  /** Nothing to release; the measurement is a one-time report. */
  public disconnect(): void {}
}

// jsdom measures nothing; React Flow needs sizes to show its nodes and edges.
globalThis.ResizeObserver = MeasuringResizeObserver;
globalThis.DOMMatrixReadOnly ??= class {
  public m22 = 1;
} as unknown as typeof DOMMatrixReadOnly;
for (const [name, value] of [
  ["offsetWidth", MEASURED_WIDTH],
  ["offsetHeight", MEASURED_HEIGHT],
] as const)
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get: () => value,
  });

/** A media query that never matches and never changes, as a quiet desktop browser reports. */
class StaticMediaQueryList extends EventTarget implements MediaQueryList {
  public readonly matches = false;
  public readonly media: string;
  public onchange: MediaQueryList["onchange"] = null;

  /** Remembers the query text that `media` reports. */
  public constructor(media: string) {
    super();
    this.media = media;
  }

  /** The deprecated listener API is not used; the change event goes through `addEventListener`. */
  public addListener(): void {}

  /** The deprecated listener API is not used; the change event goes through `removeEventListener`. */
  public removeListener(): void {}
}

// jsdom has neither media queries nor the font loading API; the scroll edges of every viewport observe both.
window.matchMedia = (query: string): MediaQueryList =>
  new StaticMediaQueryList(query);
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: new EventTarget(),
});

// jsdom does not implement scrolling; pickers scroll their active option into view.
Element.prototype.scrollIntoView ??= (): void => {};
