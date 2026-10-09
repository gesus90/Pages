import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import { readCliTextResponse } from "./CliTextResponse";

import type {
  TextExecution,
  TextExecutionInput,
} from "@/backend/agents/TextExecution";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";

interface CliTextDependencies {
  readonly runtime: AgentCliRuntime;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
}

function codexArguments(input: TextExecutionInput, work: string): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "--json",
    "-C",
    work,
    "-c",
    'cli_auth_credentials_store="file"',
    "-c",
    'forced_login_method="chatgpt"',
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.unified_exec=false",
    "-c",
    "features.apply_patch_freeform=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.code_mode=false",
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

function claudeArguments(input: TextExecutionInput): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--safe-mode",
    "--model",
    input.agent.model,
  ];
  if (input.agent.reasoningEffort !== null)
    args.push("--effort", input.agent.reasoningEffort);
  return args;
}

/** Uses the existing isolated credential homes and bounded, cancellable process runner. */
export class CliTextExecution implements TextExecution {
  private readonly dependencies: CliTextDependencies;

  public constructor(dependencies: CliTextDependencies) {
    this.dependencies = dependencies;
  }

  /** Text turns have no tools, persistent session or access to private CLI configuration. */
  public async run(
    input: TextExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const { connection } = input.agent;
    if (isApiProvider(connection.provider))
      throw new TextAssistantError("connectionUnavailable");
    const { runtime, store, locator, runner } = this.dependencies;
    const home = await store.prepare(connection.id, connection.provider);
    try {
      const adapter = await runtime.adapter(connection.provider);
      const status = await adapter.readStatus(home, signal);
      if (!status.outcome.ok)
        throw new TextAssistantError("connectionUnavailable");
      const location = await locator.find(connection.provider);
      if (!location.path) throw new TextAssistantError("connectionUnavailable");
      const result = await runner.run({
        file: location.path,
        provider: connection.provider,
        home,
        arguments:
          connection.provider === "codex_cli"
            ? codexArguments(input, home.work)
            : claudeArguments(input),
        stdin: "pipe",
        input: input.prompt,
        signal,
        timeoutMs: 120_000,
      });
      if (result.errorCode !== null || result.exitCode !== 0)
        throw new TextAssistantError("providerFailed");
      return readCliTextResponse(connection.provider, result.stdout);
    } finally {
      await store.secure(connection.id, connection.provider);
    }
  }
}
