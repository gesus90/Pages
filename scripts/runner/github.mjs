import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

function git(args, context, input) {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      {
        cwd: context.directory,
        env: context.environment,
        timeout: 20_000,
        maxBuffer: 65536,
      },
      (error, stdout, stderr) =>
        resolve({ ok: !error, stdout, stderr, code: error?.code }),
    );
    child.stdin.on("error", () => child.kill());
    child.stdin.end(input);
  });
}

function probe(result) {
  if (result.ok) return { allowed: true, reason: "verified" };
  if (
    /load key|bad permissions|unprotected private key|no such identity|host key verification failed|remote host identification has changed/i.test(
      result.stderr,
    )
  )
    return { allowed: null, reason: "unavailable" };
  const denied =
    typeof result.code === "number" &&
    /Permission denied \(publickey\)|Repository not found|write access.*not granted|read.only|deploy key.*(read|writ)|permission to .* denied/i.test(
      result.stderr,
    );
  return {
    allowed: denied ? false : null,
    reason: denied ? "denied" : "unavailable",
  };
}

function environment(directory, key, knownHosts) {
  const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;
  const ssh = [
    "ssh",
    "-F",
    "/dev/null",
    "-i",
    key,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHosts}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
  ];
  return {
    HOME: directory,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_VARIANT: "ssh",
    GIT_SSH_COMMAND: ssh.map(quote).join(" "),
    GIT_AUTHOR_NAME: "Pages access probe",
    GIT_AUTHOR_EMAIL: "probe@pages.invalid",
    GIT_COMMITTER_NAME: "Pages access probe",
    GIT_COMMITTER_EMAIL: "probe@pages.invalid",
  };
}

/** Reads refs and probes receive-pack with dry-run only; no remote reference or checkout is created. */
export async function githubAccess(message) {
  if (
    message.version !== 1 ||
    message.type !== "github-access" ||
    !/^[a-f0-9-]{36}$/.test(message.requestId) ||
    typeof message.repository !== "string" ||
    message.repository.length > 240 ||
    !/^[a-z\d-]+\/[a-z\d_][a-z\d_.-]*$/i.test(message.repository)
  )
    throw new Error("Invalid GitHub probe");
  const unavailable = { allowed: null, reason: "unavailable" };
  const reply = {
    version: 1,
    type: "github-access-result",
    requestId: message.requestId,
    repository: message.repository,
    read: unavailable,
    write: unavailable,
  };
  let directory;
  try {
    const key =
      process.env.PAGES_RUNNER_GITHUB_KEY ??
      join(homedir(), ".config/pages-runner/github_ed25519");
    const knownHosts =
      process.env.PAGES_RUNNER_GITHUB_KNOWN_HOSTS ??
      join(homedir(), ".config/pages-runner/github_known_hosts");
    if (
      ![key, knownHosts].every(
        (file) => isAbsolute(file) && !/[\0\r\n]/.test(file),
      )
    )
      return reply;
    await access(key, constants.R_OK);
    await access(knownHosts, constants.R_OK);
    directory = await mkdtemp(join(tmpdir(), "pages-github-"));
    const context = {
      directory,
      environment: environment(directory, key, knownHosts),
    };
    const repository = `git@github.com:${message.repository}.git`;
    reply.read = probe(await git(["ls-remote", "--", repository], context));
    const initialized = await git(["init", "--bare", "--quiet", "."], context);
    if (!initialized.ok) return reply;
    const tree = await git(
      ["hash-object", "-t", "tree", "-w", "--stdin"],
      context,
      "",
    );
    if (!tree.ok) return reply;
    const commit = await git(
      ["commit-tree", tree.stdout.trim()],
      context,
      "Pages non-mutating access probe\n",
    );
    if (!commit.ok) return reply;
    const ref = `refs/heads/pages-access-probe-${randomUUID()}`;
    const existing = await git(
      ["ls-remote", "--exit-code", "--", repository, ref],
      context,
    );
    if (existing.code !== 2 || existing.stdout.trim()) return reply;
    reply.write = probe(
      await git(
        [
          "-c",
          "core.hooksPath=/dev/null",
          "push",
          "--dry-run",
          "--no-verify",
          "--porcelain",
          "--",
          repository,
          `${commit.stdout.trim()}:${ref}`,
        ],
        context,
      ),
    );
    return reply;
  } catch {
    return reply;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
