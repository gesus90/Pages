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
