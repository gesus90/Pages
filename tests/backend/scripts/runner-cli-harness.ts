import { vi } from "vitest";

import { cliEnvironment, cliInventory } from "@/scripts/runner/cli.mjs";

import type { CliCommand, CliInventoryEntry } from "@/scripts/runner/cli.d.mts";
import type { Mock } from "vitest";

export interface CliBoundary {
  execFile: Mock;
  spawn: Mock;
  openCodeInventory: Mock;
  openCodeResult: Mock;
  openCodeCommand: Mock;
  antigravityInventory: Mock;
  antigravityCommand: Mock;
}

export interface ExecResult {
  readonly error?: { code?: string } | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface ExecCall {
  tool: string;
  args: string[];
  options: {
    env: Record<string, string>;
    signal?: AbortSignal;
    timeout: number;
    maxBuffer: number;
  };
  input: string | undefined;
}

export interface Spawned {
  tool: string;
  args: string[];
  options: {
    cwd: string;
    detached: boolean;
    stdio: string[];
    env: Record<string, string>;
  };
}

export interface BridgeJob {
  workspace: string;
  model: string;
  reasoningEffort: string | null;
  access: string;
  resumeSessionId?: string;
  mcpServers: {
    name: string;
    command: string;
    args: string[];
    env: unknown[];
  }[];
}

export type Program = CliCommand["program"];
export type CommandOverrides = Partial<Omit<CliCommand, "program">> & {
  program?: Partial<Program>;
};

export const home = "/synthetic/home";
export const calls: ExecCall[] = [];
export const stdinListeners: Record<string, () => void> = {};
export const killed = vi.fn();

let bound: CliBoundary | undefined;
const savedEnvironment = { ...process.env };

function boundary(): CliBoundary {
  if (!bound) throw new Error("CLI boundary is not bound");
  return bound;
}

/** Resets every mock of the CLI boundary and points the CLI home at a synthetic folder. */
export function bindBoundary(target: CliBoundary): void {
  bound = target;
  calls.length = 0;
  for (const key of Object.keys(stdinListeners)) delete stdinListeners[key];
  killed.mockReset();
  for (const mock of Object.values(target)) mock.mockReset();
  target.openCodeInventory.mockResolvedValue(null);
  target.antigravityInventory.mockResolvedValue(null);
  target.openCodeCommand.mockReturnValue(["/synthetic/opencode.mjs", "--acp"]);
  target.antigravityCommand.mockReturnValue([
    "/synthetic/antigravity.mjs",
    "--acp",
  ]);
  process.env = { ...savedEnvironment };
  process.env.PAGES_RUNNER_CLI_HOME = home;
  process.env.PAGES_RUNNER_CLI_PATH = "/synthetic/bin";
}

/** Gives the next test the unchanged process environment. */
export function restoreEnvironment(): void {
  process.env = { ...savedEnvironment };
}

/** Routes every execFile call of the CLI boundary to a canned result by tool and arguments. */
export function stubExec(route: (call: ExecCall) => ExecResult): void {
  boundary().execFile.mockImplementation(
    (
      tool: string,
      args: string[],
      options: ExecCall["options"],
      done: (error: unknown, stdout: string, stderr: string) => void,
    ) => {
      const call: ExecCall = { tool, args, options, input: undefined };
      calls.push(call);
      return {
        stdin: {
          on: (event: string, listener: () => void): void => {
            stdinListeners[event] = listener;
          },
          end: (input: string | undefined): void => {
            call.input = input;
            const result = route(call);
            done(
              result.error ?? null,
              result.stdout ?? "",
              result.stderr ?? "",
            );
          },
        },
        kill: killed,
      };
    },
  );
}

export const codexCatalog = JSON.stringify({
  models: [
    {
      slug: "gpt-x",
      display_name: "GPT X",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    },
    { slug: "plain", visibility: "list" },
    { slug: "hidden", visibility: "hide" },
    { slug: "bad id!", visibility: "list" },
    { slug: "gpt-x", display_name: "Duplicate", visibility: "list" },
  ],
});

export const claudeModels: unknown[] = [
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-x",
    displayName: "Sonnet X",
    supportedEffortLevels: ["low", "max"],
  },
  { value: "haiku" },
  { value: "off", disabled: true },
  { value: "Bad Name", displayName: "x\u0007y" },
  { value: "toomany", supportedEffortLevels: Array(11).fill("low") },
  { value: "badeffort", supportedEffortLevels: ["Not Valid"] },
];

