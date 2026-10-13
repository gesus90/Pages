import { RUN_INSTANCE_VARIABLE } from "./CliProcessScan";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentPlanSessionMode } from "@/definition/AgentPlanSession";

/** The local MCP process of a session and how it reaches Pages. */
export interface CliSessionMcp {
  /** The Node binary that runs the bundle. */
  readonly node: string;
  readonly bundle: string;
  /** The web and API address of Pages, never an MCP network endpoint. */
  readonly url: string;
  /** The credential of the session; it travels only in the process environment. */
  readonly token: string;
  /** The MCP tool names the session may call. */
  readonly tools: readonly string[];
}

/** Everything a runner needs to start one session; no field is free user input. */
export interface CliSessionSpecification {
  readonly instanceId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly options: AgentRunOptions;
  readonly directory: string;
  readonly prompt: string;
  readonly mcp: CliSessionMcp | null;
}

/** The verified start of one runner session. */
export interface CliSessionPlan {
  readonly mode: Exclude<AgentPlanSessionMode, "request">;
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  /** The first input line; a one-shot call ends its input after it. */
  readonly input: string;
  /** How the runner works without asking anyone, as passed to it. */
  readonly unattended: string;
}

const MCP_SERVER = "pages";

function sessionEnvironment(
  specification: CliSessionSpecification,
): Record<string, string> {
  const environment: Record<string, string> = {
    [RUN_INSTANCE_VARIABLE]: specification.instanceId,
  };
  if (specification.mcp) {
    environment.PAGES_URL = specification.mcp.url;
    environment.PAGES_TOKEN = specification.mcp.token;
  }
  return environment;
}

function codexMcpArguments(mcp: CliSessionMcp | null): string[] {
  if (mcp === null) return ["-c", "mcp_servers={}"];
  const server = `mcp_servers.${MCP_SERVER}`;
  return [
    "-c",
    `${server}.command=${JSON.stringify(mcp.node)}`,
    "-c",
    `${server}.args=${JSON.stringify([mcp.bundle])}`,
    "-c",
    `${server}.env_vars=${JSON.stringify(["PAGES_URL", "PAGES_TOKEN", RUN_INSTANCE_VARIABLE])}`,
    "-c",
    `${server}.enabled_tools=${JSON.stringify(mcp.tools)}`,
    "-c",
    `${server}.default_tools_approval_mode="approve"`,
    "-c",
    `${server}.startup_timeout_sec=30`,
  ];
}

function codexPlan(specification: CliSessionSpecification): CliSessionPlan {
  const { options } = specification;
  const sandbox =
    options.access === "workspace_write" ? "workspace-write" : "read-only";
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    sandbox,
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "--json",
    "-C",
    specification.directory,
    "-c",
    'approval_policy="never"',
    "-c",
    'cli_auth_credentials_store="file"',
    "-c",
    'forced_login_method="chatgpt"',
    "-c",
    "features.apps=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    `features.shell_tool=${options.shell}`,
    "-c",
    `features.unified_exec=${options.shell}`,
    "-c",
    options.web ? 'web_search="live"' : 'web_search="disabled"',
    ...codexMcpArguments(specification.mcp),
    "-m",
    specification.model,
  ];
  if (specification.reasoningEffort !== null)
    args.push(
      "-c",
      `model_reasoning_effort=${JSON.stringify(specification.reasoningEffort)}`,
    );
  args.push("-");
  return {
    mode: "one_shot",
    arguments: args,
    environment: sessionEnvironment(specification),
    input: specification.prompt,
    unattended: `approval_policy=never, sandbox=${sandbox}, MCP tools=approve`,
  };
}

function claudeTools(specification: CliSessionSpecification): {
  readonly tools: readonly string[];
  readonly allowed: readonly string[];
} {
  const { options, mcp } = specification;
  const tools = ["Read", "Glob", "Grep"];
  const allowed = (mcp?.tools ?? []).map(
    (tool) => `mcp__${MCP_SERVER}__${tool}`,
  );
  if (options.access === "workspace_write") tools.push("Edit", "Write");
  if (options.shell) {
    tools.push("Bash");
    allowed.push("Bash");
  }
  if (options.web) {
    tools.push("WebSearch", "WebFetch");
    allowed.push("WebSearch", "WebFetch");
  }
  return { tools, allowed };
}

