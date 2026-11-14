import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { omitSystemdServiceEnvironment } from "@/backend/agents/SystemdServiceEnvironment";
import { agentPlaywrightServer } from "@/backend/service/agents/tools/AgentPlaywrightSession";
import { providerToolIds } from "@/backend/service/agents/tools/AgentToolRegistry";
import { agentToolAdapterVersion } from "@/backend/service/agents/tools/AgentToolSession";
import { AgentError } from "@/backend/error/AgentErrors";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import {
  preparePlanTemporaryDirectory,
  planTemporaryEnvironment,
} from "../PlanRunTemporaryDirectory";
import { fullEnvironmentTemporaryArguments } from "./CliFullEnvironmentTemporaryDirectory";

import { sessionAcpProvider } from "./CliSessionChecks";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpSessionProfile } from "@/backend/agents/acp/AcpDriver";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation } from "@/backend/service/agents/tools/AgentToolContracts";
import type { CliHome, CliSessionRequest } from "./CliContracts";
import type { VerifiedStart } from "./CliSessionChecks";
import type { CliLocator } from "./CliLocator";

const execFileAsync = promisify(execFile);

/** Private login environment of the explicitly bound host owner, never persisted in plan records. */
export interface CliFullEnvironment {
  readonly home: CliHome;
  readonly environment: Readonly<Record<string, string>>;
}

