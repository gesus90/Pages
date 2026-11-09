import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { planAcpLaunch } from "@/backend/agents/cli/CliAcpLaunch";
import { cleanupAcpStart } from "@/backend/agents/cli/CliAcpStartCleanup";
import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";
import { requireAcpIsolation } from "@/backend/agents/cli/CliSessionPlans";
import { PLAN_SESSIONS_DIRECTORY } from "@/backend/agents/cli/ClaudePlanSessionHome";
import { planBridgeUrl } from "@/backend/agents/acp/AcpLaunch";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { openCodeModelProvider } from "@/definition/AgentConnection";

import { planClaudeTerminal } from "./ClaudeTerminal";
import { planCodexTerminal } from "./CodexTerminal";
import { planOpenCodeTerminal } from "./OpenCodeTerminal";
import { TERMINAL_UNATTENDED_INSTRUCTION } from "./TerminalLaunch";
import { TerminalInputs } from "./TerminalInputs";
import { TERMINAL_ENVIRONMENT, TerminalProcess } from "./TerminalProcess";
import { TerminalRecorder } from "./TerminalRecorder";
import { TerminalRedactor } from "./TerminalRedactor";
import { TerminalScreen } from "./TerminalScreen";
import { TerminalSession } from "./TerminalSession";

import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type {
  CliCredentialAccess,
  CliHome,
  CliSessionRequest,
} from "@/backend/agents/cli/CliContracts";
import type { CliGitHubAccess } from "@/backend/agents/cli/CliGitHubCredentials";
import type { ClaudePlanSessionHome } from "@/backend/agents/cli/ClaudePlanSessionHome";
import type { AcpStartLifecycle } from "@/backend/service/agents/resources/AcpStartLifecycle";
import type { TerminalSignalSource } from "@/backend/service/agents/terminal/TerminalSignals";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AgentTerminalProvider } from "@/definition/AgentTerminal";
import type { TerminalLaunch, TerminalLaunchInput } from "./TerminalLaunch";
import type { TerminalHostStore } from "./TerminalStore";

/** The geometry a terminal starts with until a viewer with input rights resizes it. */
const INITIAL_SIZE = { columns: 120, rows: 36 } as const;

/** Where terminal sessions store their output and learn about inputs. */
export interface TerminalServices {
  readonly store: TerminalHostStore;
  readonly signals: TerminalSignalSource;
}

/** What `CliSessionExecution` verified and prepared for the start. */
export interface TerminalStartParts {
  readonly driver: AcpDriver;
  readonly provider: AgentTerminalProvider;
  readonly input: AgentPlanSessionInput;
  readonly mode: AcpPermissionMode;
  readonly cliFile: string;
  readonly home: CliHome;
  readonly scoped: ClaudePlanSessionHome | null;
  readonly credentials?: CliCredentialAccess;
  readonly github: CliGitHubAccess | null;
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
  readonly lifecycle?: AcpStartLifecycle;
  readonly terminals: TerminalServices;
}

/** The steps of a start that stay in `CliSessionExecution`: isolation, limits and the closeout. */
export interface TerminalStartHooks {
  readonly isolate: (
    request: CliSessionRequest,
    scoped: ClaudePlanSessionHome | null,
  ) => Promise<{
    readonly request: CliSessionRequest;
    readonly isIsolated: boolean;
  }>;
  readonly limit: (
    request: CliSessionRequest,
  ) => Promise<{ readonly request: CliSessionRequest; readonly label: string }>;
  readonly registerNamespace: (
    processId: number | null,
    request: CliSessionRequest,
    isPidNamespace: boolean,
  ) => Promise<AcpNamespaceOwner | undefined>;
  readonly secure: () => Promise<void>;
}

function planLaunch(
  provider: AgentTerminalProvider,
  launch: TerminalLaunchInput,
): Promise<TerminalLaunch> {
  if (provider === "claude_code") return planClaudeTerminal(launch);
  if (provider === "codex_cli")
    return Promise.resolve(planCodexTerminal(launch));
  return planOpenCodeTerminal(launch);
}

/** Values of the start the terminal must mask, with the encodings of the credentials. */
function secretsOf(
  parts: TerminalStartParts,
  launch: TerminalLaunch,
): readonly string[] {
  return [
    ...launch.secrets,
    ...(parts.credentials?.secrets ?? []),
    ...(parts.github?.secrets ?? []),
  ];
}