function claudePlan(specification: CliSessionSpecification): CliSessionPlan {
  const { mcp, options } = specification;
  const permissionMode =
    options.access === "workspace_write" ? "acceptEdits" : "dontAsk";
  const { tools, allowed } = claudeTools(specification);
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--permission-mode",
    permissionMode,
    "--permission-prompts",
    "none",
    "--max-turns",
    "200",
    "--tools",
    tools.join(","),
  ];
  if (allowed.length > 0) args.push("--allowedTools", allowed.join(","));
  if (mcp)
    args.push(
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER]: {
            type: "stdio",
            command: mcp.node,
            args: [mcp.bundle],
            env: {
              PAGES_URL: "${PAGES_URL}",
              PAGES_TOKEN: "${PAGES_TOKEN}",
              [RUN_INSTANCE_VARIABLE]: `\${${RUN_INSTANCE_VARIABLE}}`,
            },
          },
        },
      }),
    );
  args.push("--model", specification.model);
  if (specification.reasoningEffort !== null)
    args.push("--effort", specification.reasoningEffort);
  return {
    mode: "interactive",
    arguments: args,
    environment: sessionEnvironment(specification),
    input: JSON.stringify({
      type: "user",
      message: { role: "user", content: specification.prompt },
    }),
    unattended: `permission-mode=${permissionMode}, permission-prompts=none`,
  };
}

function openCodePermissions(
  specification: CliSessionSpecification,
): Record<string, unknown> {
  const { options, mcp } = specification;
  const allow = (isAllowed: boolean): string => (isAllowed ? "allow" : "deny");
  return {
    "*": "deny",
    read: { "*": "allow", "*.env": "deny", "*.env.*": "deny" },
    list: "allow",
    glob: "allow",
    grep: "allow",
    todowrite: "allow",
    todoread: "allow",
    edit: allow(options.access === "workspace_write"),
    bash: allow(options.shell),
    webfetch: allow(options.web),
    websearch: allow(options.web),
    external_directory: "deny",
    doom_loop: "deny",
    task: "deny",
    skill: "deny",
    question: "deny",
    ...Object.fromEntries(
      (mcp?.tools ?? []).map((tool) => [`${MCP_SERVER}_${tool}`, "allow"]),
    ),
  };
}

function openCodePlan(specification: CliSessionSpecification): CliSessionPlan {
  const { mcp } = specification;
  const configuration = {
    share: "disabled",
    autoupdate: false,
    permission: openCodePermissions(specification),
    mcp: mcp
      ? {
          [MCP_SERVER]: {
            type: "local",
            command: [mcp.node, mcp.bundle],
            environment: {
              PAGES_URL: "{env:PAGES_URL}",
              PAGES_TOKEN: "{env:PAGES_TOKEN}",
              [RUN_INSTANCE_VARIABLE]: `{env:${RUN_INSTANCE_VARIABLE}}`,
            },
            enabled: true,
          },
        }
      : {},
  };
  const args = [
    "run",
    "--format",
    "json",
    "--pure",
    "-m",
    specification.model,
    "--dir",
    specification.directory,
  ];
  if (specification.reasoningEffort !== null)
    args.push("--variant", specification.reasoningEffort);
  return {
    mode: "one_shot",
    arguments: args,
    environment: {
      ...sessionEnvironment(specification),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(configuration),
    },
    input: specification.prompt,
    unattended: "permission: every tool allow or deny, no ask rule",
  };
}

/**
 * Names a run option the runner cannot enforce, so the node is refused before it starts.
 *
 * @param provider - The runner of the connection.
 * @param options - The run options of the agent.
 * @returns The refusal, or `null` when the runner enforces every option.
 *
 * @remarks
 * Only Codex runs commands inside a sandbox. Claude Code and OpenCode could
 * change files through a command even in a read-only session, so they refuse
 * that combination instead of pretending to keep it.
 */
export function unsupportedRunOption(
  provider: CliProviderId,
  options: AgentRunOptions,
): AgentErrorCode | null {
  if (provider === "codex_cli") return null;
  return options.access === "read_only" && options.shell
    ? "plan_run_option_unsupported"
    : null;
}

/**
 * Builds the start of one runner session from managed values only.
 *
 * @param provider - The runner the connection determines.
 * @param specification - Model, effort, run options, workspace, prompt and MCP of the node.
 * @returns Arguments, environment, first input and the session mode.
 *
 * @remarks
 * The prompt and every credential stay out of the argument list. User and
 * project configuration of the tools stays off.
 */
export function planCliSession(
  provider: CliProviderId,
  specification: CliSessionSpecification,
): CliSessionPlan {
  switch (provider) {
    case "codex_cli":
      return codexPlan(specification);
    case "claude_code":
      return claudePlan(specification);
    case "opencode":
      return openCodePlan(specification);
  }
}
