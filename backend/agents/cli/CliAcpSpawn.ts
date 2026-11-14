import path from "node:path";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logDiagnostic } from "@/backend/logging/Logger";
import { isAcpPermissionMode } from "@/definition/AgentConfiguration";
import { pinnedAgentToolDriver } from "@/backend/service/agents/tools/AgentToolSession";

import {
  acpMcpServers,
  acpSessionRequest,
  isolationLabel,
} from "./CliAcpLaunch";
import { createCliEnvironment } from "./CliEnvironment";
import { captureOwnedNamespace } from "./CliOwnedNamespace";
import { ACP_WORKER_LIMITS } from "./CliWorkerUnit";

import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";
import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliSessionRequest } from "./CliContracts";
import type {
  CliGitHubAccess,
  CliGitHubCredentials,
} from "./CliGitHubCredentials";
import type { CliLocator } from "./CliLocator";
import type { VerifiedStart } from "./CliSessionChecks";
import type { CliSessionContainment } from "./CliSessionCloseout";
import type { CliWorkerUnits } from "./CliWorkerUnit";
import type { PicaCodexBundle } from "./PicaCodexBundle";
import type { PicaNativeArtifact } from "./PicaNativeArtifact";

/** A session request, wrapped in its limited unit where the service manager provides one. */
export interface LimitedAcpRequest {
  readonly request: CliSessionRequest;
  /** How the run record describes the limits. */
  readonly label: string;
}

/** Arguments for {@link prepareAcpGitHubAccess}. */
export interface PrepareAcpGitHubOptions {
  readonly input: AgentPlanSessionInput;
  readonly start: VerifiedStart;
  readonly mode: AcpPermissionMode;
  readonly github?: Pick<CliGitHubCredentials, "prepare">;
  readonly locator: Pick<CliLocator, "locate">;
}

/** Arguments for {@link registerAcpNamespace}. */
export interface RegisterAcpNamespaceOptions {
  readonly input: AgentPlanSessionInput;
  readonly processId: number | null;
  readonly request: CliSessionRequest;
  readonly containment: CliSessionContainment;
  readonly resources?: Pick<AcpResourceScheduler, "registerNamespace">;
}

