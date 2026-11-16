import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "smol-toml";

import { stageRunnerUpdate } from "./runner/update.mjs";
import { readRecord, store } from "./runner/journal.mjs";

const connectionId = "00000000-0000-4000-8000-000000000001";

/** Creates the private local machine pairing once and preserves the complete transport journal on update. */
export async function provisionLocalConfiguration(configFile, destination) {
  const config = parse(await readFile(configFile, "utf8"));
  const port = config.port ?? 3000;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid Pages loopback port");
  const endpoint = `ws://127.0.0.1:${port}/runner/v1/channel/${connectionId}`;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(destination));
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid() ||
    directory.mode & 0o077
  )
    throw new Error("Local runner directory must be owned and private");
  const configuredDatabase =
    config.databasePath ?? join(dirname(configFile), "data", "pages.duckdb");
  if (typeof configuredDatabase !== "string")
    throw new Error("Pages data directory required");
  const databasePath = resolve(dirname(configFile), configuredDatabase);
  await store(`${dirname(destination)}/local-paths.json`, {
    agents: `${dirname(databasePath)}/agents`,
    tools: `${dirname(configFile)}/tools`,
  });
  await provisionLocalRelease(dirname(destination));
  const previous = await readInstalledConfiguration(destination);
  if (previous) {
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(previous.token) ||
      !previous.runnerId ||
      !previous.sessionId
    )
      throw new Error("Existing local runner identity is incomplete");
    if (previous.endpoint !== endpoint)
      await store(destination, { ...previous, endpoint });
    return;
  }
  await store(destination, {
    endpoint,
    token: randomBytes(32).toString("base64url"),
    runnerId: randomUUID(),
    sessionId: randomUUID(),
    sequence: 0,
    jobs: [],
  });
}

/** Pins the initial local code; later Pages releases are offered through the runner channel. */
async function provisionLocalRelease(directory) {
  if (await readRecord(join(directory, "active-release.json"))) return;
  const source = fileURLToPath(new URL("./runner/", import.meta.url));
  const files = {};
  for (const name of await readdir(source))
    if (/^[a-z][a-z-]*\.mjs$/u.test(name))
      files[name] = await readFile(join(source, name), "utf8");
  const version = /const RUNNER_VERSION = "([0-9.]+)"/u.exec(
    files["transport.mjs"],
  )?.[1];
  if (!version) throw new Error("Local runner release version missing");
  const bytes = Buffer.from(JSON.stringify({ version, files }));
  const release = await stageRunnerUpdate(directory, {
    version,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    payload: bytes.toString("base64"),
  });
  await store(join(directory, "active-release.json"), {
    release,
    version,
    pending: false,
  });
}

async function readInstalledConfiguration(destination) {
  let previous;
  try {
    const metadata = await lstat(destination);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid() ||
      (metadata.mode & 0o777) !== 0o600
    )
      throw new Error("Local runner token must have mode 0600");
    previous = JSON.parse(await readFile(destination, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return previous;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [configFile, destination] = process.argv.slice(2);
  if (!configFile?.startsWith("/") || !destination?.startsWith("/"))
    throw new Error("Absolute Pages and runner configuration paths required");
  await provisionLocalConfiguration(configFile, destination);
}
