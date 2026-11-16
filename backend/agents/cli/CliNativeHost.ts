import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { omitSystemdServiceEnvironment } from "@/backend/agents/SystemdServiceEnvironment";
import { AgentError } from "@/backend/error/AgentErrors";
import { correlationEnvironment } from "@/backend/logging/LogCorrelation";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { planTemporaryEnvironment } from "../PlanRunTemporaryDirectory";
import { nativeProviderEnvironment } from "./CliEnvironment";

import type { AcpSessionProfile } from "@/backend/agents/acp/AcpDriver";
import type { CliSessionRequest } from "./CliContracts";

const execFileAsync = promisify(execFile);

/** The variables a login shell starts from; nothing of the Pages service reaches it. */
const LOGIN_PATH = "/usr/local/bin:/usr/bin:/bin";

/** Names of variables whose values are masked in every diagnostic of a YOLO session. */
const SECRET_NAME =
  /(?:token|secret|password|passwd|credential|api_?key|private_?key|auth)/iu;

/**
 * The host a YOLO session runs on natively: the Linux account that executes
 * it and that account's own login environment.
 * @remarks
 * Pages reads it anew for every session and keeps it only in memory; it is
 * never stored in a plan, run or chat record.
 */
export interface CliNativeHost {
  /** The name of the executing Linux account. */
  readonly account: string;
  /** Its real home folder, the `HOME` of the session and its shell. */
  readonly home: string;
  /** The account's login environment, with `PATH` as its login shell builds it. */
  readonly environment: Readonly<Record<string, string>>;
}

function parseEnvironment(output: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const entry of output.split("\0")) {
    const delimiter = entry.indexOf("=");
    const name = entry.slice(0, delimiter);
    if (delimiter > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
      environment[name] = entry.slice(delimiter + 1);
  }
  return environment;
}

/**
 * Reads the login environment of the account the server runs under.
 * @param directory - The working folder the session starts in.
 * @param signal - Ends the read with the start of the session.
 * @returns The account, its home and its login environment.
 * @throws {AgentError} `agent_native_host_unavailable` off Linux, for root,
 * or when the login shell does not answer with a `PATH`.
 * @remarks
 * The login shell starts from a minimal environment, so its profile files
 * decide `PATH` and every further variable, exactly as for a person who
 * signs in with this account; no variable of the Pages service, such as its
 * database address, reaches the session. Pages never changes the account,
 * never signs in as root and runs no `sudo`.
 */
export async function readNativeHost(
  directory: string,
  signal: AbortSignal,
): Promise<CliNativeHost> {
  const account = userInfo();
  if (process.platform !== "linux" || account.uid < 1 || !account.shell)
    throw new AgentError("agent_native_host_unavailable");
  let output: string;
  try {
    const result = await execFileAsync(
      account.shell,
      ["-lc", "exec /usr/bin/env -0"],
      {
        cwd: directory,
        env: {
          HOME: account.homedir,
          USER: account.username,
          LOGNAME: account.username,
          SHELL: account.shell,
          PATH: LOGIN_PATH,
          LANG: process.env.LANG ?? "C.UTF-8",
        },
        signal,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    output = result.stdout;
  } catch {
    // Child-process errors include their captured output, which may contain credentials.
    throw new AgentError("agent_native_host_unavailable");
  }
  const environment = parseEnvironment(output);
  if (!environment.PATH) throw new AgentError("agent_native_host_unavailable");
  environment.HOME = account.homedir;
  environment.XDG_RUNTIME_DIR ??= `/run/user/${account.uid}`;
  environment.DBUS_SESSION_BUS_ADDRESS ??= `unix:path=${environment.XDG_RUNTIME_DIR}/bus`;
  return {
    account: account.username,
    home: account.homedir,
    environment: omitSystemdServiceEnvironment(environment),
  };
}

/**
 * The environment of a native YOLO worker.
 * @remarks
 * The login environment comes first, with its `PATH` unchanged in front, so
 * every program the account installed stays reachable; the folders of the
 * runner and of Node follow. Only the sign-in and session folder of the
 * provider stays that of the model connection, so the session keeps exactly
 * its connection; it is no boundary on the host.
 */
export function nativeHostEnvironment(
  request: Pick<
    CliSessionRequest,
    "home" | "provider" | "file" | "toolFile" | "temporaryDirectory"
  >,
  host: CliNativeHost,
): Record<string, string> {
  const searchPath = [
    ...new Set([
      ...(host.environment.PATH ?? "").split(path.delimiter),
      path.dirname(request.toolFile ?? request.file),
      path.dirname(process.execPath),
    ]),
  ]
    .filter((entry) => entry !== "")
    .join(path.delimiter);
  return {
    ...host.environment,
    PATH: searchPath,
    HOME: host.home,
    ...nativeProviderEnvironment(request.home, request.provider),
    ...(request.temporaryDirectory
      ? planTemporaryEnvironment(request.temporaryDirectory)
      : {}),
    ...correlationEnvironment(),
  };
}

/**
 * Turns a worker request into its native start: no namespace, no bind mount,
 * the real home and the host's login environment.
 */
export function nativeHostRequest(
  request: CliSessionRequest,
  host: CliNativeHost,
): CliSessionRequest {
  return {
    ...request,
    hostEnvironment: nativeHostEnvironment(request, host),
    isWorkingDirectoryReadOnly: false,
  };
}

/** Records in the run what a native YOLO session may do; the provider's own switches stay as its profile states them. */
export function nativeHostProfile(
  profile: AcpSessionProfile,
  host: CliNativeHost,
): AcpSessionProfile {
  return {
    ...profile,
    unattended: `${profile.unattended}; native process of the account ${host.account}, no sandbox of Pages`,
    permissions: {
      ...profile.permissions,
      execution: "native host process, no namespace or container of Pages",
      account: host.account,
      home: host.home,
      files: "every path the account may read or write",
    },
  };
}

/**
 * Masks the values of secret-looking host variables and recognizable tokens
 * in every line a YOLO session reports; a file the session reads never
 * reaches a log in plain text through this path.
 */
export function redactNativeHost(
  text: string,
  host: CliNativeHost | undefined,
): string {
  if (!host) return text;
  let masked = text;
  for (const [name, secret] of Object.entries(host.environment)) {
    if (SECRET_NAME.test(name) && secret.length >= 8)
      masked = masked.replaceAll(secret, "[redacted]");
  }
  return redactCredentials(masked)
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      "[redacted]",
    )
    .replace(
      /\b(?:gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/gu,
      "[redacted]",
    )
    .replace(
      /((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|authorization)["']?\s*[=:]\s*["']?)(?:Bearer\s+)?[^\s,;"'}]+/giu,
      "$1[redacted]",
    );
}
