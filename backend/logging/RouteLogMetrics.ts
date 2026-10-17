import { AsyncLocalStorage } from "node:async_hooks";

interface RouteLogSummary {
  readonly routeLoaders: number;
  readonly routeActions: number;
  readonly routeHandlersCompleted: number;
  readonly routeHandlersFailed: number;
  readonly routeHandlerTotalMs: number;
  readonly routeHandlerSlowestMs: number;
  readonly routeHandlerSlowest: string | null;
}

const scope = new AsyncLocalStorage<RouteLogMetrics>();

/** Counts every production handler within its request instead of duplicating HTTP lifecycle records. */
export class RouteLogMetrics {
  private loaders = 0;
  private actions = 0;
  private completed = 0;
  private failed = 0;
  private totalMs = 0;
  private slowestMs = 0;
  private slowestRoute: string | null = null;
  private isClosed = false;

  /** Counts every loader/action start while its request remains open. */
  public start(kind: "loader" | "action"): boolean {
    if (this.isClosed) return false;
    if (kind === "loader") this.loaders += 1;
    else this.actions += 1;
    return true;
  }

  /** Records an outcome without retaining arguments, results or unbounded route lists. */
  public end(
    route: string,
    durationMs: number,
    outcome: "completed" | "failed",
  ): boolean {
    if (this.isClosed) return false;
    if (outcome === "completed") this.completed += 1;
    else this.failed += 1;
    this.totalMs += durationMs;
    if (this.slowestRoute === null || durationMs > this.slowestMs) {
      this.slowestMs = durationMs;
      this.slowestRoute = route;
    }
    return true;
  }

  /** Closes the request; late completions return to individual lifecycle logging. */
  public finish(): RouteLogSummary {
    this.isClosed = true;
    return {
      routeLoaders: this.loaders,
      routeActions: this.actions,
      routeHandlersCompleted: this.completed,
      routeHandlersFailed: this.failed,
      routeHandlerTotalMs: Math.round(this.totalMs * 1_000) / 1_000,
      routeHandlerSlowestMs: Math.round(this.slowestMs * 1_000) / 1_000,
      routeHandlerSlowest: this.slowestRoute,
    };
  }
}

/** Isolates counters for concurrently running HTTP requests. */
export function withRouteLogMetrics<Result>(
  work: (metrics: RouteLogMetrics) => Result,
): Result {
  const metrics = new RouteLogMetrics();
  return scope.run(metrics, () => work(metrics));
}

/** Returns whether the request aggregate accepted this handler start. */
export function recordRouteStart(kind: "loader" | "action"): boolean {
  return scope.getStore()?.start(kind) ?? false;
}

/** Returns whether the request aggregate accepted this handler outcome. */
export function recordRouteEnd(
  route: string,
  durationMs: number,
  outcome: "completed" | "failed",
): boolean {
  return scope.getStore()?.end(route, durationMs, outcome) ?? false;
}
