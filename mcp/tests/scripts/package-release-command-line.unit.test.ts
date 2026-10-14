import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as OperatingSystem from "node:os";

/** Redirects the temporary directory of the packager into the test directory. */
interface TemporaryState {
  temporaryRoot: string | undefined;
}

type BuildProcess = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => { readonly status: number | null };

const temporaryState = vi.hoisted((): TemporaryState => ({
  temporaryRoot: undefined,
}));
const spawnSyncMock = vi.hoisted(() => vi.fn<BuildProcess>());

vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof OperatingSystem>();
  return {
    ...actual,
    tmpdir: (): string => temporaryState.temporaryRoot ?? actual.tmpdir(),
  };
});

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/package-release.ts", import.meta.url),
);
const PACKAGE_DIRECTORY = fileURLToPath(new URL("../..", import.meta.url));
const BUNDLE = '"use strict";\nmodule.exports = {};\n';
const FAILURE_MESSAGE =
  "[pages-mcp] Release failed. Check tag, package sources and output directory.";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;
let testRoot = "";

function writeBundle(
  ...buildArguments: Parameters<BuildProcess>
): ReturnType<BuildProcess> {
  const workDirectory = buildArguments[2].cwd;
  const manifest = readFileSync(
    path.join(workDirectory, "package.json"),
    "utf8",
  );
  const version = /"version": "([^"]+)"/.exec(manifest)?.[1] ?? "";
  mkdirSync(path.join(workDirectory, "dist"));
  writeFileSync(
    path.join(workDirectory, "dist", `pages-mcp-v${version}.cjs`),
    BUNDLE,
  );
  return { status: 0 };
}

async function runScript(...commandArguments: string[]): Promise<void> {
  process.argv = [process.execPath, SCRIPT_PATH, ...commandArguments];
  vi.resetModules();
  await import("../../scripts/package-release.ts");
}

beforeEach(async () => {
  temporaryState.temporaryRoot = undefined;
  testRoot = await mkdtemp(path.join(tmpdir(), "pages-mcp-release-cli-"));
  temporaryState.temporaryRoot = path.join(testRoot, "tmp");
  await mkdir(temporaryState.temporaryRoot);
  spawnSyncMock.mockReset();
  spawnSyncMock.mockImplementation(writeBundle);
  for (const name of ["PAGES_TOKEN", "PAGES_URL", "GITHUB_TOKEN", "GH_TOKEN"]) {
    vi.stubEnv(name, "");
  }
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  temporaryState.temporaryRoot = undefined;
  vi.resetModules();
  await rm(testRoot, { recursive: true, force: true });
});

describe("package-release as an imported module", () => {
  it("does not run the command line", async () => {
    process.argv = [process.execPath, "/elsewhere/runner.js", "tag", "x"];
    vi.resetModules();

    const releaseModule = await import("../../scripts/package-release.ts");

    expect(releaseModule.parseReleaseTag("mcp-v1.0.0")).toBe("1.0.0");
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });
});

describe("package-release tag command", () => {
  it("prints the version of a valid tag", async () => {
    await runScript("tag", "mcp-v1.2.3");

    expect(console.info).toHaveBeenCalledExactlyOnceWith("1.2.3");
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("reports an invalid tag with exit code 1", async () => {
    await runScript("tag", "v1.2.3");

    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE);
    expect(process.exitCode).toBe(1);
  });
});

describe("package-release usage errors", () => {
  it.each([
    [[]],
    [["tag"]],
    [["tag", "mcp-v1.2.3", "extra"]],
    [["package", "mcp-v1.2.3"]],
    [["package", "mcp-v1.2.3", "out", "extra"]],
    [["publish", "mcp-v1.2.3"]],
  ])("rejects the arguments %j with exit code 1", async (commandArguments) => {
    await runScript(...commandArguments);

    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE);
    expect(process.exitCode).toBe(1);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

describe("package-release package command", () => {
  it("packages this package and prints version, archive and checksums", async () => {
    const outputDirectory = path.join(testRoot, "release");

    await runScript("package", "mcp-v9.8.7", outputDirectory);
    await vi.waitFor(() => expect(console.info).toHaveBeenCalledTimes(4), {
      timeout: 10_000,
    });

    const archivePath = path.join(outputDirectory, "pages-mcp-v9.8.7.zip");
    const archive = await readFile(archivePath);
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    const bundleSha256 = createHash("sha256").update(BUNDLE).digest("hex");
    expect(vi.mocked(console.info).mock.calls).toEqual([
      ["version 9.8.7"],
      [`archive ${archivePath}`],
      [`archive-sha256 ${archiveSha256}`],
      [`bundle-sha256 ${bundleSha256}`],
    ]);
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
    expect(archive.includes("pages-mcp-v9.8.7/README.md")).toBe(true);
    expect(archive.includes("pages-mcp-v9.8.7/examples/clients/")).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(await readdir(temporaryState.temporaryRoot ?? "")).toEqual([]);
    expect(
      await readFile(path.join(PACKAGE_DIRECTORY, "package.json"), "utf8"),
    ).not.toContain("9.8.7");
  });

  it("reports a failed packaging run with exit code 1", async () => {
    const outputDirectory = path.join(testRoot, "release");
    spawnSyncMock.mockReturnValue({ status: 1 });

    await runScript("package", "mcp-v9.8.7", outputDirectory);
    await vi.waitFor(() => expect(process.exitCode).toBe(1), {
      timeout: 10_000,
    });

    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE);
    expect(await readdir(testRoot)).toEqual(["tmp"]);
  });
});
