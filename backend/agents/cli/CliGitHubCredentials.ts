import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { readOwnedNamespace } from "@/definition/AcpNamespace";

import { quoteCliArgument } from "./CliEnvironment";
import { openCliGitBridge, writeGitBridgeClient } from "./CliGitBridge";
import { gitPublishScript } from "./CliGitPublishScript";
import { endTaggedProcesses, readScopeSince } from "./CliProcessScan";
import { settleOwnedNamespace } from "./CliOwnedNamespace";

import type { TaggedProcessScope } from "./CliProcessScan";
import type { GitHubWriteAccess } from "@/backend/github/GitHubGitAccess";
import type {
  AgentPlanGitBridgeGrant,
  AgentPlanGitHubAccess,
} from "@/backend/service/agents/AgentPlanGitHubCredentials";
import type { AcpCredentialLeftover } from "@/definition/AcpResource";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";

const INSTANCE_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
const CREDENTIAL_DIRECTORY_PATTERN = /^acp-github-([a-f\d-]{36})-[a-z\d]{6}$/iu;

/** One session's private gh configuration and destination-filtered native credential helper. */
export interface CliGitHubAccess {
  readonly directory: string;
  /** Paths and switches only; the token is never an environment variable. */
  readonly environment: Readonly<Record<string, string>>;
  readonly status: string;
  /** Masks the exact credential and common Git/HTTP encodings before they leave ACP. */
  readonly redact: (text: string) => string;
  /** The exact values `redact` masks, for output that arrives in pieces such as a terminal. */
  readonly secrets?: readonly string[];
  /** Persists server-owned namespace evidence before the adapter receives a turn. */
  readonly recordNamespace: (owner: AcpNamespaceOwner) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

interface GitHubPreparation {
  readonly instanceId: string;
  readonly access: AgentPlanGitHubAccess;
  readonly gh: string | null;
  readonly searchPath: string;
  /** The Git route over a host identity, only for a step the operator named. */
  readonly bridge?: AgentPlanGitBridgeGrant | null;
}

/** The Git settings of a session, as far as its routes differ. */
interface GitRoutes {
  readonly helperFile: string;
  /** The repository whose token this session holds. */
  readonly tokenRepository: string | null;
  readonly bridge: {
    readonly grant: AgentPlanGitBridgeGrant;
    readonly clientFile: string;
  } | null;
}

/** Reads the request Git sends a helper; a password line of an erase request is read and dropped. */
const READ_CREDENTIAL_REQUEST = `protocol=
host=
repository=
while IFS='=' read -r key credential; do
  [ -n "$key" ] || break
  case "$key" in
    protocol) protocol=$credential ;;
    host) host=$credential ;;
    path) repository=$credential ;;
  esac
done
[ "$protocol" = https ] || exit 0
[ "$host" = github.com ] || exit 0`;

const TOKEN_REPAIR =
  "A project manager must store a valid token for this repository under Project > Integrations > GitHub; the next session uses it. Local commits and branches are unchanged. Do not retry and do not look for other credentials; report this as blocked.";

const OTHER_REPOSITORY_REPAIR =
  "a repository outside this project: it is expired, revoked or wrong. A project manager must store a valid token under Project > Integrations > GitHub; the next session uses it. Do not retry and do not look for other credentials; report this as blocked.";

function credentialHelper(
  repository: string,
  gh: string,
  writeAccess: GitHubWriteAccess,
): string {
  const notice =
    writeAccess === "denied"
      ? `printf '%s\\n' ${quoteCliArgument(`Pages: GitHub refused push access to ${repository} for the stored project token when this session started. Reading may work; publishing will not. ${TOKEN_REPAIR}`)} >&2\n  `
      : "";
  // The wrapper only filters the host; gh implements authentication and the protocol response.
  // The project's repository keeps its notices; any other github.com repository is served the same
  // token so a step can fetch what that token may read. GitHub's own answer decides about access.
  return `#!/bin/sh
${READ_CREDENTIAL_REQUEST}
repository=$(printf '%s' "$repository" | tr '[:upper:]' '[:lower:]')
repository=\${repository%/}
repository=\${repository%.git}
project=0
[ "$repository" = ${quoteCliArgument(repository.toLowerCase())} ] && project=1
case "$1" in
  get)
  if [ "$project" = 1 ]; then
  ${notice}:
  fi
  printf 'protocol=https\\nhost=github.com\\n\\n' | ${quoteCliArgument(gh)} auth git-credential get
  ;;
  erase)
  # Git erases a credential only after GitHub answered 401 for it.
  if [ "$project" = 1 ]; then
    printf '%s\\n' ${quoteCliArgument(`Pages: GitHub rejected the stored project token for ${repository}: it is expired, revoked or wrong. ${TOKEN_REPAIR}`)} >&2
  else
    printf '%s\\n' ${quoteCliArgument(`Pages: GitHub rejected the stored project token for ${OTHER_REPOSITORY_REPAIR}`)} >&2
  fi
  ;;
esac
`;
}

/** Hands out nothing: Git would only say that it could not read a user name. */
function missingCredentialHelper(reason: string): string {
  return `#!/bin/sh
[ "$1" = get ] || exit 0
${READ_CREDENTIAL_REQUEST}
printf '%s\\n' ${quoteCliArgument(`Pages: this session has no GitHub credential (${reason}). ${TOKEN_REPAIR}`)} >&2
`;
}

function connectionStatus(
  repository: string,
  writeAccess: GitHubWriteAccess,
): string {
  const states: Readonly<Record<GitHubWriteAccess, string>> = {
    verified: "push access verified at session start",
    rejected: "GitHub rejected the stored token at session start",
    denied: "GitHub refused push access at session start",
    unknown: "push access could not be checked at session start",
  };
  return `project connection for ${repository}: ${states[writeAccess]}`;
}

function gitEnvironment(
  settings: readonly (readonly [string, string])[],
): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: String(settings.length),
    ...Object.fromEntries(
      settings.flatMap(([key, value], index) => [
        [`GIT_CONFIG_KEY_${index}`, key],
        [`GIT_CONFIG_VALUE_${index}`, value],
      ]),
    ),
  };
}