/** Arguments for {@link buildAcpSessionContext}. */
export interface BuildAcpSessionContextOptions {
  readonly driver: AcpDriver;
  readonly input: AgentPlanSessionInput;
  readonly start: VerifiedStart;
  readonly mode: AcpPermissionMode;
  readonly launch: AcpLaunch;
  readonly profile: ReturnType<AcpDriver["profile"]>;
  readonly observer: PlanSessionObserver;
  readonly signal: AbortSignal;
  readonly isIsolated: boolean;
  readonly limitedLabel: string;
  readonly containment: CliSessionContainment;
  readonly github: CliGitHubAccess | null;
  readonly redact: (text: string) => string;
  readonly picaNative: PicaNativeArtifact | null;
  readonly picaBundle: PicaCodexBundle | null;
  readonly secure: () => Promise<void>;
  readonly acknowledge: () => void;
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

/** Prepares scoped GitHub credentials for an ACP worker session. */
export async function prepareAcpGitHubAccess(
  options: PrepareAcpGitHubOptions,
): Promise<CliGitHubAccess | null> {
  const { input, start, mode, github, locator } = options;
  if (start.owner || !github) return null;
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
    access.status === "available" ? (await locator.locate("gh")).path : null;
  return github.prepare({
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

/** Cleans up temporary GitHub and provider credentials after an ACP session closes. */
export async function secureAcpSession(options: {
  readonly input: AgentPlanSessionInput;
  readonly start: VerifiedStart;
  readonly github: CliGitHubAccess | null;
  readonly store: Pick<AgentCredentialStore, "secure">;
}): Promise<void> {
  const { input, start, github, store } = options;
  if (start.owner) return;
  try {
    await github?.cleanup();
  } finally {
    await store.secure(input.agent.connection.id, start.provider);
  }
}

/** Persists the identity of the process frame before the first ACP request. */
export async function registerAcpNamespace(
  options: RegisterAcpNamespaceOptions,
): Promise<AcpNamespaceOwner | undefined> {
  const { input, processId, request, containment, resources } = options;
  if (containment === "none") return undefined;
  // A spawn that failed has no process; the unit frame still confirms its closeout.
  if (!processId && containment === "worker_unit") return undefined;
  if (!processId) throw new AcpCleanupUnconfirmedError();
  const identity = await captureOwnedNamespace(processId);
  const namespace = request.unit
    ? { ...identity, unit: request.unit.name }
    : identity;
  await resources?.registerNamespace(input.instanceId, namespace);
  return namespace;
}

/** Starts the worker in a limited unit of the service manager when available. */
export async function limitAcpWorkerUnit(options: {
  readonly request: CliSessionRequest;
  readonly input: AgentPlanSessionInput;
  readonly units?: Pick<CliWorkerUnits, "isAvailable" | "wrap">;
  readonly onMissingUnits: () => void;
}): Promise<LimitedAcpRequest> {
  const { request, input, units, onMissingUnits } = options;
  if (units && (await units.isAvailable())) {
    const wrapped = await units.wrap(request, input.instanceId);
    return {
      request: { ...wrapped.request, unit: wrapped.unit },
      label: `unit ${wrapped.unit.name}: memory ${ACP_WORKER_LIMITS.memoryMax}, swap ${ACP_WORKER_LIMITS.memorySwapMax}, tasks ${ACP_WORKER_LIMITS.tasksMax}, CPU ${ACP_WORKER_LIMITS.cpuQuota}, OOM score ${ACP_WORKER_LIMITS.oomScoreAdjust}`,
    };
  }
  if (input.chat || input.options.access === "full_environment")
    throw new AgentError("acp_worker_unit_unavailable");
  onMissingUnits();
  return { request, label: "no limited unit" };
}

/** Logs a one-time diagnostic warning when plan workers run without a service unit. */
export function warnMissingWorkerUnits(): void {
  logDiagnostic(
    "CliSessionExecution",
    "warn",
    "Pages runs plan agents without a limited service unit because the service manager of the server account does not start one.",
  );
}

/** Builds the context passed to a newly spawned ACP session. */
export function buildAcpSessionContext(
  options: BuildAcpSessionContextOptions,
): AcpSessionContext {
  const {
    driver,
    input,
    start,
    mode,
    launch,
    profile,
    observer,
    signal,
    isIsolated,
    limitedLabel,
    containment,
    github,
    redact,
    picaNative,
    picaBundle,
    secure,
    acknowledge,
  } = options;
  return {
    instanceId: input.instanceId,
    driver: pinnedAgentToolDriver(driver, start.adapterVersion),
    profile,
    request: acpSessionRequest(input, {
      ...launch,
      mcpServers: acpMcpServers(launch, start.browser, picaNative),
    }),
    observer,
    signal,
    isolation: `${start.owner ? "full environment: no isolation, full host owner access" : isolationLabel(isIsolated, mode, driver)}; ${limitedLabel}`,
    containment,
    github: github?.status,
    redact,
    secure,
    cleanupAdapter: picaBundle?.cleanup,
    listener: input.chat?.listener ?? input.journal,
    ...(driver.provider === "opencode"
      ? {
          openCodeUsagePath: path.join(
            start.home.config,
            "opencode",
            "opencode.db",
          ),
          // The data directory is three levels above this connection's provider folder.
          openCodePricingDirectory: path.resolve(start.home.config, "../../.."),
          isFreeModel: input.agent.isFree === true,
          openRouterModelIds: input.agent.connection.openRouterModelIds ?? {},
        }
      : {}),
    notificationHandled: acknowledge,
    acceptsTurnInput: input.chat === undefined,
  };
}
