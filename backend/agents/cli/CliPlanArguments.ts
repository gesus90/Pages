import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { CliProviderId } from "@/definition/AgentConnection";

/** Uses locally verified CLI switches, isolated credentials and no user/project customization. */
export function cliPlanArguments(
  provider: CliProviderId,
  input: AgentPlanExecutionInput,
): readonly string[] {
  if (provider === "claude_code") {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--max-turns",
      "20",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--safe-mode",
      "--restricted",
      "--permission-mode",
      "acceptEdits",
      "--tools",
      "Read,Edit,Write,Glob,Grep",
      "--model",
      input.agent.model,
    ];
    if (input.agent.reasoningEffort !== null)
      args.push("--effort", input.agent.reasoningEffort);
    return args;
  }
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "--json",
    "-C",
    input.directory ?? "",
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
    'web_search="disabled"',
    "-c",
    "mcp_servers={}",
    "-m",
    input.agent.model,
  ];
  if (input.agent.reasoningEffort !== null)
    args.push("-c", `model_reasoning_effort="${input.agent.reasoningEffort}"`);
  args.push("-");
  return args;
}