function tokenRewrites(
  repository: string,
): readonly (readonly [string, string])[] {
  return [
    [
      `url.https://github.com/${repository}.insteadOf`,
      `git@github.com:${repository}`,
    ],
    [
      `url.https://github.com/${repository}.insteadOf`,
      `ssh://git@github.com/${repository}`,
    ],
  ];
}

/** Sends the bridged repository over SSH, which in this session only reaches the bridge. */
function bridgeSettings(
  grant: AgentPlanGitBridgeGrant,
  clientFile: string,
): readonly (readonly [string, string])[] {
  const { repository, sshAlias } = grant;
  const target = `url.ssh://git@github.com/${repository}.insteadOf`;
  return [
    [target, `https://github.com/${repository}`],
    [target, `git@github.com:${repository}`],
    [target, `git@${sshAlias}:${repository}`],
    [
      "core.sshCommand",
      `${quoteCliArgument(process.execPath)} ${quoteCliArgument(clientFile)}`,
    ],
    // Git would otherwise start the client with -G to find out what it is.
    ["ssh.variant", "simple"],
  ];
}

function gitSettings(
  routes: GitRoutes,
): readonly (readonly [string, string])[] {
  const { helperFile, tokenRepository, bridge } = routes;
  return [
    ["credential.helper", ""],
    ["credential.helper", `!/bin/sh ${quoteCliArgument(helperFile)}`],
    ...(tokenRepository === null
      ? []
      : ([["credential.useHttpPath", "true"]] as const)),
    ...(tokenRepository === null || bridge !== null
      ? []
      : tokenRewrites(tokenRepository)),
    ...(bridge === null ? [] : bridgeSettings(bridge.grant, bridge.clientFile)),
  ];
}

/** The token and the encodings Git and HTTP show it in. */
function tokenForms(token: string): readonly string[] {
  return [
    ...new Set([
      token,
      encodeURIComponent(token),
      Buffer.from(`x-access-token:${token}`).toString("base64"),
      Buffer.from(token).toString("base64"),
      JSON.stringify(token).slice(1, -1),
    ]),
  ].sort((left, right) => right.length - left.length);
}

function redactor(token: string): (text: string) => string {
  const secrets = tokenForms(token);
  return (text) =>
    secrets.reduce(
      (masked, secret) => masked.replaceAll(secret, "[redacted]"),
      text,
    );
}

/**
 * The legacy time bound from directory creation, or null when unavailable.
 *
 * @remarks
 * This bound does not establish process ownership or authorize a cleanup.
 */
async function creationScope(
  directory: string,
): Promise<TaggedProcessScope | null> {
  const { birthtimeMs, ctimeMs } = await stat(directory);
  if (birthtimeMs > 0)
    return readScopeSince(new Date(birthtimeMs).toISOString());
  const scope = await readScopeSince(new Date(ctimeMs).toISOString());
  return scope.earliestStart === Number.POSITIVE_INFINITY ? scope : null;
}

