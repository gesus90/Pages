import { AcpSession } from "@/backend/agents/acp/AcpSession";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { pinnedAgentToolDriver } from "@/backend/service/agents/tools/AgentToolSession";

import { prepareClaudePlanSessionHome } from "./ClaudePlanSessionHome";
import {
  acpMcpServers,
  acpSessionRequest,
  isolationLabel,
} from "./CliAcpLaunch";
import { createCliEnvironment } from "./CliEnvironment";
import { captureOwnedNamespace } from "./CliOwnedNamespace";

import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AcpStartLifecycle } from "@/backend/service/agents/resources/AcpStartLifecycle";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type {
  ClaudePlanSessionHome,
  prepareClaudePlanSessionHome as prepareClaudeHomeFn,
} from "./ClaudePlanSessionHome";
import type { planAcpLaunch } from "./CliAcpLaunch";
import type { CliSessionRequest } from "./CliContracts";
import type { VerifiedStart } from "./CliSessionChecks";
import type {
  CliGitHubAccess,
  CliGitHubCredentials,
} from "./CliGitHubCredentials";
import type { CliLocator } from "./CliLocator";
import type { CliSessionContainment } from "./CliSessionCloseout";
import type { CliSessionProcess } from "./CliSessionProcess";
import type { acpPicaSupport } from "../acp/AcpPicaSupport";
import type { PicaCodexBundle } from "./PicaCodexBundle";
import type { PicaNativeArtifact } from "./PicaNativeArtifact";

/** The stop signal and the observer of one session start. */
export interface SessionControl {
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
  readonly lifecycle?: AcpStartLifecycle;
}

/** A session request, wrapped in its limited unit where the service manager provides one. */
export interface LimitedRequest {
  readonly request: CliSessionRequest;
  /** How the run record describes the limits. */
  readonly label: string;
}

/** Inputs required to construct a running {@link AcpSession} from a spawned worker. */
export interface OpenCliAcpSessionContext {
  readonly child: CliSessionProcess;
  readonly channel: AcpLineChannel;
  readonly driver: AcpDriver;
  readonly input: AgentPlanSessionInput;
  readonly start: VerifiedStart;
  readonly control: SessionControl;
  readonly profile: ReturnType<AcpDriver["profile"]>;
  readonly launch: ReturnType<typeof planAcpLaunch>;
  readonly picaNative: PicaNativeArtifact | null;
  readonly picaBundle: PicaCodexBundle | null;
  readonly picaSupport?: typeof acpPicaSupport;
  readonly isIsolated: boolean;
  readonly mode: AcpPermissionMode;
  readonly limited: LimitedRequest;
  readonly containment: CliSessionContainment;
  readonly github: CliGitHubAccess | null;
  readonly redact: (text: string) => string;
  readonly secure: () => Promise<void>;
}

/** Builds an {@link AcpSession} over an already connected CLI worker channel. */
export function openCliAcpSession(
  context: OpenCliAcpSessionContext,
): AcpSession {
  const {
    child,
    channel,
    driver,
    input,
    start,
    control,
    profile,
    launch,
    picaNative,
    picaBundle,
    isIsolated,
    mode,
    limited,
    containment,
    github,
    redact,
    secure,
  } = context;
  return new AcpSession(child, channel.stream, {
    instanceId: input.instanceId,
    driver: pinnedAgentToolDriver(
      driver,
      picaBundle?.version ?? start.adapterVersion,
    ),
    profile,
    request: acpSessionRequest(input, {
      ...launch,
      mcpServers: acpMcpServers(launch, start.browser, picaNative),
    }),
    observer: control.observer,
    signal: control.signal,
    isolation: `${isolationLabel(isIsolated, mode, driver)}; ${limited.label}`,
    containment,
    github: github?.status,
    redact,
    secure,
    cleanupAdapter: picaBundle?.cleanup,
    listener: input.chat?.listener ?? input.journal,
    openCodeDataHome:
      driver.provider === "opencode" ? start.home.config : undefined,
    picaSupport: context.picaSupport,
    codexHome:
      driver.provider === "codex_cli" && !input.chat
        ? start.home.config
        : undefined,
    notificationHandled: () => channel.acknowledge(),
    acceptsTurnInput: input.chat === undefined,
  });
}

