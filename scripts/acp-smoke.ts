/**
 * Smoke test of one ACP plan node against the real CLIs of an installation.
 *
 * Run `pnpm acp:smoke --provider codex_cli|claude_code --data <data folder>
 * --connection <connection id> --workspace <folder>` as the account of the
 * Pages server. It starts the session exactly like a plan node does: with the
 * isolated sign-in of the connection, the ACP adapter on the `PATH`, the mode
 * and the bubblewrap isolation, sends the prompt and prints what the run
 * record would hold. Nothing is stored and no credential is printed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { findTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";

const DEFAULT_PROMPT = [
  "Smoke test of a Pages plan node. Answer in at most five lines:",
  "name the exact model id you run on, say whether you can change a file or run a command, and end with this block:",
  "```pages-report",
  '{"todos":[],"criteria":[],"decisions":[],"summary":"smoke"}',
  "```",
].join("\n");

interface SmokeOptions {
  readonly provider: CliProviderId;
  readonly dataDirectory: string;
  readonly connectionId: string;
  readonly workspace: string;
  readonly mode: AcpPermissionMode;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly timeoutMinutes: number;
  /** Aborts the node after this many seconds, as the stop button does. */
  readonly stopAfterSeconds: number | null;
  readonly prompt: string;
  readonly mcp: CliSessionMcp | null;
}

function fail(message: string): never {
  throw new Error(message);
}

function readMode(value: string | undefined): AcpPermissionMode {
  if (value === "read_only" || value === "yolo") return value;
  return fail("--mode must be read_only or yolo");
}

function readProvider(value: string | undefined): CliProviderId {
  if (value === "codex_cli" || value === "claude_code") return value;
  return fail("--provider must be codex_cli or claude_code");
}

async function readMcp(
  values: Readonly<Record<string, string | undefined>>,
): Promise<CliSessionMcp | null> {
  const bundle = values["mcp-bundle"];
  if (bundle === undefined) return null;
  const token = process.env.PAGES_SMOKE_TOKEN;
  if (token === undefined || token === "")
    return fail("PAGES_SMOKE_TOKEN must hold the credential of the MCP server");
  return {
    node: process.execPath,
    bundle: path.resolve(bundle),
    url: values["mcp-url"] ?? "http://127.0.0.1:3000",
    token,
    tools: null,
  };
}

async function readOptions(argv: readonly string[]): Promise<SmokeOptions> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      provider: { type: "string" },
      data: { type: "string" },
      connection: { type: "string" },
      workspace: { type: "string" },
      mode: { type: "string", default: "read_only" },
      model: { type: "string" },
      effort: { type: "string" },
      timeout: { type: "string", default: "0" },
      "stop-after": { type: "string" },
      "prompt-file": { type: "string" },
      "mcp-bundle": { type: "string" },
      "mcp-url": { type: "string" },
    },
  });
  const { data, connection, workspace, model } = values;
  if (!data || !connection || !workspace || !model)
    return fail("--data, --connection, --workspace and --model are required");
  const stopAfter = values["stop-after"];
  const promptFile = values["prompt-file"];
  return {
    provider: readProvider(values.provider),
    dataDirectory: path.resolve(data),
    connectionId: connection,
    workspace: path.resolve(workspace),
    mode: readMode(values.mode),
    model,
    reasoningEffort: values.effort ?? null,
    timeoutMinutes: Number(values.timeout),
    stopAfterSeconds: stopAfter === undefined ? null : Number(stopAfter),
    prompt:
      promptFile === undefined
        ? DEFAULT_PROMPT
        : await readFile(promptFile, "utf8"),
    mcp: await readMcp(values),
  };
}

function sessionInput(
  options: SmokeOptions,
  instanceId: string,
): AgentPlanSessionInput {
  return {
    agent: {
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      connection: {
        id: options.connectionId,
        name: "smoke",
        provider: options.provider,
        isActive: true,
        hasApiKey: false,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: new Date().toISOString(),
      },
    },
    userId: "smoke",
    prompt: options.prompt,
    directory: options.workspace,
    options: acpRunOptions(options.mode, options.timeoutMinutes),
    instanceId,
    mcp: options.mcp,
  };
}

function createExecution(options: SmokeOptions): CliSessionExecution {
  const store = new AgentCredentialStore(options.dataDirectory);
  const locator = new CliLocator();
  const runner = new CliProcessRunner();
  const runtime = new AgentCliRuntime({ store, locator, runner });
  return new CliSessionExecution({
    runtime,
    store,
    locator,
    runner,
    isolation: {
      protectedDirectories: [
        options.dataDirectory,
        path.join(path.dirname(options.dataDirectory), "Agents"),
      ],
      isRequired: false,
    },
  });
}

/** Runs the node and returns what a run record would show of it. */
async function runSmoke(options: SmokeOptions): Promise<unknown> {
  const instanceId = randomUUID();
  const controller = new AbortController();
  // The plan engine gives a node the same two ways to end: a stop and its deadline.
  const signal =
    options.timeoutMinutes > 0
      ? AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(options.timeoutMinutes * 60_000),
        ])
      : controller.signal;
  const progress: string[][] = [];
  const startedAt = Date.now();
  const session = await createExecution(options).open(
    sessionInput(options, instanceId),
    signal,
    {
      started: () => {},
      identified: () => {},
      progressed: (events) => {
        progress.push([...events]);
      },
    },
  );
  if (options.stopAfterSeconds !== null)
    setTimeout(() => {
      controller.abort();
    }, options.stopAfterSeconds * 1000);
  const turn = await session.turn;
  const closed = await session.close();
  const leftovers = await findTaggedProcesses(instanceId);
  return {
    provider: options.provider,
    mode: options.mode,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    failure: turn.failure,
    errorCode: turn.errorCode,
    permissionDenials: turn.permissionDenials,
    effective: turn.effective,
    events: turn.events.map((line) => sanitizePlanOutput(line)),
    progressReports: progress.length,
    output: sanitizePlanOutput(turn.output).slice(0, 2_000),
    hasReport: /```pages-report\s/u.test(turn.output),
    closeout: {
      exit: closed.exit,
      leftoversEnded: closed.leftovers,
      isConfirmed: closed.isConfirmed,
      processesStillRunning: leftovers.length,
    },
  };
}

try {
  const result = await runSmoke(await readOptions(process.argv.slice(2)));
  console.info(JSON.stringify(result, null, 2));
} catch (error: unknown) {
  const message =
    error instanceof AgentError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "unknown error";
  console.error(`acp-smoke failed: ${message}`);
  process.exitCode = 1;
}
