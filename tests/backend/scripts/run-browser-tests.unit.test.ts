import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  browserCacheCandidates,
  createRunDirectory,
  inspectBrowserCache,
  privateBrowserCache,
  requestedPort,
  resultsDirectory,
  runStep,
  TIMEOUT_EXIT_CODE,
  timeoutMilliseconds,
} from "@/scripts/run-browser-tests.mjs";

const NOW = new Date("2026-11-03T17:00:00.000Z");
const REVISION = "1243";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-browser-unit-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function placeBrowser(): Promise<string> {
  const folder = path.join(
    directory,
    `chromium_headless_shell-${REVISION}`,
    "chrome-headless-shell-linux64",
  );
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, "chrome-headless-shell");
  await writeFile(file, "");
  return file;
}

it("names the explicit cache first and every other known cache once", () => {
  expect(
    browserCacheCandidates(
      {
        PLAYWRIGHT_BROWSERS_PATH: "/explicit",
        XDG_CACHE_HOME: "/agent/cache",
        HOME: "/agent",
      },
      "/agent",
    ),
  ).toEqual([
    "/explicit",
    "/agent/cache/ms-playwright",
    "/agent/.cache/ms-playwright",
  ]);
  expect(browserCacheCandidates({ HOME: "/agent" }, "/home/user")).toEqual([
    "/agent/.cache/ms-playwright",
    "/home/user/.cache/ms-playwright",
  ]);
});

it("installs into a private directory of its own, not into a shared cache", () => {
  expect(privateBrowserCache({ XDG_CACHE_HOME: "/agent/cache" }, "/u")).toBe(
    "/agent/cache/pages-browser-tests/ms-playwright",
  );
  expect(privateBrowserCache({}, "/u")).toBe(
    "/u/.cache/pages-browser-tests/ms-playwright",
  );
});

it("accepts a browser only when it starts", async () => {
  const file = await placeBrowser();

  expect(inspectBrowserCache(directory, REVISION, () => null)).toEqual({
    directory,
    usable: true,
    reason: null,
  });
  // The state of a cache copied without its execute bit.
  expect(inspectBrowserCache(directory, REVISION, () => "EACCES")).toEqual({
    directory,
    usable: false,
    reason: "EACCES",
  });
  expect(inspectBrowserCache(directory, "9999", () => null).reason).toBe(
    "missing",
  );
  expect(file).toContain(REVISION);
});

it("refuses to start a real browser file without its execute bit", async () => {
  await placeBrowser();

  expect(inspectBrowserCache(directory, REVISION)).toMatchObject({
    usable: false,
    reason: "EACCES",
  });
});

const RUN = "2026-11-03T17-00-00-000Z";

it("writes results outside the checkout, one directory per run", () => {
  expect(
    resultsDirectory({ XDG_STATE_HOME: "/state" }, "/u", "/repo", NOW),
  ).toBe(`/state/pages-browser-tests/${RUN}`);
  expect(resultsDirectory({}, "/u", "/repo", NOW)).toBe(
    `/u/.local/state/pages-browser-tests/${RUN}`,
  );
});

it("gives each run its own directory below an explicit root", () => {
  expect(
    resultsDirectory({ PAGES_BROWSER_RESULTS: "/kept" }, "/u", "/repo", NOW),
  ).toBe(`/kept/${RUN}`);
});

it("keeps the reports of an earlier run when a run uses the same explicit root", async () => {
  const root = path.join(directory, "evidence");
  const first = await createRunDirectory(
    resultsDirectory({ PAGES_BROWSER_RESULTS: root }, "/u", "/repo", NOW),
  );
  const report = path.join(first, "report", "index.html");
  await mkdir(path.dirname(report));
  await writeFile(report, "earlier run");

  const second = await createRunDirectory(
    resultsDirectory({ PAGES_BROWSER_RESULTS: root }, "/u", "/repo", NOW),
  );
  const later = await createRunDirectory(
    resultsDirectory(
      { PAGES_BROWSER_RESULTS: root },
      "/u",
      "/repo",
      new Date("2026-11-03T18:00:00.000Z"),
    ),
  );

  expect(new Set([first, second, later]).size).toBe(3);
  await expect(readFile(report, "utf8")).resolves.toBe("earlier run");
  await expect(readdir(second)).resolves.toEqual([]);
});

it("reports a directory that cannot be created instead of reusing another", async () => {
  await writeFile(path.join(directory, "file"), "");

  await expect(
    createRunDirectory(path.join(directory, "file", "run")),
  ).rejects.toThrow();
});

it.each(["/repo/tests/browser/results", "/repo"])(
  "refuses the results directory %s inside the checkout",
  (selected) => {
    expect(() =>
      resultsDirectory({ PAGES_BROWSER_RESULTS: selected }, "/u", "/repo", NOW),
    ).toThrow("outside the checkout");
  },
);

it("refuses the port of a running installation and an invalid one", () => {
  expect(requestedPort({})).toBeNull();
  expect(requestedPort({ PAGES_BROWSER_PORT: "4100" })).toBe(4100);
  expect(() => requestedPort({ PAGES_BROWSER_PORT: "3000" })).toThrow(
    "reserved",
  );
  expect(() => requestedPort({ PAGES_BROWSER_PORT: "abc" })).toThrow("Invalid");
});

it("reads the time limit and refuses an invalid one", () => {
  expect(timeoutMilliseconds({})).toBe(45 * 60_000);
  expect(timeoutMilliseconds({ PAGES_BROWSER_TIMEOUT_MINUTES: "2" })).toBe(
    120_000,
  );
  expect(() =>
    timeoutMilliseconds({ PAGES_BROWSER_TIMEOUT_MINUTES: "0" }),
  ).toThrow("Invalid");
});

function step(script: string, limit = 10_000): Promise<number> {
  return runStep(process.execPath, ["-e", script], {
    cwd: directory,
    env: process.env,
    timeoutMilliseconds: limit,
  });
}

it("passes the exit code of a step on", async () => {
  await expect(step("process.exit(0)")).resolves.toBe(0);
  await expect(step("process.exit(7)")).resolves.toBe(7);
});

it("never reads a step that ran into its limit as a pass", async () => {
  await expect(step("setInterval(() => {}, 1000)", 100)).resolves.toBe(
    TIMEOUT_EXIT_CODE,
  );
});

it("reads a step ended by a signal as a failure", async () => {
  await expect(step("process.kill(process.pid, 'SIGKILL')")).resolves.toBe(137);
});

it("reads a program that cannot start as a failure", async () => {
  await expect(
    runStep(path.join(directory, "missing"), [], {
      cwd: directory,
      env: process.env,
      timeoutMilliseconds: 1_000,
    }),
  ).resolves.toBe(3);
});