async function readOwnerShellEnvironment(
  input: AgentPlanSessionInput,
  signal: AbortSignal,
  owner: {
    readonly shell: string;
    readonly homedir: string;
    readonly username: string;
  },
): Promise<string> {
  const context = input.resourceContext;
  const temporaryDirectory = context
    ? await preparePlanTemporaryDirectory({
        runId: context.runId,
        stepId: context.sessionScopeId ?? context.stepId,
      })
    : null;
  const shellArguments = ["-lc", "exec /usr/bin/env -0"];
  const arguments_ = temporaryDirectory
    ? await fullEnvironmentTemporaryArguments({
        temporaryDirectory,
        workingDirectory: input.directory,
        file: owner.shell,
        arguments: shellArguments,
      })
    : shellArguments;
  try {
    const result = await execFileAsync(
      temporaryDirectory ? "/usr/bin/bwrap" : owner.shell,
      [...arguments_],
      {
        cwd: input.directory,
        env: {
          ...omitSystemdServiceEnvironment(process.env),
          HOME: owner.homedir,
          USER: owner.username,
          LOGNAME: owner.username,
          SHELL: owner.shell,
          ...(temporaryDirectory ? planTemporaryEnvironment() : {}),
        },
        signal,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return result.stdout;
  } catch {
    // Child-process errors include their captured output, which may contain credentials.
    throw new AgentError("plan_full_environment_owner_unavailable");
  }
}

/** Reads the login shell environment under the current Linux identity; never changes identity or host configuration. */
export async function prepareFullEnvironment(
  input: AgentPlanSessionInput,
  signal: AbortSignal,
): Promise<CliFullEnvironment> {
  if (
    input.chat ||
    input.purpose ||
    !input.beforeStart ||
    !input.fullEnvironment ||
    input.fullEnvironment.ownerId !==
      process.env.PAGES_FULL_ENVIRONMENT_OWNER_ID
  )
    throw new AgentError("plan_full_environment_forbidden");
  await input.beforeStart();
  const owner = userInfo();
  if (process.platform !== "linux" || owner.uid < 1 || !owner.shell)
    throw new AgentError("plan_full_environment_owner_unavailable");
  const output = await readOwnerShellEnvironment(input, signal, {
    shell: owner.shell,
    homedir: owner.homedir,
    username: owner.username,
  });
  const environment: Record<string, string> = {};
  for (const entry of output.split("\0")) {
    const delimiter = entry.indexOf("=");
    const name = entry.slice(0, delimiter);
    if (delimiter > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
      environment[name] = entry.slice(delimiter + 1);
  }
  if (!environment.PATH)
    throw new AgentError("plan_full_environment_owner_unavailable");
  environment.HOME = owner.homedir;
  environment.XDG_RUNTIME_DIR = `/run/user/${owner.uid}`;
  environment.DBUS_SESSION_BUS_ADDRESS ??= `unix:path=${environment.XDG_RUNTIME_DIR}/bus`;
  return {
    home: {
      root: owner.homedir,
      home: owner.homedir,
      config: owner.homedir,
      work: input.directory,
    },
    environment: omitSystemdServiceEnvironment(environment),
  };
}

/** Finds an executable in the owner's login PATH, then uses the isolated provider's tool resolution without invoking it. */
export async function fullEnvironmentExecutable(
  binary: string,
  environment: CliFullEnvironment,
  fallback: () => Promise<string | null>,
): Promise<string> {
  for (const directory of environment.environment.PATH.split(path.delimiter)) {
    const candidate = path.resolve(environment.home.work, directory, binary);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  const managed = await fallback();
  if (managed) return managed;
  throw new AgentError("cli_not_executable");
}

/** Retains the native YOLO protocol while recording that there is no filesystem or host boundary. */
export function fullEnvironmentProfile(
  profile: AcpSessionProfile,
  ownerName: string,
): AcpSessionProfile {
  return {
    ...profile,
    unattended:
      "Full environment: native YOLO, no isolation, all host owner rights; no approval prompts",
    permissions: {
      ...profile.permissions,
      sandbox: "none",
      files: "full host owner access",
      shell: "on",
      settings: "owner configuration",
      fullEnvironmentOwner: ownerName,
    },
  };
}

/** Replaces the connection environment completely; connection credentials and home redirects never shadow owner logins. */
export function fullEnvironmentRequest(
  request: CliSessionRequest,
  owner: CliFullEnvironment,
): CliSessionRequest {
  return {
    ...request,
    home: owner.home,
    fullEnvironment: owner.environment,
    isWorkingDirectoryReadOnly: false,
  };
}

/** Masks inherited credential variables as well as recognizable tokens; no home credential inventory is logged. */
export function redactFullEnvironment(
  text: string,
  owner: CliFullEnvironment | undefined,
): string {
  let masked = text;
  for (const [name, secret] of Object.entries(owner?.environment ?? {})) {
    if (
      /(?:token|secret|password|credential|api_?key|private_?key)/iu.test(
        name,
      ) &&
      secret.length >= 8
    )
      masked = masked.replaceAll(secret, "[redacted]");
  }
  if (!owner) return masked;
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
      /((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|authorization)["']?\s*[=:]\s*["']?)(?:Bearer\s+)?[^\s,;"'}]+/giu,
      "$1[redacted]",
    );
}

/** Verifies the owner environment and executable paths without touching connection credentials. */
export async function verifyFullEnvironmentStart(
  input: AgentPlanSessionInput,
  signal: AbortSignal,
  dependencies: {
    readonly locations?: ReadonlyMap<AgentToolId, AgentToolLocation>;
    readonly locator: Pick<CliLocator, "find" | "locate">;
  },
): Promise<VerifiedStart> {
  const { locations, locator } = dependencies;
  const provider = sessionAcpProvider(input);
  if (!provider) throw new AgentError("provider_invalid");
  const owner = await prepareFullEnvironment(input, signal);
  const driver = acpDriverFor(provider);
  const runnerNames = {
    codex_cli: "codex",
    claude_code: "claude",
    opencode: "opencode",
    antigravity: "agy",
  };
  const file = await fullEnvironmentExecutable(
    runnerNames[provider],
    owner,
    async () =>
      locations?.get(providerToolIds(provider)[0])?.file ??
      (await locator.find(provider)).path,
  );
  const adapterId = providerToolIds(provider).at(-1);
  const adapter =
    (adapterId ? locations?.get(adapterId)?.file : undefined) ??
    (await locator.locate(driver.binary)).path;
  if (!adapter) throw new AgentError(driver.errors.adapterMissing);
  return {
    provider,
    owner,
    home: owner.home,
    file,
    adapter,
    adapterVersion: agentToolAdapterVersion(provider, locations),
    browser: locations ? await agentPlaywrightServer(input, locations) : null,
  };
}
