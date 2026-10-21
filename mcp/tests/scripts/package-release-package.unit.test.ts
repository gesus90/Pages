import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createReleaseManifest,
  createZipArchive,
  packageRelease,
  runReleaseCommand,
} from "../../scripts/package-release.ts";

import type * as OperatingSystem from "node:os";
import type { ArchiveEntry } from "../../scripts/package-release.ts";

/** Redirects the temporary directory of the packager into the test directory. */
interface TemporaryState {
  temporaryRoot: string | undefined;
}

/** Work copy as the mocked build process saw it. */
interface WorkCopySnapshot {
  readonly command: string;
  readonly args: readonly string[];
  readonly manifest: string;
  readonly readme: string;
  readonly sourceFiles: readonly string[];
  readonly hasDefinitions: boolean;
  readonly nodeModulesTarget: string;
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

const BUNDLE = '"use strict";\nmodule.exports = { started: true };\n';
const README = [
  "# Pages MCP 0.1.0",
  "",
  "Download `pages-mcp-v0.1.0.cjs` and run it with PAGES_URL=http://127.0.0.1:3000.",
  "",
].join("\n");
const MANIFEST =
  '{\n  "name": "pages-mcp",\n  "version": "0.1.0",\n  "private": true\n}\n';
const EXAMPLE_JSON =
  '{ "args": ["/absolute/path/pages-mcp-vX.Y.Z.cjs"], "env": { "PAGES_URL": "http://localhost:3000" } }\n';
const EXAMPLE_README = "Run node pages-mcp-vX.Y.Z.cjs pair.\n";

const FAILURE_MESSAGE =
  "[pages-mcp] Release failed. Check tag, package sources and output directory.";
const ORIGINAL_EXIT_CODE = process.exitCode;

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/package-release.ts", import.meta.url),
);

const ORIGINAL_ARGV = [...process.argv];
let testRoot = "";
let packageDirectory = "";
let outputDirectory = "";
let snapshots: WorkCopySnapshot[] = [];

async function runScript(...commandArguments: string[]): Promise<void> {
  process.argv = [process.execPath, SCRIPT_PATH, ...commandArguments];
  vi.resetModules();
  await import("../../scripts/package-release.ts");
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function listFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

function recordingBuild(bundles: readonly string[]): BuildProcess {
  return (command, args, options) => {
    const workDirectory = options.cwd;
    snapshots.push({
      command,
      args,
      manifest: readFileSync(path.join(workDirectory, "package.json"), "utf8"),
      readme: readFileSync(path.join(workDirectory, "README.md"), "utf8"),
      sourceFiles: listFiles(path.join(workDirectory, "src")),
      hasDefinitions: existsSync(
        path.join(workDirectory, "..", "definition", "Shared.ts"),
      ),
      nodeModulesTarget: readlinkSync(path.join(workDirectory, "node_modules")),
    });
    const version = /"version": "([^"]+)"/.exec(
      readFileSync(path.join(workDirectory, "package.json"), "utf8"),
    );
    mkdirSync(path.join(workDirectory, "dist"));
    writeFileSync(
      path.join(workDirectory, "dist", `pages-mcp-v${version?.[1] ?? ""}.cjs`),
      bundles[(snapshots.length - 1) % bundles.length],
    );
    return { status: 0 };
  };
}

async function writePackage(withDefinitions: boolean): Promise<void> {
  await mkdir(path.join(packageDirectory, "src", "tools"), { recursive: true });
  await mkdir(path.join(packageDirectory, "examples", "clients"), {
    recursive: true,
  });
  await writeFile(path.join(packageDirectory, "package.json"), MANIFEST);
  await writeFile(path.join(packageDirectory, "README.md"), README);
  await writeFile(path.join(packageDirectory, "build.config.ts"), "build();\n");
  await writeFile(path.join(packageDirectory, "tsconfig.json"), "{}\n");
  await writeFile(path.join(packageDirectory, "src", "main.ts"), "main();\n");
  await writeFile(
    path.join(packageDirectory, "src", "tools", "tool.ts"),
    "tool();\n",
  );
  const examples = path.join(packageDirectory, "examples", "clients");
  await writeFile(path.join(examples, "z-client.json"), EXAMPLE_JSON);
  await writeFile(path.join(examples, "README.md"), EXAMPLE_README);
  if (withDefinitions) {
    const definitions = path.join(packageDirectory, "..", "definition");
    await mkdir(definitions);
    await writeFile(path.join(definitions, "Shared.ts"), "shared();\n");
  }
}