/** The stream-json output of the Claude picker with one control reply. */
export function claudeCatalog(
  models: unknown,
  subtype = "success",
  id = "pages-model-catalog",
): string {
  return [
    JSON.stringify({ type: "system" }),
    JSON.stringify({
      type: "control_response",
      response: { subtype, request_id: id, response: { models } },
    }),
  ].join("\n");
}

/** A fully logged-in host with both tools; overrides replace single routes by command prefix. */
export function loggedInHost(
  overrides: Partial<Record<string, ExecResult>> = {},
): void {
  stubExec(({ tool, args }) => {
    const key = `${tool} ${args.join(" ")}`;
    const hit = Object.entries(overrides).find(([prefix]) =>
      key.startsWith(prefix),
    );
    if (hit) return hit[1] ?? {};
    if (args[0] === "--version")
      return { stdout: `${tool} v1.2.3-beta.1 (build)` };
    if (tool === "codex" && args[0] === "login")
      return { stdout: "Logged in using ChatGPT" };
    if (tool === "codex") return { stdout: codexCatalog };
    if (args[0] === "auth")
      return {
        stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
      };
    return { stdout: claudeCatalog(claudeModels) };
  });
}

/** Builds a command for the given tool, with overrides for the program and the job. */
export function command(overrides: CommandOverrides = {}): CliCommand {
  const { program, ...rest } = overrides;
  return {
    workspace: "/synthetic/work",
    pagesAccess: 0,
    program: {
      model: "gpt-x",
      access: "read_only",
      reasoningEffort: null,
      route: { tool: "codex", catalogRevision: "" },
      ...program,
    },
    ...rest,
  };
}

/** The route of a command, pinned to a catalog revision. */
export function routeOf(tool: string, catalogRevision = ""): Program["route"] {
  return { tool, catalogRevision };
}

/** The inventory entry the stubbed host reports for one tool. */
export async function inventoryOf(
  tool: string,
): Promise<CliInventoryEntry | undefined> {
  return (await cliInventory()).find((entry) => entry.tool === tool);
}

/** Runs spawnCli against the stub inventory with the revision the host reports for the tool. */
export async function launchFor(
  tool: string,
  overrides: CommandOverrides = {},
  folder = "/synthetic/jobs/a/b/folder",
): Promise<{ result: unknown; child: object }> {
  const { spawnCli } = await import("@/scripts/runner/cli.mjs");
  const inventory = await inventoryOf(tool);
  calls.length = 0;
  const base = command({
    ...overrides,
    program: {
      model: tool === "claude" ? "claude-sonnet-x" : "gpt-x",
      ...overrides.program,
      route: routeOf(tool, inventory?.catalogRevision),
    },
  });
  const child = { pid: 42 };
  boundary().spawn.mockReturnValue(child);
  const result: unknown = await spawnCli(
    base,
    "job-9",
    new AbortController().signal,
    folder,
  );
  return { result, child };
}

/** The arguments of the first process the CLI boundary started. */
export function spawned(): Spawned {
  const [tool, args, options] = boundary().spawn.mock.calls[0] as [
    string,
    string[],
    Spawned["options"],
  ];
  return { tool, args, options };
}

/** The job description a started adapter receives in the named variable. */
export function bridgeJob(variable: string): BridgeJob {
  const { options } = spawned();
  return JSON.parse(options.env[variable] ?? "") as BridgeJob;
}

/** The CLI environment plus the given extra variables. */
export function expectedEnvironment(
  extra: Record<string, string>,
): Record<string, string> {
  return { ...cliEnvironment(), ...extra };
}
