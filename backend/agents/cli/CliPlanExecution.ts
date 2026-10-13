import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import { cliPlanArguments } from "./CliPlanArguments";
import { readCliPlanResponse } from "./CliPlanResponse";
import { isolateCliPlan } from "./CliPlanIsolation";

import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";

interface PlanCliDependencies {
  readonly runtime: AgentCliRuntime;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly protectedDirectory?: string;
}

/** Shares the bounded process runner and credential homes; plan directories are separate from those homes. */
export class CliPlanExecution implements PlanExecution {
  private readonly dependencies: PlanCliDependencies;

  public constructor(dependencies: PlanCliDependencies) {
    this.dependencies = dependencies;
  }

  /** Starts at the explicitly resolved cwd and confirms cancellation only after process-group drainage. */
  public async run(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const { connection } = input.agent;
    if (isApiProvider(connection.provider) || input.directory === null)
      throw new AgentError("plan_directory_required");
    const { runtime, store, locator, runner } = this.dependencies;
    const home = await store.prepare(connection.id, connection.provider);
    try {
      const adapter = await runtime.adapter(connection.provider);
      const status = await adapter.readStatus(home, signal);
      if (signal.aborted) throw new AgentPlanCancelledError();
      if (!status.outcome.ok) throw new AgentError("plan_step_failed");
      const location = await locator.find(connection.provider);
      if (!location.path) throw new AgentError("cli_not_executable");
      await input.beforeStart?.();
      if (signal.aborted) throw new AgentPlanCancelledError();
      const request = await isolateCliPlan(
        {
          file: location.path,
          provider: connection.provider,
          home,
          workingDirectory: input.directory,
          arguments: cliPlanArguments(connection.provider, input),
          stdin: "pipe",
          input: input.prompt,
          signal,
          timeoutMs: 600_000,
          maxStdoutBytes: 1024 * 1024,
        },
        this.dependencies.protectedDirectory,
      );
      const result = await runner.run(request);
      if (
        signal.aborted &&
        (result.errorCode === "check_timeout" ||
          result.errorCode === "login_cancelled")
      )
        throw new AgentPlanCancelledError();
      if (result.errorCode === "check_timeout")
        throw new TextAssistantError("timeout");
      if (result.errorCode !== null || result.exitCode !== 0)
        throw new AgentError("plan_step_failed");
      return readCliPlanResponse(connection.provider, result.stdout);
    } finally {
      await store.secure(connection.id, connection.provider);
    }
  }
}
