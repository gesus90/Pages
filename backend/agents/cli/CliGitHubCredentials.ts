import {
  chmod,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import { quoteCliArgument } from "./CliEnvironment";
import { endTaggedProcesses } from "./CliProcessScan";

import type { AgentPlanGitHubAccess } from "@/backend/service/agents/AgentPlanGitHubCredentials";

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
  readonly cleanup: () => Promise<void>;
}

interface GitHubPreparation {
  readonly instanceId: string;
  readonly access: AgentPlanGitHubAccess;
  readonly gh: string | null;
  readonly searchPath: string;
}

function credentialHelper(repository: string, gh: string): string {
  // The wrapper only filters destinations; gh implements authentication and the protocol response.
  return `#!/bin/sh
[ "$1" = get ] || exit 0
protocol=
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
[ "$host" = github.com ] || exit 0
repository=$(printf '%s' "$repository" | tr '[:upper:]' '[:lower:]')
repository=\${repository%/}
repository=\${repository%.git}
[ "$repository" = ${quoteCliArgument(repository.toLowerCase())} ] || exit 0
printf 'protocol=https\\nhost=github.com\\n\\n' | ${quoteCliArgument(gh)} auth git-credential get
`;
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

function redactor(token: string): (text: string) => string {
  const secrets = [
    ...new Set([
      token,
      encodeURIComponent(token),
      Buffer.from(`x-access-token:${token}`).toString("base64"),
      Buffer.from(token).toString("base64"),
      JSON.stringify(token).slice(1, -1),
    ]),
  ].sort((left, right) => right.length - left.length);
  return (text) =>
    secrets.reduce(
      (masked, secret) => masked.replaceAll(secret, "[redacted]"),
      text,
    );
}

/** Creates per-session credentials under a protected instance folder, outside every connection HOME. */
export class CliGitHubCredentials {
  private readonly root: string;

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
    } catch {
      if (directory !== null) await this.remove(directory);
      throw new AgentError("secret_unavailable");
    }
  }

  /** Removes crash leftovers at server startup, after ending every process tagged with their session. */
  public async recover(): Promise<void> {
    const root = await realpath(this.root);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const instanceId = CREDENTIAL_DIRECTORY_PATTERN.exec(entry.name)?.[1];
      if (
        !entry.isDirectory() ||
        !instanceId ||
        !INSTANCE_PATTERN.test(instanceId)
      )
        continue;
      const cleanup = await endTaggedProcesses(instanceId);
      if (cleanup.remaining !== 0)
        throw new AgentError("credential_cleanup_failed");
      await this.remove(path.join(root, entry.name));
    }
  }

  private async configure(
    directory: string,
    input: GitHubPreparation,
  ): Promise<CliGitHubAccess> {
    const { access, gh } = input;
    // gh must not migrate an old single-account config by calling /user or writing inside the read-only mount.
    await writeFile(path.join(directory, "config.yml"), 'version: "1"\n', {
      mode: 0o600,
      flag: "wx",
    });
    const environment: Record<string, string> = {
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
      ...gitEnvironment([["credential.helper", ""]]),
    };
    const result: CliGitHubAccess = {
      directory,
      environment,
      status:
        access.status === "available"
          ? "GitHub CLI not installed"
          : access.reason,
      redact: (text) => text,
      cleanup: () => this.remove(directory),
    };
    if (access.status !== "available" || gh === null) return result;
    const { repository, token } = access;
    const helperFile = path.join(directory, "git-credential.sh");
    await writeFile(
      path.join(directory, "hosts.yml"),
      `github.com:\n    git_protocol: https\n    user: x-access-token\n    oauth_token: ${JSON.stringify(token)}\n    users:\n        x-access-token:\n            oauth_token: ${JSON.stringify(token)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(helperFile, credentialHelper(repository, gh), {
      mode: 0o600,
      flag: "wx",
    });
    return {
      ...result,
      status: `project connection for ${repository}`,
      redact: redactor(token),
      environment: {
        ...environment,
        PATH: `${path.dirname(gh)}${path.delimiter}${input.searchPath}`,
        GH_REPO: repository,
        ...gitEnvironment([
          ["credential.helper", ""],
          ["credential.helper", `!/bin/sh ${quoteCliArgument(helperFile)}`],
          ["credential.useHttpPath", "true"],
          [
            `url.https://github.com/${repository}.insteadOf`,
            `git@github.com:${repository}`,
          ],
          [
            `url.https://github.com/${repository}.insteadOf`,
            `ssh://git@github.com/${repository}`,
          ],
        ]),
      },
    };
  }

  private async remove(directory: string): Promise<void> {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      throw new AgentError("credential_cleanup_failed");
    }
  }
}