function expectedEntries(version: string): ArchiveEntry[] {
  const prefix = `pages-mcp-v${version}`;
  const bundleName = `${prefix}.cjs`;
  return [
    { name: `${prefix}/${bundleName}`, content: Buffer.from(BUNDLE) },
    {
      name: `${prefix}/${bundleName}.sha256`,
      content: Buffer.from(`${sha256(BUNDLE)}  ${bundleName}\n`),
    },
    {
      name: `${prefix}/package.json`,
      content: Buffer.from(createReleaseManifest(version)),
    },
    {
      name: `${prefix}/README.md`,
      content: Buffer.from(README.replaceAll("0.1.0", version)),
    },
    {
      name: `${prefix}/examples/clients/README.md`,
      content: Buffer.from(EXAMPLE_README.replace("vX.Y.Z", `v${version}`)),
    },
    {
      name: `${prefix}/examples/clients/z-client.json`,
      content: Buffer.from(EXAMPLE_JSON.replace("vX.Y.Z", `v${version}`)),
    },
  ];
}

async function expectNoOutput(): Promise<void> {
  expect(existsSync(outputDirectory)).toBe(false);
  expect(await readdir(temporaryState.temporaryRoot ?? "")).toEqual([]);
}

beforeEach(async () => {
  temporaryState.temporaryRoot = undefined;
  testRoot = await mkdtemp(path.join(tmpdir(), "pages-mcp-release-package-"));
  temporaryState.temporaryRoot = path.join(testRoot, "tmp");
  await mkdir(temporaryState.temporaryRoot);
  packageDirectory = path.join(testRoot, "workspace", "mcp");
  outputDirectory = path.join(testRoot, "out", "nested");
  snapshots = [];
  spawnSyncMock.mockReset();
  spawnSyncMock.mockImplementation(recordingBuild([BUNDLE]));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  process.argv = [...ORIGINAL_ARGV];
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.resetModules();
  temporaryState.temporaryRoot = undefined;
  await rm(testRoot, { recursive: true, force: true });
});

