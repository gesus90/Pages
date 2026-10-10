import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertNoSecrets,
  createReleaseManifest,
  createZipArchive,
  packageRelease,
  parseReleaseTag,
  stampManifest,
  stampReadme,
} from "../../mcp/scripts/package-release";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../mcp/scripts/package-release.ts", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Reads a ZIP written by `createZipArchive` and verifies sizes and checksums of every entry. */
function readZip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    const localExtra = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLength + localExtra;
    const content = inflateRawSync(
      archive.subarray(dataStart, dataStart + compressedSize),
    );
    expect(flags).toBe(0x0800);
    expect(method).toBe(8);
    expect(content.length).toBe(size);
    expect(crc32(content)).toBe(checksum);
    files.set(name, content);
    offset += 46 + nameLength;
  }
  return files;
}

interface FixtureOptions {
  readonly buildScript?: string;
  readonly readme?: string;
  readonly manifest?: string;
}

const FIXTURE_BUILD = [
  'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  'import manifest from "./package.json" with { type: "json" };',
  'if (!readFileSync("README.md", "utf8").startsWith(`# Pages MCP ${manifest.version}\\n`)) throw new Error("README version mismatch");',
  'mkdirSync("dist", { recursive: true });',
  "writeFileSync(`dist/pages-mcp-v${manifest.version}.js`, `// bundle ${manifest.version}\\n`);",
].join("\n");

