import { expect, it } from "vitest";

import { isForwardedRoute } from "./AppRouteMatch";

import type { AppRoute } from "./AppRouteMatch";

const ROUTES: readonly AppRoute[] = [
  { path: "/", isForwarded: false },
  { path: "/projects/:projectId", isForwarded: false },
  { path: "/download/:fileId", isForwarded: true },
];

it("forwards every method that can change state", () => {
  expect(isForwardedRoute(ROUTES, "POST", "/projects/1")).toBe(true);
  expect(isForwardedRoute(ROUTES, "DELETE", "/")).toBe(true);
});

it("forwards a data request even on a path the app renders", () => {
  expect(isForwardedRoute(ROUTES, "GET", "/projects/1.data")).toBe(true);
});

it("lets the app render a matched GET or HEAD route", () => {
  expect(isForwardedRoute(ROUTES, "GET", "/projects/7")).toBe(false);
  expect(isForwardedRoute(ROUTES, "HEAD", "/")).toBe(false);
});

it("forwards a matched route that the API serves", () => {
  expect(isForwardedRoute(ROUTES, "GET", "/download/abc")).toBe(true);
});

it("lets the app render an address that no route matches", () => {
  expect(isForwardedRoute(ROUTES, "GET", "/unknown/path")).toBe(false);
  expect(isForwardedRoute([], "GET", "/")).toBe(false);
});