describe("packageRelease success", () => {
  it("writes the deterministic archive and its checksum file", async () => {
    await writePackage(true);

    const result = await packageRelease({
      tag: "mcp-v1.4.2",
      outputDirectory,
      packageDirectory,
      environment: {},
    });

    const archivePath = path.join(outputDirectory, "pages-mcp-v1.4.2.zip");
    const archive = await readFile(archivePath);
    expect(archive.equals(createZipArchive(expectedEntries("1.4.2")))).toBe(
      true,
    );
    expect(result).toEqual({
      version: "1.4.2",
      archivePath,
      archiveSha256: sha256(archive),
      bundleSha256: sha256(BUNDLE),
    });
    expect(await readFile(`${archivePath}.sha256`, "utf8")).toBe(
      `${sha256(archive)}  pages-mcp-v1.4.2.zip\n`,
    );
    expect((await readdir(outputDirectory)).sort()).toEqual([
      "pages-mcp-v1.4.2.zip",
      "pages-mcp-v1.4.2.zip.sha256",
    ]);
  });

  it("builds twice in stamped work copies and removes them", async () => {
    await writePackage(true);

    await packageRelease({
      tag: "mcp-v2.0.0",
      outputDirectory,
      packageDirectory,
      environment: {},
    });

    expect(snapshots).toHaveLength(2);
    const expectedSnapshot: WorkCopySnapshot = {
      command: process.execPath,
      args: ["build.config.ts"],
      manifest: MANIFEST.replace("0.1.0", "2.0.0"),
      readme: README.replaceAll("0.1.0", "2.0.0"),
      sourceFiles: ["main.ts", "tools/tool.ts"],
      hasDefinitions: true,
      nodeModulesTarget: path.join(packageDirectory, "node_modules"),
    };
    expect(snapshots).toEqual([expectedSnapshot, expectedSnapshot]);
    expect(spawnSyncMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(spawnSyncMock.mock.calls[0]?.[2].cwd).not.toBe(
      spawnSyncMock.mock.calls[1]?.[2].cwd,
    );
    expect(await readdir(temporaryState.temporaryRoot ?? "")).toEqual([]);
  });

  it("leaves the package tree unchanged", async () => {
    await writePackage(false);

    await packageRelease({
      tag: "mcp-v3.0.0",
      outputDirectory,
      packageDirectory,
      environment: {},
    });

    expect(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    ).toBe(MANIFEST);
    expect(
      await readFile(path.join(packageDirectory, "README.md"), "utf8"),
    ).toBe(README);
    expect(existsSync(path.join(packageDirectory, "dist"))).toBe(false);
  });

  it("builds without shared definitions when the package has none", async () => {
    await writePackage(false);

    await packageRelease({
      tag: "mcp-v1.0.0",
      outputDirectory,
      packageDirectory,
      environment: {},
    });

    expect(snapshots.map((snapshot) => snapshot.hasDefinitions)).toEqual([
      false,
      false,
    ]);
  });
});

describe("packageRelease input errors", () => {
  it("rejects an invalid tag before reading or building anything", async () => {
    await expect(
      packageRelease({
        tag: "mcp-v1.0",
        outputDirectory,
        environment: {},
      }),
    ).rejects.toThrow(
      "Release tags must have the form mcp-vMAJOR.MINOR.PATCH.",
    );
    expect(spawnSyncMock).not.toHaveBeenCalled();
    await expectNoOutput();
  });

  it("rejects a manifest without a version", async () => {
    await writePackage(false);
    await writeFile(
      path.join(packageDirectory, "package.json"),
      '{ "name": "pages-mcp" }\n',
    );

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: {},
      }),
    ).rejects.toThrow("package.json must declare a version.");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("rejects a README that cannot be stamped", async () => {
    await writePackage(false);
    await writeFile(
      path.join(packageDirectory, "README.md"),
      "# Pages MCP 0.0.9\n\npages-mcp-v0.0.9.cjs\n",
    );

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: {},
      }),
    ).rejects.toThrow(
      "The README must name the package version and bundle file.",
    );
    expect(spawnSyncMock).not.toHaveBeenCalled();
    await expectNoOutput();
  });
});

describe("packageRelease build errors", () => {
  it.each([1, null])(
    "fails and cleans up when the build exits with status %s",
    async (status) => {
      await writePackage(true);
      spawnSyncMock.mockReturnValue({ status });

      await expect(
        packageRelease({
          tag: "mcp-v1.0.0",
          outputDirectory,
          packageDirectory,
          environment: {},
        }),
      ).rejects.toThrow("The bundle build failed.");
      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
      await expectNoOutput();
    },
  );

  it("fails when the build writes no bundle", async () => {
    await writePackage(false);
    spawnSyncMock.mockReturnValue({ status: 0 });

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: {},
      }),
    ).rejects.toThrow(/ENOENT/);
    await expectNoOutput();
  });

  it("rejects two clean builds with different bundles", async () => {
    await writePackage(false);
    spawnSyncMock.mockImplementation(
      recordingBuild([BUNDLE, `${BUNDLE}// changed\n`]),
    );

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: {},
      }),
    ).rejects.toThrow("Two clean builds produced different bundles.");
    expect(snapshots).toHaveLength(2);
    await expectNoOutput();
  });
});