/** Creates a minimal package directory that the release script can build without esbuild. */
async function makeFixturePackage(
  options: FixtureOptions = {},
): Promise<string> {
  const directory = await makeTemporaryDirectory("pages-mcp-fixture-");
  await mkdir(path.join(directory, "src"));
  await mkdir(path.join(directory, "node_modules"));
  await mkdir(path.join(directory, "examples", "clients"), { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    options.manifest ??
      `${JSON.stringify({ name: "fixture", version: "0.1.0", type: "module" }, null, 2)}\n`,
  );
  await writeFile(
    path.join(directory, "README.md"),
    options.readme ??
      "# Pages MCP 0.1.0\n\nRun `node pages-mcp-v0.1.0.js` behind https://mcp.example.com/mcp\n",
  );
  await writeFile(
    path.join(directory, "build.config.ts"),
    options.buildScript ?? FIXTURE_BUILD,
  );
  await writeFile(path.join(directory, "tsconfig.json"), "{}\n");
  await writeFile(path.join(directory, "src", "main.ts"), "export {};\n");
  await writeFile(
    path.join(directory, "examples", "clients", "client.json"),
    '{"command":["node","/path/to/pages-mcp-vX.Y.Z.js"],"url":"https://pages.example.com"}\n',
  );
  return directory;
}

describe("release tag", () => {
  it.each([
    ["mcp-v0.1.0", "0.1.0"],
    ["mcp-v1.20.300", "1.20.300"],
    ["mcp-v10.0.0", "10.0.0"],
  ])("accepts %s as version %s", (tag, version) => {
    expect(parseReleaseTag(tag)).toBe(version);
  });

  it.each([
    "v1.2.3",
    "mcp-v1.2",
    "mcp-v1.2.3.4",
    "mcp-v01.2.3",
    "mcp-v1.02.3",
    "mcp-v1.2.3-rc.1",
    "mcp-v1.2.3+build.5",
    "mcp-V1.2.3",
    "mcp-vx.y.z",
    "mcp-v",
    " mcp-v1.2.3",
    "mcp-v1.2.3\n",
    "refs/tags/mcp-v1.2.3",
    "",
  ])("rejects the tag %j", (tag) => {
    expect(() => parseReleaseTag(tag)).toThrow(
      "Release tags must have the form mcp-vMAJOR.MINOR.PATCH.",
    );
  });
});

describe("version stamping", () => {
  it("sets only the version field of the manifest", () => {
    const manifest =
      '{\n  "name": "pages-mcp",\n  "version": "0.1.0",\n  "dependencies": {\n    "sdk": "2.2.0"\n  }\n}\n';
    const stamped = stampManifest(manifest, "3.4.5");
    expect(stamped.currentVersion).toBe("0.1.0");
    expect(stamped.text).toBe(manifest.replace('"0.1.0"', '"3.4.5"'));
  });

  it("rejects a manifest without a version", () => {
    expect(() => stampManifest('{"name":"pages-mcp"}', "1.0.0")).toThrow(
      "package.json must declare a version.",
    );
  });

  it("sets the title and every bundle filename of the README", () => {
    const readme =
      "# Pages MCP 0.1.0\n\nCopy `pages-mcp-v0.1.0.js`.\nRun `node pages-mcp-v0.1.0.js`.\nSDK 2.2.0 stays.\n";
    const stamped = stampReadme(readme, "0.1.0", "1.2.3");
    expect(stamped).toBe(
      "# Pages MCP 1.2.3\n\nCopy `pages-mcp-v1.2.3.js`.\nRun `node pages-mcp-v1.2.3.js`.\nSDK 2.2.0 stays.\n",
    );
    expect(stamped).not.toContain("0.1.0");
  });

  it.each([
    "# Pages MCP 0.1.0\n\nNo bundle name.\n",
    "# Pages MCP\n\npages-mcp-v0.1.0.js\n",
    "",
  ])("refuses a README that does not name its version %j", (readme) => {
    expect(() => stampReadme(readme, "0.1.0", "1.2.3")).toThrow(
      "The README must name the package version and bundle file.",
    );
  });

  it("ships a dependency-free CommonJS manifest", () => {
    const manifest: unknown = JSON.parse(createReleaseManifest("2.0.1"));
    expect(manifest).toEqual({
      name: "pages-mcp",
      version: "2.0.1",
      license: "MIT",
      type: "commonjs",
      main: "pages-mcp-v2.0.1.js",
      engines: { node: ">=24.0.0" },
    });
  });
});

describe("secret scan", () => {
  const entry = (name: string, text: string) => ({
    name,
    content: Buffer.from(text),
  });

  it("accepts placeholder hosts, loopback addresses and documentation links", () => {
    expect(() =>
      assertNoSecrets(
        [
          entry(
            "README.md",
            "https://mcp.example.com/mcp http://127.0.0.1:8998 http://localhost:3000 http://[::1]:3000\nhttps://modelcontextprotocol.io/specification and https://github.com/modelcontextprotocol/typescript-sdk",
          ),
          entry("client.json", '{"url":"https://example.com/mcp"}'),
          entry("bundle.js.sha256", `${"a".repeat(64)}  bundle.js\n`),
          entry("metadata.bin", "binary archive member"),
          entry(
            "bundle.js",
            'http://[${value} https://json-schema.org https://raw.githubusercontent.com "ElicitationCompleteNotificationParamsSchema" "SubscriptionsAcknowledgedNotificationSchema"',
          ),
        ],
        { PAGES_TOKEN: undefined, PAGES_URL: "" },
      ),
    ).not.toThrow();
  });

  it.each([
    ["an instance URL", "README.md", "see https://pages.acme-corp.net/api"],
    [
      "a bundled instance URL",
      "bundle.js",
      "const url = 'https://pages.acme-corp.net/api';",
    ],
    [
      "a bundled credential",
      "bundle.js",
      `const credential = '${"b".repeat(43)}';`,
    ],
    ["a malformed URL", "README.md", "see http://%zz"],
    ["a token-shaped value", "client.json", `{"t":"${"A1_-".repeat(10)}abc"}`],
    [
      "a Bearer credential",
      "README.md",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    ],
  ])("rejects %s", (_label, name, text) => {
    expect(() => assertNoSecrets([entry(name, text)], {})).toThrow(
      new RegExp(`^${name.replace(".", "\\.")} contains`),
    );
  });

  it("names the file but never the value that matched", () => {
    const secret = "https://pages.sentinel-secret.net";
    let message = "";
    try {
      assertNoSecrets([entry("README.md", secret)], {});
    } catch (error: unknown) {
      message = String(error);
    }
    expect(message).toContain("README.md");
    expect(message).not.toContain("sentinel-secret");
  });

  it("rejects configured environment values in every file, including the bundle", () => {
    for (const name of ["PAGES_TOKEN", "PAGES_URL", "GITHUB_TOKEN"]) {
      expect(() =>
        assertNoSecrets([entry("bundle.js", "x sentinel-value y")], {
          [name]: "sentinel-value",
        }),
      ).toThrow("bundle.js contains a configured environment value.");
    }
  });
});

describe("ZIP archive", () => {
  const files = [
    { name: "b/second.txt", content: Buffer.from("second\n".repeat(100)) },
    { name: "a/first.json", content: Buffer.from('{"first":true}\n') },
    { name: "c/ümlaut.md", content: Buffer.alloc(0) },
  ];

  it("round-trips every entry in sorted order with valid checksums", () => {
    const archive = createZipArchive(files);
    const entries = readZip(archive);
    expect([...entries.keys()]).toEqual([
      "a/first.json",
      "b/second.txt",
      "c/ümlaut.md",
    ]);
    expect(entries.get("b/second.txt")?.toString()).toBe(
      "second\n".repeat(100),
    );
    expect(entries.get("c/ümlaut.md")?.length).toBe(0);
  });

  it("is independent of input order and build time", () => {
    const first = createZipArchive(files);
    const second = createZipArchive([...files].reverse());
    expect(second.equals(first)).toBe(true);
    // Fixed 1980-01-01 DOS timestamp in the first local header.
    expect(first.readUInt16LE(10)).toBe(0);
    expect(first.readUInt16LE(12)).toBe(0x0021);
  });

  it("marks entries as regular files with mode 0644", () => {
    const archive = createZipArchive(files);
    const end = archive.length - 22;
    const directory = archive.readUInt32LE(end + 16);
    expect(archive.readUInt16LE(directory + 4) >> 8).toBe(3);
    expect(archive.readUInt32LE(directory + 38) >>> 16).toBe(0o100644);
  });
});

describe("release packaging of a fixture package", () => {
  it("writes the archive, its checksum files and a stamped bundle", async () => {
    const packageDirectory = await makeFixturePackage();
    const outputDirectory = path.join(
      await makeTemporaryDirectory("pages-mcp-out-"),
      "release",
    );
    const result = await packageRelease({
      tag: "mcp-v2.5.1",
      outputDirectory,
      packageDirectory,
      environment: {},
    });
    expect(result.version).toBe("2.5.1");
    expect((await readdir(outputDirectory)).sort()).toEqual([
      "pages-mcp-v2.5.1.zip",
      "pages-mcp-v2.5.1.zip.sha256",
    ]);
    const archive = await readFile(result.archivePath);
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    expect(result.archiveSha256).toBe(archiveSha256);
    expect(await readFile(`${result.archivePath}.sha256`, "utf8")).toBe(
      `${archiveSha256}  pages-mcp-v2.5.1.zip\n`,
    );

    const entries = readZip(archive);
    expect([...entries.keys()]).toEqual([
      "pages-mcp-v2.5.1/README.md",
      "pages-mcp-v2.5.1/examples/clients/client.json",
      "pages-mcp-v2.5.1/package.json",
      "pages-mcp-v2.5.1/pages-mcp-v2.5.1.js",
      "pages-mcp-v2.5.1/pages-mcp-v2.5.1.js.sha256",
    ]);
    const bundle = entries.get("pages-mcp-v2.5.1/pages-mcp-v2.5.1.js");
    expect(bundle?.toString()).toBe("// bundle 2.5.1\n");
    const bundleSha256 = createHash("sha256")
      .update(bundle ?? "")
      .digest("hex");
    expect(result.bundleSha256).toBe(bundleSha256);
    expect(
      entries.get("pages-mcp-v2.5.1/pages-mcp-v2.5.1.js.sha256")?.toString(),
    ).toBe(`${bundleSha256}  pages-mcp-v2.5.1.js\n`);
    expect(entries.get("pages-mcp-v2.5.1/README.md")?.toString()).toBe(
      "# Pages MCP 2.5.1\n\nRun `node pages-mcp-v2.5.1.js` behind https://mcp.example.com/mcp\n",
    );
    expect(
      entries.get("pages-mcp-v2.5.1/examples/clients/client.json")?.toString(),
    ).toContain("/path/to/pages-mcp-v2.5.1.js");
    expect(entries.get("pages-mcp-v2.5.1/package.json")?.toString()).toBe(
      createReleaseManifest("2.5.1"),
    );
  });

  it("leaves the source package untouched", async () => {
    const packageDirectory = await makeFixturePackage();
    const before = await readFile(
      path.join(packageDirectory, "package.json"),
      "utf8",
    );
    await packageRelease({
      tag: "mcp-v9.9.9",
      outputDirectory: await makeTemporaryDirectory("pages-mcp-out-"),
      packageDirectory,
      environment: {},
    });
    expect(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    ).toBe(before);
    expect(await readdir(packageDirectory)).not.toContain("dist");
  });

  it("creates nothing for an invalid tag", async () => {
    const outputDirectory = path.join(
      await makeTemporaryDirectory("pages-mcp-out-"),
      "release",
    );
    await expect(
      packageRelease({
        tag: "v1.2.3",
        outputDirectory,
        packageDirectory: await makeFixturePackage(),
        environment: {},
      }),
    ).rejects.toThrow("Release tags must have the form");
    await expect(stat(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates nothing when the bundle build fails", async () => {
    const outputDirectory = path.join(
      await makeTemporaryDirectory("pages-mcp-out-"),
      "release",
    );
    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory: await makeFixturePackage({
          buildScript: 'console.error("compiler exploded"); process.exit(3);\n',
        }),
        environment: {},
      }),
    ).rejects.toThrow("The bundle build failed.");
    await expect(stat(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates nothing when two clean builds differ", async () => {
    const outputDirectory = path.join(
      await makeTemporaryDirectory("pages-mcp-out-"),
      "release",
    );
    const buildScript = [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { randomBytes } from "node:crypto";',
      'import manifest from "./package.json" with { type: "json" };',
      'mkdirSync("dist", { recursive: true });',
      "writeFileSync(`dist/pages-mcp-v${manifest.version}.js`, randomBytes(16));",
    ].join("\n");
    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory: await makeFixturePackage({ buildScript }),
        environment: {},
      }),
    ).rejects.toThrow("Two clean builds produced different bundles.");
    await expect(stat(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates nothing when the README or manifest lacks its version", async () => {
    for (const options of [
      { readme: "# Pages MCP\n" },
      { manifest: '{ "name": "fixture" }\n' },
    ]) {
      const outputDirectory = path.join(
        await makeTemporaryDirectory("pages-mcp-out-"),
        "release",
      );
      await expect(
        packageRelease({
          tag: "mcp-v1.0.0",
          outputDirectory,
          packageDirectory: await makeFixturePackage(options),
          environment: {},
        }),
      ).rejects.toThrow(/must (name|declare)/);
      await expect(stat(outputDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it("creates nothing when the content carries a configured value or an instance address", async () => {
    const outputDirectory = path.join(
      await makeTemporaryDirectory("pages-mcp-out-"),
      "release",
    );
    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory: await makeFixturePackage(),
        environment: { PAGES_URL: "https://mcp.example.com/mcp" },
      }),
    ).rejects.toThrow("contains a configured environment value.");
    await expect(
      packageRelease({
        tag: "mcp-v1.0.0",
        outputDirectory,
        packageDirectory: await makeFixturePackage({
          readme:
            "# Pages MCP 0.1.0\n\npages-mcp-v0.1.0.js https://pages.acme-corp.net\n",
        }),
        environment: {},
      }),
    ).rejects.toThrow("contains an address outside the placeholder hosts.");
    await expect(stat(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

/** Answers the verification request of the stdio bundle like a Pages instance would. */
async function startPagesStub(): Promise<{ url: string; close: () => void }> {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        apiVersion: "1",
        identity: { userId: "release-check", isAdmin: false, permissions: [] },
        tools: [],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listener");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

/** Starts the bundle, performs the MCP initialization and returns the parsed reply. */
async function readInitializeReply(
  bundlePath: string,
  directory: string,
  pagesUrl: string,
): Promise<unknown> {
  const child = spawn(process.execPath, [bundlePath], {
    cwd: directory,
    env: { PAGES_URL: pagesUrl, PAGES_TOKEN: "synthetic-credential" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "release-check", version: "1.0.0" },
        },
      })}\n`,
    );
    const line = await new Promise<string>((resolve, reject) => {
      let buffered = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        const newline = buffered.indexOf("\n");
        if (newline >= 0) {
          resolve(buffered.slice(0, newline));
        }
      });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("The bundle exited early.")));
    });
    const reply: unknown = JSON.parse(line);
    return reply;
  } finally {
    child.kill();
  }
}

describe("command line entry point with the real package", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });
  afterEach(() => {
    process.exitCode = 0;
    vi.unstubAllGlobals();
  });

  it("packages a runnable bundle whose version, manifest and README match the tag", async () => {
    const outputDirectory = await makeTemporaryDirectory("pages-mcp-real-");
    const originalArguments = process.argv;
    process.argv = [
      process.execPath,
      SCRIPT_PATH,
      "package",
      "mcp-v7.3.1",
      outputDirectory,
    ];
    try {
      await import("../../mcp/scripts/package-release");
      await vi.waitFor(
        async () => {
          expect(await readdir(outputDirectory)).toContain(
            "pages-mcp-v7.3.1.zip.sha256",
          );
        },
        { timeout: 60_000, interval: 250 },
      );
    } finally {
      process.argv = originalArguments;
    }
    expect(process.exitCode).not.toBe(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith("version 7.3.1");

    const archive = await readFile(
      path.join(outputDirectory, "pages-mcp-v7.3.1.zip"),
    );
    const entries = readZip(archive);
    const names = [...entries.keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "pages-mcp-v7.3.1/pages-mcp-v7.3.1.js",
        "pages-mcp-v7.3.1/pages-mcp-v7.3.1.js.sha256",
        "pages-mcp-v7.3.1/package.json",
        "pages-mcp-v7.3.1/README.md",
        "pages-mcp-v7.3.1/examples/clients/claude-cli.mcp.json",
        "pages-mcp-v7.3.1/examples/clients/codex-config.toml",
        "pages-mcp-v7.3.1/examples/clients/openclaw.json",
        "pages-mcp-v7.3.1/examples/clients/opencode.json",
      ]),
    );
    expect(names.every((name) => name.startsWith("pages-mcp-v7.3.1/"))).toBe(
      true,
    );
    const readme = entries.get("pages-mcp-v7.3.1/README.md")?.toString() ?? "";
    expect(readme.startsWith("# Pages MCP 7.3.1\n")).toBe(true);
    expect(readme).not.toContain("pages-mcp-v0.1.0");
    for (const name of names.filter((entry) => entry.includes("/examples/"))) {
      expect(entries.get(name)?.toString()).not.toContain("X.Y.Z");
    }

    // Run the shipped file next to the shipped manifest, as a user would after unzipping.
    const extracted = await makeTemporaryDirectory("pages-mcp-extracted-");
    for (const name of ["pages-mcp-v7.3.1.js", "package.json"]) {
      await writeFile(
        path.join(extracted, name),
        entries.get(`pages-mcp-v7.3.1/${name}`) ?? "",
      );
    }
    const pages = await startPagesStub();
    try {
      const reply = await readInitializeReply(
        path.join(extracted, "pages-mcp-v7.3.1.js"),
        extracted,
        pages.url,
      );
      expect(reply).toMatchObject({
        result: { serverInfo: { name: "pages-mcp", version: "7.3.1" } },
      });
    } finally {
      pages.close();
    }
    const checksumFile = await readFile(
      path.join(outputDirectory, "pages-mcp-v7.3.1.zip.sha256"),
      "utf8",
    );
    expect(checksumFile).toBe(
      `${createHash("sha256").update(archive).digest("hex")}  pages-mcp-v7.3.1.zip\n`,
    );
  }, 90_000);

  async function runEntryPoint(argumentsList: string[]): Promise<void> {
    vi.resetModules();
    vi.mocked(console.info).mockClear();
    vi.mocked(console.error).mockClear();
    process.exitCode = 0;
    const originalArguments = process.argv;
    process.argv = [process.execPath, SCRIPT_PATH, ...argumentsList];
    try {
      await import("../../mcp/scripts/package-release");
      await vi.waitFor(() => {
        const reported =
          vi.mocked(console.info).mock.calls.length +
          vi.mocked(console.error).mock.calls.length;
        expect(reported).toBeGreaterThan(0);
      });
    } finally {
      process.argv = originalArguments;
    }
  }

  it("validates a tag with the tag command and prints only the version", async () => {
    await runEntryPoint(["tag", "mcp-v12.0.4"]);
    expect(console.info).toHaveBeenCalledExactlyOnceWith("12.0.4");
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);

    await runEntryPoint(["tag", "mcp-v12.0"]);
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[pages-mcp] Release failed. Check tag, package sources and output directory.",
    );
    expect(process.exitCode).toBe(1);
  });

  it("reports a usage error and an invalid tag without writing anything", async () => {
    const outputDirectory = path.join(
      await makeTemporaryDirectory("pages-mcp-real-"),
      "release",
    );
    const usage =
      "[pages-mcp] Release failed. Check tag, package sources and output directory.";
    for (const argumentsList of [
      [],
      ["mcp-v1.0.0", outputDirectory],
      ["package", "mcp-v1.0.0"],
      ["tag"],
      ["tag", "mcp-v1.0.0", outputDirectory],
    ]) {
      await runEntryPoint(argumentsList);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(usage);
      expect(process.exitCode).toBe(1);
    }

    await runEntryPoint(["package", "mcp-v1.2", outputDirectory]);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(usage);
    expect(process.exitCode).toBe(1);
    await expect(stat(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
