import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Reuses Pages' existing connection homes; no credentials are moved or copied. */
export async function localAgentAccounts() {
  const root = process.env.PAGES_RUNNER_LOCAL_AGENTS_DIRECTORY;
  if (!root?.startsWith("/"))
    throw new Error("Local Pages agent directory required");
  const entries = await readdir(root).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const accounts = [];
  for (const id of entries
    .filter((entry) => /^[a-f0-9-]{36}$/u.test(entry))
    .sort()
    .slice(0, 32)) {
    const home = join(root, id, "home");
    const metadata = await lstat(home).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (
      metadata?.isDirectory() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid()
    )
      accounts.push({ id, home });
  }
  return accounts;
}

/** Resolves only a previously installed Pages account selected by its connection ID. */
export async function localAgentHome(accountId, options = {}) {
  if (options.isLinkedProvider) await prepareLinkedHome(accountId);
  const accounts = await localAgentAccounts();
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error("Local Pages agent account unavailable");
  const root = process.env.PAGES_RUNNER_LOCAL_AGENTS_DIRECTORY;
  return {
    home: account.home,
    mounts: [
      "--tmpfs",
      root,
      "--bind",
      dirname(account.home),
      dirname(account.home),
    ],
  };
}

async function prepareLinkedHome(accountId) {
  const root = process.env.PAGES_RUNNER_LOCAL_AGENTS_DIRECTORY;
  if (!root?.startsWith("/") || !/^[a-f0-9-]{36}$/u.test(accountId))
    throw new Error("Invalid local linked account");
  for (const directory of [
    root,
    join(root, accountId),
    join(root, accountId, "home"),
    join(root, accountId, "opencode"),
    ...["config", "state", "cache", "data"].map((name) =>
      join(root, accountId, "home", name),
    ),
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid()
    )
      throw new Error("Unmanaged local linked account");
  }
}

/** Matches the connection layout of AgentCredentialStore without exposing a sibling account. */
export function localCliEnvironment(home) {
  const root = dirname(home);
  return {
    CODEX_HOME: join(root, "codex"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    GEMINI_HOME: join(root, "antigravity"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(root, "opencode"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
  };
}

/** Adds the existing managed CLI generations to PATH without installing or changing a release. */
export async function localToolPath(root, inherited) {
  if (typeof root !== "string" || !root.startsWith("/"))
    throw new Error("Local tool directory required");
  const directories = [];
  for (const id of ["codex", "claude", "opencode", "antigravity_acp"]) {
    const pointer = await readFile(join(root, id, "active.json"), "utf8").catch(
      (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (!pointer) continue;
    const name = JSON.parse(pointer).current;
    if (
      typeof name !== "string" ||
      !/^[\w.-]+$/u.test(name) ||
      [".", ".."].includes(name)
    )
      throw new Error("Invalid local tool generation");
    const release = join(root, id, "releases", name);
    directories.push(
      id === "antigravity_acp"
        ? release
        : join(release, "node_modules", ".bin"),
    );
  }
  return [...directories, inherited ?? "/usr/local/bin:/usr/bin:/bin"].join(
    ":",
  );
}
