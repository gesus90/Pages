import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { localAgentAccounts, localAgentHome } from "./local-accounts.mjs";
import { store } from "./journal.mjs";

/** Stable account homes contain host-local logins and native sessions, never copied from the machine login. */
export function agentHome(directory, accountId) {
  if (typeof accountId !== "string" || !accountId || accountId.length > 400)
    throw new Error("Invalid runner agent account");
  return join(
    directory,
    "agents",
    createHash("sha256").update(accountId).digest("hex"),
  );
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid() ||
    metadata.mode & 0o077
  )
    throw new Error("Runner agent home is not private");
}

/** Prepares only an explicitly dispatched account, hiding sibling logins inside its namespace. */
export async function prepareAgentHome(directory, command) {
  if (command.program?.access === "full_environment") return null;
  if (command.agentAccount?.version !== 1) return null;
  if (process.env.PAGES_RUNNER_LOCAL === "1")
    return localAgentHome(command.agentAccount.id, {
      isLinkedProvider: Boolean(command.program?.linkedProvider),
    });
  const root = join(directory, "agents");
  const home = agentHome(directory, command.agentAccount.id);
  await privateDirectory(root);
  await privateDirectory(home);
  await store(join(home, "account.json"), { id: command.agentAccount.id });
  for (const name of [".claude", ".codex", ".config", ".local", ".cache"])
    await privateDirectory(join(home, name));
  const mounts = [];
  const machineHome = process.env.PAGES_RUNNER_CLI_HOME ?? homedir();
  for (const name of [
    ".claude",
    ".codex",
    ".config/opencode",
    ".local/share/opencode",
    ".pages-antigravity",
  ]) {
    const path = join(machineHome, name);
    const metadata = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (metadata) mounts.push("--tmpfs", path);
  }
  mounts.push("--tmpfs", root, "--bind", home, home);
  return { home, mounts };
}

function collectSecrets(record, secrets, key = "") {
  if (typeof record === "string") {
    if (
      /token|key|secret|password|authorization/i.test(key) &&
      record.length >= 8
    )
      secrets.add(record);
    return;
  }
  if (!record || typeof record !== "object") return;
  for (const [name, entry] of Object.entries(record))
    collectSecrets(entry, secrets, name);
}

/** Reads only this account's credential fields into a memory-only redactor. */
export async function accountSecrets(home) {
  const secrets = new Set();
  for (const name of [
    ...(process.env.PAGES_RUNNER_LOCAL === "1"
      ? [
          "../claude/.credentials.json",
          "../codex/auth.json",
          "../opencode/opencode/auth.json",
          "../antigravity/antigravity-acp/acp_token.json",
        ]
      : []),
    ".claude/.credentials.json",
    ".codex/auth.json",
    ".local/share/opencode/auth.json",
    ".pages-antigravity/antigravity-acp/acp_token.json",
  ]) {
    try {
      collectSecrets(
        JSON.parse(await readFile(join(home, name), "utf8")),
        secrets,
      );
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("Runner account credentials unreadable");
    }
  }
  return [...secrets];
}

/** Lists only named local accounts; credentials are never included in an inventory. */
export async function agentAccounts(directory) {
  if (process.env.PAGES_RUNNER_LOCAL === "1") return localAgentAccounts();
  const root = join(directory, "agents");
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const accounts = [];
  for (const name of names
    .filter((entry) => /^[a-f0-9]{64}$/u.test(entry))
    .sort()
    .slice(0, 32)) {
    const home = join(root, name);
    const metadata = await lstat(home);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid() ||
      metadata.mode & 0o077
    )
      continue;
    const account = JSON.parse(
      await readFile(join(home, "account.json"), "utf8"),
    );
    if (agentHome(directory, account.id) !== home)
      throw new Error("Invalid runner account identity");
    accounts.push({ id: account.id, home });
  }
  return accounts;
}