/** A Claude plan session keeps its transcripts in a home of its own, so a retry resumes it and no other run reads it. */
export async function prepareScopedClaudeHome(
  driver: AcpDriver,
  input: AgentPlanSessionInput,
  start: VerifiedStart,
  claudeHome?: typeof prepareClaudeHomeFn,
): Promise<ClaudePlanSessionHome | null> {
  // An observer session keeps no transcript, so it needs no home of a plan run.
  if (
    driver.provider !== "claude_code" ||
    input.chat ||
    input.purpose === "observer"
  )
    return null;
  const prepare = claudeHome ?? prepareClaudePlanSessionHome;
  return prepare(start.home, {
    planId: input.resourceContext?.planId ?? "",
    runId: input.resourceContext?.runId ?? "",
    scopeId:
      input.resourceContext?.sessionScopeId ??
      input.resourceContext?.stepId ??
      "",
    sourceRunId: input.resourceContext?.sourceRunId,
  });
}

/**
 * Persists the identity of the process frame before the first ACP request.
 *
 * @remarks
 * The directly spawned process is the namespace init or, for a session
 * without a namespace such as every native YOLO session, the client of its
 * worker unit, whose control group holds every child and MCP server.
 * Its PID, start, owner and boot together with the unit
 * name let a later check prove the end of exactly this instance and let its
 * lease leave `spawning`.
 */
export async function registerAcpNamespace(options: {
  readonly resources: AcpResourceScheduler | undefined;
  readonly input: AgentPlanSessionInput;
  readonly processId: number | null;
  readonly request: CliSessionRequest;
  readonly containment: CliSessionContainment;
}): Promise<AcpNamespaceOwner | undefined> {
  const { resources, input, processId, request, containment } = options;
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

/** Prepares scoped GitHub CLI credentials and optional git bridge access for an ACP worker. */
export async function prepareCliGitHubAccess(
  dependencies: {
    readonly github?: Pick<CliGitHubCredentials, "prepare">;
    readonly locator: Pick<CliLocator, "locate">;
  },
  input: AgentPlanSessionInput,
  start: VerifiedStart,
  mode: AcpPermissionMode,
): Promise<CliGitHubAccess | null> {
  if (!dependencies.github) return null;
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

/** Cleans up temporary GitHub credentials and secures CLI credential storage after an ACP session. */
export async function secureCliAcpAccess(
  store: Pick<AgentCredentialStore, "secure">,
  input: AgentPlanSessionInput,
  start: VerifiedStart,
  github: CliGitHubAccess | null,
): Promise<void> {
  try {
    await github?.cleanup();
  } finally {
    await store.secure(input.agent.connection.id, start.provider);
  }
}

/** Loads chat-only native extensions on demand; plan sessions never import them. */
export async function preparePicaSession(options: {
  readonly driver: AcpDriver;
  readonly input: AgentPlanSessionInput;
  readonly launch: ReturnType<typeof planAcpLaunch>;
  readonly profile: ReturnType<AcpDriver["profile"]>;
  readonly tools?: Pick<AgentToolManagerService, "directory" | "retained">;
  readonly adapter: string;
  readonly adapterVersion?: string | null;
}): Promise<
  Pick<OpenCliAcpSessionContext, "picaNative" | "picaBundle" | "picaSupport">
> {
  if (!options.input.chat) return { picaNative: null, picaBundle: null };
  const pica = await import("./CliPicaSessionSetup");
  const picaNative = pica.selectPicaNativeArtifact({
    ...options,
    toolsDirectory: options.tools?.directory,
  });
  return {
    picaNative,
    picaBundle: await pica.picaCodexBundle(
      picaNative,
      options.input.directory,
      {
        file: options.adapter,
        version: options.adapterVersion,
        retained: () =>
          options.tools?.retained("codex_acp") ?? Promise.resolve(null),
      },
    ),
    picaSupport: pica.acpPicaSupport,
  };
}
