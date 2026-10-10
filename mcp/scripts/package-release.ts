import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

/** Result of one release packaging run. */
export interface ReleaseResult {
  readonly version: string;
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly bundleSha256: string;
}

/** Inputs of one release packaging run. */
export interface ReleaseOptions {
  readonly tag: string;
  readonly outputDirectory: string;
  /** Source tree of the MCP package; defaults to the package that contains this script. */
  readonly packageDirectory?: string;
  /** Process environment scanned for values that must not appear in the archive. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** One file of the release archive. */
export interface ArchiveEntry {
  readonly name: string;
  readonly content: Buffer;
}

const TAG_PATTERN = /^mcp-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_FIELD = /^(\s*"version":\s*")([^"]+)(")/m;
// Scheme and host only; a bracketed IPv6 literal is one host.
const URL_PATTERN = /\bhttps?:\/\/(?:\[[0-9a-f:.]+\]|[^\s"'<>)\]`/:?#]+)/gi;
const TOKEN_SHAPED_PATTERN =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])|Bearer\s+[A-Za-z0-9._~+/-]{20,}/;
// SDK identifiers can be 43 characters, including these two public schema export names.
const BUNDLE_TOKEN_PATTERN =
  /["'](?!ElicitationCompleteNotificationParamsSchema["']|SubscriptionsAcknowledgedNotificationSchema["'])[A-Za-z0-9_-]{43}["']|Bearer\s+[A-Za-z0-9._~+/-]{20,}/;
const DOCUMENTATION_HOSTS = [
  "modelcontextprotocol.io",
  "github.com",
  "raw.githubusercontent.com",
  "json-schema.org",
];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const SECRET_ENVIRONMENT_NAMES = [
  "PAGES_TOKEN",
  "PAGES_URL",
  "PAGES_OAUTH_ISSUER",
  "PAGES_MCP_RESOURCE",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];
const EXAMPLE_BUNDLE_PLACEHOLDER = "pages-mcp-vX.Y.Z.js";
const TEXT_EXTENSIONS = new Set([".js", ".md", ".json", ".toml", ".sha256"]);
const SOURCE_ENTRIES = ["build.config.ts", "tsconfig.json", "src"];
// 1980-01-01 00:00:00, the earliest ZIP timestamp, keeps the archive independent of the build time.
const ZIP_DOS_DATE = 0x0021;
const ZIP_UNIX_FILE_MODE = (0o100644 << 16) >>> 0;

/**
 * Extracts the version from a release tag.
 *
 * @param tag - Git tag name, exactly `mcp-vMAJOR.MINOR.PATCH`.
 * @returns The `MAJOR.MINOR.PATCH` version.
 * @throws {Error} When the tag does not have exactly that form.
 */
export function parseReleaseTag(tag: string): string {
  const match = TAG_PATTERN.exec(tag);
  if (!match || match[0] !== tag) {
    throw new Error("Release tags must have the form mcp-vMAJOR.MINOR.PATCH.");
  }
  return tag.slice("mcp-v".length);
}

/**
 * Sets the version in the README of the package.
 *
 * @param readme - README text of the working copy.
 * @param currentVersion - Version currently written in the README.
 * @param version - Version taken from the release tag.
 * @returns The README text carrying the release version.
 * @throws {Error} When the README does not name the current version in its title and bundle filename.
 */
export function stampReadme(
  readme: string,
  currentVersion: string,
  version: string,
): string {
  const title = `# Pages MCP ${currentVersion}`;
  const bundle = `pages-mcp-v${currentVersion}.js`;
  if (!readme.includes(title) || !readme.includes(bundle)) {
    throw new Error(
      "The README must name the package version and bundle file.",
    );
  }
  return readme
    .replaceAll(title, `# Pages MCP ${version}`)
    .replaceAll(bundle, `pages-mcp-v${version}.js`);
}

/**
 * Builds the manifest shipped next to the bundle.
 *
 * @param version - Version taken from the release tag.
 * @returns Manifest text describing the dependency-free CommonJS bundle.
 *
 * @remarks
 * The development manifest declares `"type": "module"` for the build tooling. Next to the CommonJS bundle that
 * declaration would make Node refuse to start it, so the shipped manifest declares `commonjs`.
 */
export function createReleaseManifest(version: string): string {
  const manifest = {
    name: "pages-mcp",
    version,
    license: "MIT",
    type: "commonjs",
    main: `pages-mcp-v${version}.js`,
    engines: { node: ">=24.0.0" },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Sets the `version` field of a development manifest without reformatting it.
 *
 * @param manifest - Text of `package.json`.
 * @param version - Version taken from the release tag.
 * @returns The manifest text and the version it declared before.
 * @throws {Error} When the manifest has no `version` field.
 */
export function stampManifest(
  manifest: string,
  version: string,
): { readonly text: string; readonly currentVersion: string } {
  const match = VERSION_FIELD.exec(manifest);
  if (!match) {
    throw new Error("package.json must declare a version.");
  }
  const valueStart = match.index + match[1].length;
  const text = `${manifest.slice(0, valueStart)}${version}${manifest.slice(valueStart + match[2].length)}`;
  return { text, currentVersion: match[2] };
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isPlaceholderHost(hostname: string): boolean {
  return (
    hostname === "example.com" ||
    hostname.endsWith(".example.com") ||
    LOOPBACK_HOSTS.includes(hostname) ||
    DOCUMENTATION_HOSTS.includes(hostname)
  );
}

function findUnexpectedHosts(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).filter((candidate) => {
    // The pinned SDK constructs an IPv6 URL from a validated runtime value.
    if (candidate === "http://[${value}") return false;
    try {
      return !isPlaceholderHost(new URL(candidate).hostname);
    } catch {
      return true;
    }
  });
}

/**
 * Rejects archive content that could carry a credential or an instance address.
 *
 * @param entries - Files that are about to be archived.
 * @param environment - Process environment whose secret-bearing values must not appear.
 * @throws {Error} Naming the offending file, never the offending value.
 */
export function assertNoSecrets(
  entries: readonly ArchiveEntry[],
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const secrets = SECRET_ENVIRONMENT_NAMES.map(
    (name) => environment[name],
  ).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  for (const entry of entries) {
    const text = entry.content.toString("utf8");
    if (secrets.some((secret) => text.includes(secret))) {
      throw new Error(`${entry.name} contains a configured environment value.`);
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    const tokenPattern =
      path.extname(entry.name) === ".js"
        ? BUNDLE_TOKEN_PATTERN
        : TOKEN_SHAPED_PATTERN;
    if (tokenPattern.test(text)) {
      throw new Error(`${entry.name} contains a token-shaped value.`);
    }
    if (findUnexpectedHosts(text).length > 0) {
      throw new Error(
        `${entry.name} contains an address outside the placeholder hosts.`,
      );
    }
  }
}

/**
 * Writes a deterministic ZIP archive: sorted entries, fixed timestamps, no extra fields.
 *
 * @param entries - Files with slash-separated relative names.
 * @returns The archive bytes.
 */
export function createZipArchive(entries: readonly ArchiveEntry[]): Buffer {
  const sorted = [...entries].sort((first, second) =>
    first.name < second.name ? -1 : 1,
  );
  const records: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content, { level: 9 });
    const checksum = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(ZIP_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    // The central header repeats the local fields from "version needed" to "extra length".
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(ZIP_UNIX_FILE_MODE, 38);
    central.writeUInt32LE(offset, 42);
    records.push(local, name, compressed);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, directoryBytes, end]);
}

async function buildBundle(
  packageDirectory: string,
  manifest: string,
  version: string,
  readme: string,
): Promise<Buffer> {
  const workDirectory = await mkdtemp(
    path.join(tmpdir(), "pages-mcp-release-"),
  );
  try {
    await writeFile(path.join(workDirectory, "package.json"), manifest);
    await writeFile(path.join(workDirectory, "README.md"), readme);
    for (const name of SOURCE_ENTRIES) {
      await cp(
        path.join(packageDirectory, name),
        path.join(workDirectory, name),
        {
          recursive: true,
        },
      );
    }
    await symlink(
      path.join(packageDirectory, "node_modules"),
      path.join(workDirectory, "node_modules"),
      "dir",
    );
    const build = spawnSync(process.execPath, ["build.config.ts"], {
      cwd: workDirectory,
      encoding: "utf8",
    });
    if (build.status !== 0) {
      throw new Error("The bundle build failed.");
    }
    return await readFile(
      path.join(workDirectory, "dist", `pages-mcp-v${version}.js`),
    );
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function readExamples(
  packageDirectory: string,
  bundleName: string,
): Promise<ArchiveEntry[]> {
  const directory = path.join(packageDirectory, "examples", "clients");
  const names = (await readdir(directory)).sort();
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(path.join(directory, name), "utf8");
      return {
        name: `examples/clients/${name}`,
        content: Buffer.from(
          text.replaceAll(EXAMPLE_BUNDLE_PLACEHOLDER, bundleName),
        ),
      };
    }),
  );
}

/**
 * Builds the release archive for a tag in an isolated working copy.
 *
 * @param options - Tag, output directory and optional source and environment overrides.
 * @returns Version, archive location and both SHA-256 values.
 * @throws {Error} For an invalid tag, a failing or non-reproducible build, or content that fails the secret scan.
 *
 * @remarks
 * Nothing is written for an invalid tag. The tree of the package is never modified: the version is set only in the
 * temporary working copies that are built, so no commit on the main branch is needed.
 */
export async function packageRelease(
  options: ReleaseOptions,
): Promise<ReleaseResult> {
  const version = parseReleaseTag(options.tag);
  const packageDirectory =
    options.packageDirectory ?? fileURLToPath(new URL("..", import.meta.url));
  const stamped = stampManifest(
    await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    version,
  );
  const readme = stampReadme(
    await readFile(path.join(packageDirectory, "README.md"), "utf8"),
    stamped.currentVersion,
    version,
  );
  const first = await buildBundle(
    packageDirectory,
    stamped.text,
    version,
    readme,
  );
  const second = await buildBundle(
    packageDirectory,
    stamped.text,
    version,
    readme,
  );
  if (sha256(first) !== sha256(second)) {
    throw new Error("Two clean builds produced different bundles.");
  }
  const bundleName = `pages-mcp-v${version}.js`;
  const prefix = `pages-mcp-v${version}`;
  const entries: ArchiveEntry[] = [
    { name: bundleName, content: first },
    {
      name: `${bundleName}.sha256`,
      content: Buffer.from(`${sha256(first)}  ${bundleName}\n`),
    },
    {
      name: "package.json",
      content: Buffer.from(createReleaseManifest(version)),
    },
    { name: "README.md", content: Buffer.from(readme) },
    ...(await readExamples(packageDirectory, bundleName)),
  ].map((entry) => ({ ...entry, name: `${prefix}/${entry.name}` }));
  assertNoSecrets(entries, options.environment ?? process.env);
  const archive = createZipArchive(entries);
  const archivePath = path.join(options.outputDirectory, `${prefix}.zip`);
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(archivePath, archive);
  await writeFile(
    `${archivePath}.sha256`,
    `${sha256(archive)}  ${prefix}.zip\n`,
  );
  return {
    version,
    archivePath,
    archiveSha256: sha256(archive),
    bundleSha256: sha256(first),
  };
}

const USAGE =
  "Usage: package-release.ts tag <mcp-vX.Y.Z> | package <mcp-vX.Y.Z> <output-directory>";

async function runCommandLine(argumentsList: readonly string[]): Promise<void> {
  try {
    const [command, tag, outputDirectory] = argumentsList;
    if (command === "tag" && argumentsList.length === 2) {
      console.info(parseReleaseTag(tag));
    } else if (command === "package" && argumentsList.length === 3) {
      const result = await packageRelease({ tag, outputDirectory });
      console.info(`version ${result.version}`);
      console.info(`archive ${result.archivePath}`);
      console.info(`archive-sha256 ${result.archiveSha256}`);
      console.info(`bundle-sha256 ${result.bundleSha256}`);
    } else {
      throw new Error(USAGE);
    }
  } catch {
    console.error(
      "[pages-mcp] Release failed. Check tag, package sources and output directory.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runCommandLine(process.argv.slice(2));
}