/** Masks the secrets of the session in a text the run keeps. */
function textRedactor(
  parts: TerminalStartParts,
  secrets: readonly string[],
): (text: string) => string {
  return (text) => {
    const withoutKey = parts.credentials?.redact(text) ?? text;
    let masked = parts.github?.redact(withoutKey) ?? withoutKey;
    for (const secret of secrets)
      if (secret) masked = masked.replaceAll(secret, "[redacted]");
    return masked;
  };
}

/** The home of the CLI process: the plan home of a Claude session inside the namespace. */
async function planned(
  parts: TerminalStartParts,
  hooks: TerminalStartHooks,
  home: CliHome,
): Promise<{
  readonly launch: TerminalLaunch;
  readonly request: CliSessionRequest;
  readonly isIsolated: boolean;
  readonly sessionDirectory: string;
}> {
  const { input, driver, mode } = parts;
  // Below the plan sessions of the run, so its purge removes what a crash left behind.
  const sessionDirectory =
    home === parts.scoped?.home
      ? path.join(home.root, "terminal", input.instanceId)
      : path.join(
          home.root,
          PLAN_SESSIONS_DIRECTORY,
          input.resourceContext?.runId ?? "unknown-run",
          "terminal",
          input.instanceId,
        );
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  const profile = driver.profile(mode, "plan");
  const acp = planAcpLaunch(driver, input, parts.cliFile, profile);
  const launch = await planLaunch(parts.provider, {
    input,
    mode,
    cliFile: parts.cliFile,
    home,
    sessionDirectory,
    mcp: input.mcp
      ? { url: planBridgeUrl(input.mcp), token: input.mcp.token }
      : null,
    driverEnvironment: {
      ...acp.environment,
      ...parts.credentials?.environmentFor(
        openCodeModelProvider(input.agent.model),
      ),
      ...parts.github?.environment,
    },
    configuration:
      "configuration" in profile &&
      typeof profile.configuration === "object" &&
      profile.configuration !== null
        ? Object.fromEntries(Object.entries(profile.configuration))
        : null,
    instruction: TERMINAL_UNATTENDED_INSTRUCTION,
  });
  const request: CliSessionRequest = {
    file: launch.file,
    arguments: launch.arguments,
    provider: parts.driver.provider,
    home,
    workingDirectory: input.directory,
    isWorkingDirectoryReadOnly: mode === "read_only",
    credentialDirectory: parts.github?.directory,
    environment: {
      ...launch.environment,
      ...TERMINAL_ENVIRONMENT,
      [RUN_INSTANCE_VARIABLE]: input.instanceId,
    },
    timeoutMs: input.options.timeoutMinutes * 60_000,
    signal: parts.signal,
    onLine: () => undefined,
    isTerminal: true,
  };
  const isolated = await hooks.isolate(request, parts.scoped);
  return {
    launch,
    request: isolated.request,
    isIsolated: isolated.isIsolated,
    sessionDirectory,
  };
}

/** What a start prepared before its process runs. */
type PlannedStart = Awaited<ReturnType<typeof planned>> & {
  readonly limited: {
    readonly request: CliSessionRequest;
    readonly label: string;
  };
  readonly secrets: readonly string[];
};

/** Plans the launch in the right home, isolates and limits it. */
async function prepareStart(
  parts: TerminalStartParts,
  hooks: TerminalStartHooks,
): Promise<PlannedStart> {
  let start = await planned(parts, hooks, parts.scoped?.home ?? parts.home);
  if (!start.isIsolated && parts.scoped)
    start = await planned(parts, hooks, parts.home);
  requireAcpIsolation(start.isIsolated, parts.mode, parts.input);
  const limited = await hooks.limit(start.request);
  if (parts.signal.aborted) throw new AgentPlanCancelledError();
  return { ...start, limited, secrets: secretsOf(parts, start.launch) };
}

/** Stores the terminal and builds the screen and the recorder its output goes through. */
async function openTerminal(
  parts: TerminalStartParts,
  start: PlannedStart,
  reply: (answer: string) => void,
): Promise<{
  readonly screen: TerminalScreen;
  readonly recorder: TerminalRecorder;
}> {
  const { input, terminals } = parts;
  const context = input.resourceContext;
  await terminals.store.open({
    instanceId: input.instanceId,
    runId: context?.runId ?? "",
    stepId: context?.sessionScopeId ?? context?.stepId ?? "",
    provider: parts.provider,
    ...INITIAL_SIZE,
    startedAt: new Date().toISOString(),
  });
  const screen = new TerminalScreen(INITIAL_SIZE, reply);
  const recorder = new TerminalRecorder({
    instanceId: input.instanceId,
    store: terminals.store,
    redactor: new TerminalRedactor(start.secrets),
    screen,
  });
  return { screen, recorder };
}