describe("packageRelease secret scan", () => {
  it("rejects an example that carries a configured environment value", async () => {
    await writePackage(false);
    await writeFile(
      path.join(packageDirectory, "examples", "clients", "z-client.json"),
      '{ "env": { "PAGES_TOKEN": "pairing-secret-value" } }\n',
    );

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: { PAGES_TOKEN: "pairing-secret-value" },
      }),
    ).rejects.toThrow(
      "pages-mcp-v1.0.0/examples/clients/z-client.json contains a configured environment value.",
    );
    await expectNoOutput();
  });

  it("scans the process environment when none is given", async () => {
    await writePackage(false);
    vi.stubEnv("PAGES_URL", "https://pages.company.test");
    spawnSyncMock.mockImplementation(
      recordingBuild([`${BUNDLE}fetch("https://pages.company.test");\n`]),
    );

    await expect(
      packageRelease({ tag: "mcp-v1.0.0", outputDirectory, packageDirectory }),
    ).rejects.toThrow(
      "pages-mcp-v1.0.0/pages-mcp-v1.0.0.cjs contains a configured environment value.",
    );
    await expectNoOutput();
  });

  it("rejects a bundle with a token-shaped string literal", async () => {
    await writePackage(false);
    spawnSyncMock.mockImplementation(
      recordingBuild([`${BUNDLE}const key = "${"k".repeat(43)}";\n`]),
    );

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: {},
      }),
    ).rejects.toThrow(
      "pages-mcp-v1.0.0/pages-mcp-v1.0.0.cjs contains a token-shaped value.",
    );
    await expectNoOutput();
  });

  it("rejects a README with an instance address", async () => {
    await writePackage(false);
    await writeFile(
      path.join(packageDirectory, "README.md"),
      `${README}Our server: https://pages.internal.example.org\n`,
    );

    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory,
        environment: {},
      }),
    ).rejects.toThrow(
      "pages-mcp-v1.0.0/README.md contains an address outside the placeholder hosts.",
    );
    await expectNoOutput();
  });
});

describe("runReleaseCommand package", () => {
  it("packages the supplied source and prints version, archive and checksums", async () => {
    await writePackage(true);

    await runReleaseCommand(["package", "mcp-v9.8.7", outputDirectory], {
      packageDirectory,
      environment: {},
    });

    const archivePath = path.join(outputDirectory, "pages-mcp-v9.8.7.zip");
    const archive = await readFile(archivePath);
    expect(vi.mocked(console.info).mock.calls).toEqual([
      ["version 9.8.7"],
      [`archive ${archivePath}`],
      [`archive-sha256 ${sha256(archive)}`],
      [`bundle-sha256 ${sha256(BUNDLE)}`],
    ]);
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
    expect(archive.includes("pages-mcp-v9.8.7/README.md")).toBe(true);
    expect(archive.includes("pages-mcp-v9.8.7/examples/clients/")).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(await readdir(temporaryState.temporaryRoot ?? "")).toEqual([]);
    expect(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    ).toBe(MANIFEST);
    expect(archive.equals(createZipArchive(expectedEntries("9.8.7")))).toBe(
      true,
    );
  });

  it("reports a failed packaging run with exit code 1", async () => {
    await writePackage(true);
    spawnSyncMock.mockReturnValue({ status: 1 });

    await runReleaseCommand(["package", "mcp-v9.8.7", outputDirectory], {
      packageDirectory,
      environment: {},
    });

    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE);
    expect(process.exitCode).toBe(1);
    await expectNoOutput();
    expect((await readdir(testRoot)).sort()).toEqual(["tmp", "workspace"]);
  });
});

describe("package-release as an imported module", () => {
  it("does not run the command line", async () => {
    process.argv = [process.execPath, "/elsewhere/runner.js", "tag", "x"];
    vi.resetModules();

    const releaseModule = await import("../../scripts/package-release.ts");

    expect(releaseModule.parseReleaseTag("mcp-v1.0.0")).toBe("1.0.0");
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
  });
});

describe("package-release tag command", () => {
  it("prints the version of a valid tag", async () => {
    await runScript("tag", "mcp-v1.2.3");

    expect(console.info).toHaveBeenCalledExactlyOnceWith("1.2.3");
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
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