async function openNamespaceMarker(
  directory: string,
): Promise<AcpNamespaceOwner | null> {
  let file;
  try {
    file = await open(
      path.join(directory, "namespace.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 1024
    )
      throw new Error("Invalid namespace marker");
    return readOwnedNamespace(JSON.parse(await file.readFile("utf8")));
  } finally {
    await file.close();
  }
}

function writePrivate(file: string, content: string): Promise<void> {
  return writeFile(file, content, { mode: 0o600, flag: "wx" });
}

async function recordNamespaceMarker(
  directory: string,
  owner: AcpNamespaceOwner,
): Promise<void> {
  const file = await open(path.join(directory, "namespace.json"), "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(readOwnedNamespace(owner)));
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Keeps gh and Git inside the session: no server login, configuration or prompt reaches them. */
function isolatedEnvironment(directory: string): Record<string, string> {
  return {
    GH_CONFIG_DIR: directory,
    GH_HOST: "github.com",
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
    // An empty gh home must not fall back to the server account's desktop keyring.
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
  };
}

/** Creates per-session credentials under a protected instance folder, outside every connection HOME. */
export class CliGitHubCredentials {
  private readonly root: string;
  private unconfirmed: readonly AcpCredentialLeftover[] = [];

  public constructor(dataDirectory: string) {
    this.root = dataDirectory;
  }

  /**
   * Creates an empty gh home even without a token, preventing reuse of an earlier session's login.
   *
   * @remarks
   * Files are 0600 and the directory is 0700. The caller mounts only this
   * directory read-only, then removes it after stopping every session process.
   * A failed preparation removes its directory before reporting a safe error.
   */
  public async prepare(input: GitHubPreparation): Promise<CliGitHubAccess> {
    let directory: string | null = null;
    try {
      if (!INSTANCE_PATTERN.test(input.instanceId))
        throw new AgentError("secret_unavailable");
      directory = await mkdtemp(
        path.join(await realpath(this.root), `acp-github-${input.instanceId}-`),
      );
      await chmod(directory, 0o700);
      return await this.configure(directory, input);
    } catch (caughtError: unknown) {
      logCaughtError("CliGitHubCredentials", caughtError);

      if (directory !== null) await this.remove(directory);
      throw new AgentError("secret_unavailable");
    }
  }

  /**
   * Removes crash leftovers only after their recorded namespace has ended.
   *
   * @returns The leftovers whose cleanup stayed unconfirmed; they remain for the next start.
   *
   * @remarks
   * Legacy leftovers without a recorded namespace stay unconfirmed. Each
   * leftover is handled independently so one failure does not abort startup.
   */
  public async recover(
    preserved: ReadonlySet<string> = new Set(),
    unverified: ReadonlySet<string> = new Set(),
  ): Promise<readonly AcpCredentialLeftover[]> {
    const root = await realpath(this.root);
    const unconfirmed: AcpCredentialLeftover[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const instanceId = CREDENTIAL_DIRECTORY_PATTERN.exec(entry.name)?.[1];
      if (
        !entry.isDirectory() ||
        !instanceId ||
        !INSTANCE_PATTERN.test(instanceId)
      )
        continue;
      if (preserved.has(instanceId)) continue;
      if (unverified.has(instanceId)) {
        unconfirmed.push({
          directory: entry.name,
          instanceId,
          reason: "processes",
        });
        logDiagnostic(
          "CliGitHubCredentials",
          "error",
          "Local session owner is unverified; its credential residue is quarantined and no process is signalled.",
        );
        continue;
      }
      const leftover = await this.recoverLeftover(root, entry.name, instanceId);
      if (leftover) unconfirmed.push(leftover);
    }
    this.unconfirmed = unconfirmed;
    return unconfirmed;
  }

  /** The leftovers the startup could not clean up; secret-free, for administrators only. */
  public leftovers(): readonly AcpCredentialLeftover[] {
    return this.unconfirmed;
  }

  private async configure(
    directory: string,
    input: GitHubPreparation,
  ): Promise<CliGitHubAccess> {
    const { access, gh, bridge = null } = input;
    const helperFile = path.join(directory, "git-credential.sh");
    const hasToken = access.status === "available" && gh !== null;
    // gh must not migrate an old single-account config by calling /user or writing inside the read-only mount.
    await writeFile(path.join(directory, "config.yml"), 'version: "1"\n', {
      mode: 0o600,
      flag: "wx",
    });
    let status: string;
    if (hasToken) {
      status = connectionStatus(access.repository, access.writeAccess);
      await writeFile(
        path.join(directory, "hosts.yml"),
        `github.com:\n    git_protocol: https\n    user: x-access-token\n    oauth_token: ${JSON.stringify(access.token)}\n    users:\n        x-access-token:\n            oauth_token: ${JSON.stringify(access.token)}\n`,
        { mode: 0o600, flag: "wx" },
      );
      await writePrivate(
        helperFile,
        credentialHelper(access.repository, gh, access.writeAccess),
      );
    } else {
      status =
        access.status === "available"
          ? "GitHub CLI not installed"
          : access.reason;
      await writePrivate(helperFile, missingCredentialHelper(status));
    }
    const routes: GitRoutes = {
      helperFile,
      tokenRepository: hasToken ? access.repository : null,
      bridge: bridge && {
        grant: bridge,
        clientFile: path.join(directory, "git-bridge-client.cjs"),
      },
    };
    const publishTarget = await this.writePublish(directory, routes);
    const prepared: CliGitHubAccess = {
      directory,
      environment: {
        ...isolatedEnvironment(directory),
        ...(hasToken
          ? {
              PATH: `${path.dirname(gh)}${path.delimiter}${input.searchPath}`,
              GH_REPO: access.repository,
            }
          : {}),
        PAGES_GITHUB_ACCESS: status,
        ...publishTarget,
        ...gitEnvironment(gitSettings(routes)),
      },
      status,
      redact: hasToken ? redactor(access.token) : (text) => text,
      secrets: hasToken ? tokenForms(access.token) : [],
      recordNamespace: (owner) => recordNamespaceMarker(directory, owner),
      cleanup: () => this.remove(directory),
    };
    return routes.bridge
      ? this.withBridge(prepared, input.instanceId, routes.bridge)
      : prepared;
  }

  private async writePublish(
    directory: string,
    routes: GitRoutes,
  ): Promise<Record<string, string>> {
    const { tokenRepository, bridge } = routes;
    const repository = bridge?.grant.repository ?? tokenRepository;
    if (repository === null) return {};
    const publishFile = path.join(directory, "git-publish.sh");
    const origin = bridge
      ? `ssh://git@github.com/${repository}`
      : `https://github.com/${repository}`;
    await writePrivate(publishFile, gitPublishScript(repository, origin));
    return { PAGES_GIT_PUBLISH: publishFile };
  }

  /** The bridge starts last, so no later step of the preparation can leave it running. */
  private async withBridge(
    prepared: CliGitHubAccess,
    instanceId: string,
    route: NonNullable<GitRoutes["bridge"]>,
  ): Promise<CliGitHubAccess> {
    const { grant, clientFile } = route;
    const capability = randomBytes(32).toString("base64url");
    const socketPath = path.join(prepared.directory, "git-bridge.sock");
    await writeGitBridgeClient(clientFile, socketPath, capability);
    const endpoint = await openCliGitBridge({
      instanceId,
      socketPath,
      capability,
      grant,
    });
    const pushes =
      grant.pushRefs.length > 0
        ? `fetch and push to ${grant.pushRefs.join(", ")}`
        : "fetch only";
    const status = `${prepared.status}; Git for ${grant.repository} uses the host bridge (${pushes})`;
    return {
      ...prepared,
      status,
      environment: { ...prepared.environment, PAGES_GITHUB_ACCESS: status },
      redact: (text) =>
        prepared.redact(text).replaceAll(capability, "[redacted]"),
      secrets: [...(prepared.secrets ?? []), capability],
      cleanup: async () => {
        await endpoint.close();
        await prepared.cleanup();
      },
    };
  }

  /** Ends the processes of one leftover and removes it; null once both are confirmed. */
  private async recoverLeftover(
    root: string,
    name: string,
    instanceId: string,
  ): Promise<AcpCredentialLeftover | null> {
    const directory = path.join(root, name);
    try {
      const marker = await openNamespaceMarker(directory);
      const cleanup = marker
        ? {
            remaining: (await settleOwnedNamespace(marker, instanceId)) ? 0 : 1,
          }
        : await endTaggedProcesses(instanceId, await creationScope(directory));
      if (cleanup.remaining !== 0) {
        logDiagnostic(
          "CliGitHubCredentials",
          "error",
          "[pages] Interrupted session processes remain; credential cleanup will be retried at a later start.",
        );
        return { directory: name, instanceId, reason: "processes" };
      }
    } catch (error: unknown) {
      logCaughtError("CliGitHubCredentials", error);

      logDiagnostic(
        "CliGitHubCredentials",
        "error",
        "[pages] Interrupted session process cleanup could not be confirmed; credentials remain for a later retry.",
        error,
      );
      return { directory: name, instanceId, reason: "processes" };
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error: unknown) {
      logCaughtError("CliGitHubCredentials", error);

      logDiagnostic(
        "CliGitHubCredentials",
        "error",
        "[pages] Interrupted session processes ended, but credential cleanup failed and will be retried.",
        error,
      );
      return { directory: name, instanceId, reason: "removal" };
    }
    logDiagnostic(
      "CliGitHubCredentials",
      "info",
      "[pages] Removed credentials of an interrupted session.",
    );
    return null;
  }

  private async remove(directory: string): Promise<void> {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (caughtError: unknown) {
      logCaughtError("CliGitHubCredentials", caughtError);

      throw new AgentError("credential_cleanup_failed");
    }
  }
}
