import { expect, it } from "vitest";

import {
  RouteLogMetrics,
  recordRouteEnd,
  recordRouteStart,
  withRouteLogMetrics,
} from "./RouteLogMetrics";

it("counts loaders and actions while the request is open", () => {
  const metrics = new RouteLogMetrics();

  expect(metrics.start("loader")).toBe(true);
  expect(metrics.start("loader")).toBe(true);
  expect(metrics.start("action")).toBe(true);

  expect(metrics.finish()).toMatchObject({
    routeLoaders: 2,
    routeActions: 1,
  });
});

it("summarizes completed and failed handlers with the slowest route", () => {
  const metrics = new RouteLogMetrics();

  metrics.end("/projects", 12.3456, "completed");
  metrics.end("/tasks", 40, "failed");
  metrics.end("/wiki", 40, "completed");
  metrics.end("/health", 7, "completed");

  expect(metrics.finish()).toEqual({
    routeLoaders: 0,
    routeActions: 0,
    routeHandlersCompleted: 3,
    routeHandlersFailed: 1,
    routeHandlerTotalMs: 99.346,
    routeHandlerSlowestMs: 40,
    routeHandlerSlowest: "/tasks",
  });
});

it("reports no slowest route before any handler finished", () => {
  expect(new RouteLogMetrics().finish()).toMatchObject({
    routeHandlersCompleted: 0,
    routeHandlersFailed: 0,
    routeHandlerSlowest: null,
  });
});

it("rejects late starts and completions after the request finished", () => {
  const metrics = new RouteLogMetrics();
  metrics.end("/early", 1, "completed");
  metrics.finish();

  expect(metrics.start("loader")).toBe(false);
  expect(metrics.end("/late", 500, "failed")).toBe(false);
  expect(metrics.finish()).toMatchObject({
    routeHandlersFailed: 0,
    routeHandlerSlowest: "/early",
  });
});

it("isolates counters per request and refuses calls outside a request", () => {
  expect(recordRouteStart("loader")).toBe(false);
  expect(recordRouteEnd("/outside", 1, "completed")).toBe(false);

  const firstRequestSummary = withRouteLogMetrics((metrics) => {
    recordRouteStart("action");
    recordRouteEnd("/first", 3, "failed");
    return metrics.finish();
  });
  const secondRequestSummary = withRouteLogMetrics((metrics) => {
    recordRouteStart("loader");
    return metrics.finish();
  });

  expect(firstRequestSummary).toMatchObject({
    routeActions: 1,
    routeHandlersFailed: 1,
    routeHandlerSlowest: "/first",
  });
  expect(secondRequestSummary).toMatchObject({
    routeLoaders: 1,
    routeHandlersFailed: 0,
  });
});
