import { openCodeModelProvider } from "@/definition/AgentConnection";

import { preparePicaCodexBundle } from "./PicaCodexBundle";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { McpServer } from "@agentclientprotocol/sdk";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { AcpSessionRequest } from "@/backend/agents/acp/AcpSession";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";
import type {
  CliCredentialAccess,
  CliHome,
  CliSessionRequest,
} from "./CliContracts";
import type { CliGitHubAccess } from "./CliGitHubCredentials";
import type { PicaCodexBundle } from "./PicaCodexBundle";
import type {
  PicaNativeArtifact,
  PicaNativeRunner,
} from "./PicaNativeArtifact";

/** What the isolated ACP worker of one session is started from. */
export interface AcpWorkerParts {
  readonly driver: AcpDriver;
  readonly input: AgentPlanSessionInput;
  readonly mode: AcpPermissionMode;
  readonly launch: AcpLaunch;
  /** The ACP entry point of the connection. */
  readonly adapter: string;
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly credentials?: CliCredentialAccess;
  readonly github: CliGitHubAccess | null;
  /** The verified native build of a Pica chat; `null` for every other session. */
  readonly picaNative: PicaNativeArtifact | null;
  /** The prepared Codex bundle of a Pica chat over Codex. */
  readonly picaBundle: PicaCodexBundle | null;
  readonly signal: AbortSignal;
  readonly onLine: CliSessionRequest["onLine"];
}

/** The program a worker runs: the adapter, the native Pica build or the Pica Codex bundle. */
function workerProgram(
  parts: AcpWorkerParts,
): Pick<CliSessionRequest, "file" | "arguments" | "readOnlyFiles"> {
  const { driver, picaBundle, picaNative, adapter } = parts;
  const driverArguments = driver.arguments ?? [];
  if (!picaBundle)
    return {
      file: picaNative?.executable ?? adapter,
      arguments: driverArguments,
    };
  return {
    file: process.execPath,
    arguments: [picaBundle.entry, ...driverArguments],
    readOnlyFiles: [
      picaBundle.directory,
      picaBundle.packageRoot,
      picaBundle.runnerRoot,
      process.execPath,
    ],
  };
}

function workerEnvironment(
  parts: AcpWorkerParts,
): Readonly<Record<string, string>> {
  const { launch, picaBundle, picaNative, credentials, github, input } = parts;
  return {
    ...launch.environment,
    ...(picaBundle && picaNative
      ? { CODEX_PATH: picaNative.executable, PAGES_PICA_CODEX: "1" }
      : {}),
    ...(picaNative?.runner === "opencode" ? { PAGES_PICA_OPENCODE: "1" } : {}),
    ...credentials?.environmentFor(openCodeModelProvider(input.agent.model)),
    ...github?.environment,
  };
}

/**
 * Builds the request of an ACP worker before isolation and limits wrap it.
 *
 * @param parts - The verified pieces of the session start.
 * @returns The request; a Pica bundle and a read-only mode keep the workspace read-only.
 */
export function acpWorkerRequest(parts: AcpWorkerParts): CliSessionRequest {
  const { input, mode, picaBundle } = parts;
  const program = workerProgram(parts);
  return {
    ...program,
    readOnlyFiles: [
      ...(program.readOnlyFiles ?? []),
      ...(input.chat?.browserStateDirectory
        ? [input.chat.browserStateDirectory]
        : []),
    ],
    provider: parts.provider,
    home: parts.home,
    workingDirectory: input.directory,
    isWorkingDirectoryReadOnly: picaBundle !== null || mode === "read_only",
    credentialDirectory: parts.github?.directory,
    environment: workerEnvironment(parts),
    timeoutMs: input.options.timeoutMinutes * 60_000,
    signal: parts.signal,
    onLine: parts.onLine,
  };
}

/** Prepares the Codex bundle a Pica chat over Codex runs; `null` for every other session. */
export function picaCodexBundle(
  picaNative: PicaNativeArtifact | null,
  directory: string,
  adapter: string,
): PicaCodexBundle | null {
  return picaNative?.runner === "codex"
    ? preparePicaCodexBundle(directory, adapter, picaNative.directory)
    : null;
}

/** The MCP servers of a session; a native Pica build reaches no browser server. */
export function acpMcpServers(
  launch: AcpLaunch,
  browser: McpServer | null | undefined,
  picaNative: PicaNativeArtifact | null,
): readonly McpServer[] {
  return browser && !picaNative
    ? [...launch.mcpServers, browser]
    : launch.mcpServers;
}

/** The native Pica build a provider runs; `null` for a provider without one. */
export function picaNativeRunner(
  provider: AcpDriver["provider"],
): PicaNativeRunner | null {
  if (provider === "codex_cli") return "codex";
  if (provider === "opencode") return "opencode";
  return null;
}

/** Plans the launch of a session with the driver of its runner. */
export function planAcpLaunch(
  driver: AcpDriver,
  input: AgentPlanSessionInput,
  file: string,
  profile: ReturnType<AcpDriver["profile"]>,
): AcpLaunch {
  return driver.plan({
    instanceId: input.instanceId,
    runnerFile: file,
    profile,
    mcp: input.mcp ?? null,
    purpose: input.chat ? "chat" : (input.purpose ?? "plan"),
    model: {
      model: input.agent.model,
      reasoningEffort: input.agent.reasoningEffort,
    },
  });
}

/** What the ACP session runs; a chat session brings its own MCP bridge and continuation. */
export function acpSessionRequest(
  input: AgentPlanSessionInput,
  launch: AcpLaunch,
): AcpSessionRequest {
  return {
    directory: input.directory,
    prompt: input.prompt,
    ticketInputs: input.ticketInputs,
    readTicketAssets: input.readTicketAssets,
    model: input.agent.model,
    modelSupportsImages: input.agent.supportsImages,
    reasoningEffort: input.agent.reasoningEffort,
    mcpServers: input.chat?.mcpServers ?? launch.mcpServers,
    sessionMeta: launch.sessionMeta,
    promptContent: input.promptContent,
    canReplaceMissingSession: input.resourceContext?.sourceRunId !== undefined,
    resumeSessionId:
      input.chat?.resumeSessionId ?? input.resumeSessionId ?? null,
  };
}

/** How the run record describes the isolation of a session. */
export function isolationLabel(
  isIsolated: boolean,
  mode: AcpPermissionMode,
  driver: AcpDriver,
): string {
  if (!isIsolated)
    return driver.provider === "codex_cli"
      ? "none, the Codex sandbox only"
      : "none, the permission handling of Pages only";
  return mode === "read_only"
    ? "bubblewrap, workspace read-only"
    : "bubblewrap";
}
