import { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { vi } from "vitest";

import type { Mock } from "vitest";

export type Json = Record<string, unknown>;
export type Reply = (message: Json) => void;

export interface ExecResult {
  readonly error?: Error | null;
  readonly stdout?: string;
}

export interface OpenCodeModule {
  readonly VERIFIED_OPENCODE_VERSION: string;
  openCodeEnvironment(
    base: Record<string, string>,
    configuration?: unknown,
  ): Record<string, string>;
  readOpenCodeListing(stdout: string): readonly Json[];
  classifyOpenCodeFailure(text: string): string;
  checkOpenCodeAcp(
    environment: Record<string, string>,
    version: string | null,
  ): Promise<Json>;
  openCodeInventory(
    base: Record<string, string>,
    context?: { signal?: AbortSignal; timeout?: number },
  ): Promise<Json | null>;
  openCodeResult(stdout: string): {
    answer: string;
    failureCode: string | undefined;
  };
  openCodeCommand(): string[];
  remoteBanner(workspace: string): string;
}

export interface Fake {
  readonly child: ChildProcess;
  readonly stdout: PassThrough;
  readonly sent: Json[];
}

export interface AgentSettings {
  name: string;
  version: string;
  protocolVersion: number;
  resume: boolean;
  resumeError: boolean;
  resumeFails: boolean;
  sessionId: unknown;
  modelType: string;
  modeType: string;
  modes: string[];
  models: string[];
  efforts: string[];
  ignoreSet: boolean;
  newError: boolean;
  prompt: (reply: Reply, request: Json) => void;
}

export const MODULE_FILE = fileURLToPath(
  new URL("../../../scripts/runner/opencode.mjs", import.meta.url),
);

/**
 *
 */
export function line(message: Json): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 *
 */
export function textUpdate(text: string, messageId?: string): Json {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
        ...(messageId ? { messageId } : {}),
      },
    },
  };
}

/**
 *
 */
export function updateOf(sessionUpdate: string): Json {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { update: { sessionUpdate, title: "synthetic" } },
  };
}

/** A child process whose stdin is parsed into `sent` and optionally answered. */
export function fakeChild(
  onMessage?: (message: Json, reply: Reply) => void,
  writeError?: Error,
): Fake {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  const sent: Json[] = [];
  const reply: Reply = (message) => {
    stdout.write(line({ jsonrpc: "2.0", ...message }));
  };
  const stdin = new Writable({
    write(chunk: Buffer, encoding, callback) {
      if (writeError) {
        callback(writeError);
        return;
      }
      for (const text of chunk.toString().split("\n").filter(Boolean)) {
        const message = JSON.parse(text) as Json;
        sent.push(message);
        onMessage?.(message, reply);
      }
      callback();
    },
  });
  if (writeError) stdin.on("error", () => undefined);
  Object.defineProperties(child, {
    stdout: { value: stdout },
    stdin: { value: stdin },
  });
  vi.spyOn(child, "kill").mockReturnValue(true);
  return { child, stdout, sent };
}

function freshAgent(): AgentSettings {
  return {
    name: "OpenCode",
    version: "1.18.34",
    protocolVersion: 1,
    resume: true,
    resumeError: false,
    resumeFails: false,
    sessionId: "native-session",
    modelType: "select",
    modeType: "select",
    modes: ["pages-read-only", "pages-yolo"],
    models: ["openai/gpt-5"],
    efforts: ["high", "low"],
    ignoreSet: false,
    newError: false,
    prompt: (reply, request) => {
      reply(textUpdate("Hello "));
      reply(textUpdate("world"));
      reply({
        id: request.id,
        result: { stopReason: "end_turn", usage: { inputTokens: 3 } },
      });
    },
  };
}

export const agent: AgentSettings = freshAgent();
const current: Record<string, string> = {};

/**
 *
 */
export function resetAgent(): void {
  Object.assign(agent, freshAgent());
  for (const key of Object.keys(current)) delete current[key];
}

function configOptions(): Json[] {
  const select = (id: string, type: string, values: string[]): Json => ({
    id,
    type,
    currentValue: current[id] ?? values[0],
    options: values.map((value) => ({ value })),
  });
  return [
    select("model", agent.modelType, agent.models),
    select("mode", agent.modeType, agent.modes),
    select("effort", "select", agent.efforts),
  ];
}

/** The scripted OpenCode agent answering the requests of the adapter. */
function respond(message: Json, reply: Reply): void {
  const id = message.id;
  const params = (message.params ?? {}) as Json;
  switch (message.method) {
    case "initialize":
      reply({
        id,
        result: {
          protocolVersion: agent.protocolVersion,
          agentInfo: { name: agent.name, version: agent.version },
          agentCapabilities: {
            sessionCapabilities: agent.resume ? { resume: {} } : {},
          },
        },
      });
      return;
    case "session/new":
      if (agent.newError) {
        reply({ id, error: { code: -32000, message: "no session" } });
        return;
      }
      reply({
        id,
        result: { sessionId: agent.sessionId, configOptions: configOptions() },
      });
      return;
    case "session/resume":
      if (agent.resumeFails) {
        reply({ id, error: { code: -32001, message: "unknown session" } });
        return;
      }
      reply({
        id,
        result: agent.resumeError ? {} : { configOptions: configOptions() },
      });
      return;
    case "session/set_config_option":
      if (!agent.ignoreSet)
        current[String(params.configId)] = String(params.value);
      reply({ id, result: { configOptions: configOptions() } });
      return;
    case "session/prompt":
      agent.prompt(reply, message);
      return;
  }
}

let lastAgent: Fake | undefined;

/** The child of the newest `agentChild()`. */
export function lastFake(): Fake | undefined {
  return lastAgent;
}

/**
 *
 */
export function agentChild(): Fake {
  lastAgent = fakeChild(respond);
  return lastAgent;
}

/**
 *
 */
export function methods(fake: Fake): string[] {
  return fake.sent.map((message) => String(message.method));
}

/**
 *
 */
export async function load(): Promise<OpenCodeModule> {
  vi.resetModules();
  return (await import("@/scripts/runner/opencode.mjs")) as unknown as OpenCodeModule;
}

/** Scripts `execFile("opencode", …)` by its arguments. */
export function stubExec(
  execFile: Mock,
  handler: (args: readonly string[]) => ExecResult,
): void {
  execFile.mockImplementation(
    (
      command: string,
      args: readonly string[],
      options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      const result = handler(args);
      callback(result.error ?? null, result.stdout ?? "");
    },
  );
}