/** Takes the queued inputs of viewers for the running CLI. */
function connectInputs(
  parts: TerminalStartParts,
  start: PlannedStart,
  running: TerminalProcess,
  screen: TerminalScreen,
): TerminalInputs {
  const inputs = new TerminalInputs({
    instanceId: parts.input.instanceId,
    store: parts.terminals.store,
    target: {
      write: (keys) => running.write(keys),
      resize: (columns, rows) => {
        running.resize(columns, rows);
        screen.resize(columns, rows);
      },
    },
    interrupt: start.launch.interrupt,
  });
  inputs.start(parts.terminals.signals);
  return inputs;
}

/** Records the start, then wraps the running CLI as the plan session of the node. */
async function sessionOf(
  parts: TerminalStartParts,
  hooks: TerminalStartHooks,
  started: {
    readonly start: PlannedStart;
    readonly running: TerminalProcess;
    readonly screen: TerminalScreen;
    readonly recorder: TerminalRecorder;
  },
): Promise<TerminalSession> {
  const { start, running, screen, recorder } = started;
  const { input } = parts;
  const namespace = await hooks.registerNamespace(
    running.processId,
    start.limited.request,
    start.isIsolated,
  );
  if (parts.github && namespace) await parts.github.recordNamespace(namespace);
  const inputs = connectInputs(parts, start, running, screen);
  parts.observer.started({
    mode: "interactive",
    processId: running.processId,
    startedAt: new Date().toISOString(),
    arguments: start.launch.displayArguments,
    unattended: start.launch.unattended,
    surface: "terminal",
    ...(namespace ? { namespace } : {}),
  });
  return new TerminalSession({
    instanceId: input.instanceId,
    launch: start.launch,
    process: running,
    recorder,
    screen,
    inputs,
    store: parts.terminals.store,
    observer: parts.observer,
    signal: parts.signal,
    stepId: input.resourceContext?.stepId ?? "",
    redact: textRedactor(parts, start.secrets),
    listener: input.journal,
    effective: {
      mode: parts.mode,
      isolation: `${start.isIsolated ? "bubblewrap" : "none"}; ${start.limited.label}`,
      unattended: start.launch.unattended,
      ...(parts.github ? { github: parts.github.status } : {}),
    },
    isPidNamespace: start.isIsolated,
    secure: async () => {
      await hooks.secure();
      await rm(start.sessionDirectory, { recursive: true, force: true });
    },
  });
}

/**
 * Starts the CLI of a plan node in a pseudo terminal (PAGE-265).
 *
 * @remarks
 * The start keeps everything an ACP start does: the verified connection,
 * the exact model and effort, the profile of the mode, the Pages MCP server
 * of the step, bubblewrap and the limited unit. A Claude session gets its
 * private plan home inside the namespace; where bubblewrap does not work it
 * uses the connection's home like its ACP start. The terminal row exists
 * before the process starts, so the first output has a place.
 */
export async function startTerminalSession(
  parts: TerminalStartParts,
  hooks: TerminalStartHooks,
): Promise<PlanSession> {
  const start = await prepareStart(parts, hooks);
  let process: TerminalProcess | null = null;
  try {
    const { screen, recorder } = await openTerminal(parts, start, (answer) =>
      process?.write(answer),
    );
    await parts.lifecycle?.beforeSpawn();
    process = await TerminalProcess.start(start.limited.request, {
      ...INITIAL_SIZE,
      signal: parts.signal,
      onData: (chunk) => recorder.receive(chunk),
    });
    return await sessionOf(parts, hooks, {
      start,
      running: process,
      screen,
      recorder,
    });
  } catch (error: unknown) {
    logCaughtError("TerminalStart", error);
    await start.launch.monitor.close().catch(() => undefined);
    await cleanupAcpStart(process, {
      instanceId: parts.input.instanceId,
      github: parts.github,
      limited: start.limited,
      isPidNamespace: start.isIsolated,
    });
    throw error;
  }
}
