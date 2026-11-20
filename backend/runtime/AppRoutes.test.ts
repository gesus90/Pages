import { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { logFileProbeError } from "@/backend/logging/Logger";

import { APP_ROUTES_FILE, AppRoutes } from "./AppRoutes";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), stat: vi.fn() }));
vi.mock("@/backend/logging/Logger", () => ({ logFileProbeError: vi.fn() }));

const CLIENT_DIRECTORY = "/srv/pages/client";
const ROUTES = [
  { path: "/wiki", isForwarded: false },
  { path: "/api/export", isForwarded: true },
];

// The prototype keeps the type without calling the deprecated constructor.
function statsModifiedAt(modifiedAt: number): Stats {
  return Object.assign(Object.create(Stats.prototype), {
    mtimeMs: modifiedAt,
  });
}

function provideRouteFile(content: string, modifiedAt = 1): void {
  vi.mocked(stat).mockResolvedValue(statsModifiedAt(modifiedAt));
  vi.mocked(readFile).mockResolvedValue(content);
}

beforeEach(() => {
  vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));
});

it("lets the app render a page the build lists as not forwarded", async () => {
  provideRouteFile(JSON.stringify(ROUTES));
  const routes = new AppRoutes(CLIENT_DIRECTORY);

  expect(await routes.isForwarded("GET", "/wiki")).toBe(false);
  expect(await routes.isForwarded("HEAD", "/wiki")).toBe(false);
});

it("forwards a listed server resource, changes and data requests", async () => {
  provideRouteFile(JSON.stringify(ROUTES));
  const routes = new AppRoutes(CLIENT_DIRECTORY);

  expect(await routes.isForwarded("GET", "/api/export")).toBe(true);
  expect(await routes.isForwarded("POST", "/wiki")).toBe(true);
  expect(await routes.isForwarded("GET", "/wiki.data")).toBe(true);
});

it("reads the route file of the client directory", async () => {
  provideRouteFile(JSON.stringify(ROUTES));

  await new AppRoutes(CLIENT_DIRECTORY).isForwarded("GET", "/wiki");

  expect(stat).toHaveBeenCalledWith(
    path.join(CLIENT_DIRECTORY, APP_ROUTES_FILE),
  );
  expect(readFile).toHaveBeenCalledWith(
    path.join(CLIENT_DIRECTORY, APP_ROUTES_FILE),
    "utf8",
  );
});

it("forwards every request while the build wrote no route file", async () => {
  const failure = new Error("ENOENT");
  vi.mocked(stat).mockRejectedValue(failure);

  const isForwarded = await new AppRoutes(CLIENT_DIRECTORY).isForwarded(
    "GET",
    "/wiki",
  );

  expect(isForwarded).toBe(true);
  expect(logFileProbeError).toHaveBeenCalledWith("AppRoutes", failure);
  expect(readFile).not.toHaveBeenCalled();
});

it("forwards every request when the route file cannot be read", async () => {
  const failure = new Error("EACCES");
  vi.mocked(stat).mockResolvedValue(statsModifiedAt(1));
  vi.mocked(readFile).mockRejectedValue(failure);

  const isForwarded = await new AppRoutes(CLIENT_DIRECTORY).isForwarded(
    "GET",
    "/wiki",
  );

  expect(isForwarded).toBe(true);
  expect(logFileProbeError).toHaveBeenCalledWith("AppRoutes", failure);
});

it("forwards every request when the route file is not valid JSON", async () => {
  provideRouteFile("{not json");

  expect(
    await new AppRoutes(CLIENT_DIRECTORY).isForwarded("GET", "/wiki"),
  ).toBe(true);
  expect(logFileProbeError).toHaveBeenCalledTimes(1);
});

it.each([
  ["an object", "{}"],
  ["null", "null"],
  ["a list with a non-object", '[{"path":"/a","isForwarded":true}, 3]'],
  ["a list with null", '[{"path":"/a","isForwarded":true}, null]'],
  ["a route without a path", '[{"isForwarded":true}]'],
  ["a route with a numeric path", '[{"path":1,"isForwarded":true}]'],
  ["a route without a forwarding flag", '[{"path":"/wiki"}]'],
  [
    "a route with a text forwarding flag",
    '[{"path":"/wiki","isForwarded":"no"}]',
  ],
])(
  "forwards every request for a route file with %s",
  async (caseName, content) => {
    provideRouteFile(content);

    expect(
      await new AppRoutes(CLIENT_DIRECTORY).isForwarded("GET", "/wiki"),
    ).toBe(true);
  },
);

it("renders an empty route list as a table without forwarded pages", async () => {
  provideRouteFile("[]");

  expect(
    await new AppRoutes(CLIENT_DIRECTORY).isForwarded("GET", "/wiki"),
  ).toBe(false);
});

it("reads the route file once while its modification time stays the same", async () => {
  provideRouteFile(JSON.stringify(ROUTES), 5);
  const routes = new AppRoutes(CLIENT_DIRECTORY);

  await routes.isForwarded("GET", "/wiki");
  await routes.isForwarded("GET", "/wiki");

  expect(readFile).toHaveBeenCalledTimes(1);
});

it("follows a new build when the modification time changed", async () => {
  provideRouteFile(JSON.stringify(ROUTES), 5);
  const routes = new AppRoutes(CLIENT_DIRECTORY);
  expect(await routes.isForwarded("GET", "/wiki")).toBe(false);

  provideRouteFile(JSON.stringify([{ path: "/wiki", isForwarded: true }]), 6);

  expect(await routes.isForwarded("GET", "/wiki")).toBe(true);
  expect(readFile).toHaveBeenCalledTimes(2);
});

it("does not retry a broken route file until it changes", async () => {
  provideRouteFile("{not json", 5);
  const routes = new AppRoutes(CLIENT_DIRECTORY);
  await routes.isForwarded("GET", "/wiki");
  await routes.isForwarded("GET", "/wiki");

  expect(readFile).toHaveBeenCalledTimes(1);

  provideRouteFile(JSON.stringify(ROUTES), 6);

  expect(await routes.isForwarded("GET", "/wiki")).toBe(false);
});
