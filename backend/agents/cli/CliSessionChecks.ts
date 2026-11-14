import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import {
  isAcpPermissionMode,
  nativeAcpProvider,
} from "@/definition/AgentConfiguration";
import { openCodeModelProvider } from "@/definition/AgentConnection";

import { createCliEnvironment } from "./CliEnvironment";
import { isOpenCodeApiAgent } from "./OpenCodeAgentModel";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type {
  AcpPermissionMode,
  NativeAcpProviderId,
} from "@/definition/AgentConfiguration";
import type { CliFullEnvironment } from "./CliFullEnvironment";
import type {
  CliHome,
  CliCredentialAccess,
  CliSessionRequest,
  CliStatusOutcome,
} from "./CliContracts";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { agentPlaywrightServer } from "@/backend/service/agents/tools/AgentPlaywrightSession";
import type {
  CliGitHubAccess,
  CliGitHubCredentials,
} from "./CliGitHubCredentials";
import type { CliLocator } from "./CliLocator";
import type { CliSessionContainment } from "./CliSessionCloseout";
import type { AgentCliRuntime } from "./AgentCliRuntime";

/** What a session start has verified about its connection. */
export interface VerifiedStart {
  readonly owner?: CliFullEnvironment;
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly file: string;
  /** The ACP entry point of this CLI connection. */
  readonly adapter: string | null;
  readonly adapterVersion?: string | null;
  readonly credentials?: CliCredentialAccess;
  readonly browser?: Awaited<ReturnType<typeof agentPlaywrightServer>>;
}

/** A PID namespace contains everything; otherwise only a worker unit frames the session. */
export function sessionContainment(
  isIsolated: boolean,
  request: CliSessionRequest,
): CliSessionContainment {
  if (isIsolated) return "pid_namespace";
  return request.unit ? "worker_unit" : "none";
}

/** The stored run mode of an ACP start; a start without one is refused. */
export function requireAcpMode(
  driver: AcpDriver,
  input: AgentPlanSessionInput,
): AcpPermissionMode {
  const mode =
    input.options.access === "full_environment" ? "yolo" : input.options.access;
  if (!isAcpPermissionMode(mode))
    throw new AgentError(driver.errors.modeRequired);
  return mode;
}

/** Requires the verified ACP entry point path for the driver. */
export function requireAdapter(
  adapter: string | null,
  driver: AcpDriver,
): string {
  if (adapter === null) throw new AgentError(driver.errors.adapterMissing);
  return adapter;
}

/** Records the namespace of a session with its GitHub access, where both exist. */
export async function recordGitHubNamespace(
  github: CliGitHubAccess | null,
  namespace: AcpNamespaceOwner | undefined,
): Promise<void> {
  if (github && namespace) await github.recordNamespace(namespace);
}

/** Every CLI plan runner and native Pica runner uses ACP, without a one-shot fallback. */
export function sessionAcpProvider(
  input: AgentPlanSessionInput,
): NativeAcpProviderId | null {
  const provider = input.agent.connection.provider;
  if (input.chat && (provider === "openrouter" || provider === "zai"))
    return null;
  return nativeAcpProvider(provider);
}

/** Reads the local CLI status or resolves API credentials for OpenRouter and z.AI sessions. */
export async function readConnectionStatus(
  dependencies: {
    readonly runtime: Pick<AgentCliRuntime, "adapter">;
    readonly apiCredentials?: (
      connection: AgentPlanSessionInput["agent"]["connection"],
    ) => Promise<CliCredentialAccess>;
  },
  input: AgentPlanSessionInput,
  options: {
    readonly home: CliHome;
    readonly signal: AbortSignal;
    readonly file?: string;
  },
): Promise<CliStatusOutcome> {
  const { home, signal, file } = options;
  const connection = input.agent.connection;
  if (isOpenCodeApiAgent(connection.provider)) {
    const adapter = await dependencies.runtime.adapter("opencode", file);
    const version = await adapter.version(home, signal);
    if (!version.ok) throw new AgentError(version.errorCode);
    const credentials = await dependencies.apiCredentials?.(connection);
    if (!credentials) throw new AgentError("secret_unavailable");
    return {
      outcome: { ok: true, detail: {} },
      accountLabel: null,
      credentials,
    };
  }
  const provider = nativeAcpProvider(connection.provider);
  if (provider === null) throw new AgentError("provider_invalid");
  const adapter = file
    ? await dependencies.runtime.adapter(provider, file)
    : await dependencies.runtime.adapter(provider);
  if (provider === "opencode") {
    const version = await adapter.version(home, signal);
    if (!version.ok) throw new AgentError(version.errorCode);
  }
  return adapter.readStatus(home, signal);
}

/** Refuses a start whose sign-in or model the status check does not confirm. */
export function validateSessionStatus(
  input: AgentPlanSessionInput,
  status: CliStatusOutcome,
  signal: AbortSignal,
): void {
  const provider = input.agent.connection.provider;
  if (signal.aborted) throw new AgentPlanCancelledError();
  if (!status.outcome.ok)
    throw new AgentError(
      provider === "opencode" ||
        status.outcome.errorCode === "cli_not_logged_in"
        ? status.outcome.errorCode
        : "plan_step_failed",
    );
  if (
    provider === "opencode" &&
    !status.credentials?.modelProviders.includes(
      openCodeModelProvider(input.agent.model),
    )
  )
    throw new AgentError("plan_model_unavailable");
}

/** Prepares isolated GitHub credentials for a CLI session when applicable. */
export async function prepareGitHubAccess(
  dependencies: {
    readonly github?: Pick<CliGitHubCredentials, "prepare">;
    readonly locator: Pick<CliLocator, "locate">;
  },
  input: AgentPlanSessionInput,
  options: {
    readonly start: VerifiedStart;
    readonly mode: AcpPermissionMode;
  },
): Promise<CliGitHubAccess | null> {
  const { start, mode } = options;
  if (start.owner || !dependencies.github) return null;
  const access =
    mode === "yolo" && input.github
      ? await input.github()
      : ({
          status: "unavailable",
          reason:
            mode === "read_only"
              ? "read-only session"
              : "no authorized project connection",
        } as const);
  const gh =
    access.status === "available"
      ? (await dependencies.locator.locate("gh")).path
      : null;
  return dependencies.github.prepare({
    instanceId: input.instanceId,
    access,
    gh,
    bridge: mode === "yolo" ? await input.gitBridge?.() : undefined,
    searchPath: createCliEnvironment(
      start.home,
      start.provider,
      start.adapter ?? start.file,
    ).PATH,
  });
}
