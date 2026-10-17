import { logEvent } from "@/backend/logging/Logger";
import { readSlowOperationThresholdMs } from "@/backend/logging/LogTiming";

import type { ServerResponse } from "node:http";
import type { DatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import type { RouteLogMetrics } from "@/backend/logging/RouteLogMetrics";

/** Safe request facts without raw URLs, headers or payloads. */
export interface RequestLogDetails {
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly isPolling: boolean;
}

/** Counters stay request-scoped even when a successful poll discards its summary. */
export interface RequestLogCounters {
  readonly database: DatabaseLogMetrics;
  readonly routes: RouteLogMetrics;
}

/** Reports request outcomes while keeping successful, fast status polling silent. */
export class RequestLogLifecycle {
  private readonly details: RequestLogDetails;
  private readonly counters: RequestLogCounters;
  private readonly confirmAuthorization: () => void;
  private readonly started = performance.now();
  private isFinished = false;

  /** Keeps all mutable completion state isolated to one HTTP response. */
  public constructor(
    details: RequestLogDetails,
    counters: RequestLogCounters,
    confirmAuthorization: () => void,
  ) {
    this.details = details;
    this.counters = counters;
    this.confirmAuthorization = confirmAuthorization;
  }

  /** Observes both completed and disconnected responses without reading their bodies. */
  public observe(response: ServerResponse): void {
    response.setHeader("X-Request-ID", this.details.requestId);
    if (!this.details.isPolling)
      logEvent({
        level: "info",
        event: "http.request.started",
        component: "PagesServer",
        message: "HTTP request started",
        metadata: this.facts(),
      });
    response.once("finish", () => this.complete(response.statusCode));
    response.once("close", () => this.abort());
  }

  private facts(): Readonly<Record<string, unknown>> {
    const { requestId, method, route } = this.details;
    return { requestId, method, route };
  }

  private summary(durationMs: number): Readonly<Record<string, unknown>> {
    return {
      ...this.facts(),
      durationMs,
      ...this.counters.database.finish(),
      ...this.counters.routes.finish(),
    };
  }

  private complete(statusCode: number): void {
    this.isFinished = true;
    const durationMs = performance.now() - this.started;
    const metadata = { ...this.summary(durationMs), statusCode };
    const isSlow = durationMs >= readSlowOperationThresholdMs();
    const isSuccess = statusCode >= 200 && statusCode < 400;
    if (!this.details.isPolling || !isSuccess || isSlow)
      logEvent({
        level: this.completionLevel(statusCode, isSlow),
        event: "http.request.completed",
        component: "PagesServer",
        message: "HTTP request completed",
        metadata,
      });
    if (isSuccess) this.confirmAuthorization();
    if (statusCode === 401 || statusCode === 403)
      logEvent({
        level: "warn",
        event: "authorization.http.denied",
        component: "PagesServer",
        message: "HTTP access denied",
        metadata: { ...this.facts(), statusCode },
      });
  }

  private completionLevel(
    statusCode: number,
    isSlow: boolean,
  ): "error" | "warn" | "info" {
    if (statusCode >= 500) return "error";
    if (this.details.isPolling && (statusCode >= 400 || isSlow)) return "warn";
    return "info";
  }

  private abort(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    logEvent({
      level: "warn",
      event: "http.request.aborted",
      component: "PagesServer",
      message: "HTTP connection closed before response completion",
      metadata: this.summary(performance.now() - this.started),
    });
  }
}
