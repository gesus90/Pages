import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import { cliPlanArguments } from "./CliPlanArguments";
import { readCliPlanResponse } from "./CliPlanResponse";
import { CliPlanIsolation } from "./CliPlanIsolation";

import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";
import type { CliRunRequest } from "./CliContracts";

/** How CLI runs are kept away from the instance folders. */
export interface CliIsolationOptions {
  /** Folders a CLI run must not reach, such as the data and agent folders. */
  readonly protectedDirectories: readonly string[];
  /** Refuse a run instead of starting it unisolated when bubblewrap does not work. */
  readonly isRequired: boolean;
  /** Decides whether bubblewrap works; defaults to a real probe. */
  readonly probe?: () => Promise<boolean>;
}

interface PlanCliDependencies {
  readonly runtime: AgentCliRuntime;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  /** Absent disables the isolation. */
  readonly isolation?: CliIsolationOptions;
}

/** Shares the bounded process runner and credential homes; plan directories are separate from those homes. */
export class CliPlanExecution implements PlanExecution {
  private readonly dependencies: PlanCliDependencies;
  private readonly isolation: CliPlanIsolation | null;
  private readonly isIsolationRequired: boolean;
  private hasWarnedWithoutIsolation = false;

  public constructor(dependencies: PlanCliDependencies) {
    this.dependencies = dependencies;
    const { isolation } = dependencies;
    this.isolation = isolation
      ? new CliPlanIsolation(isolation.protectedDirectories, isolation.probe)
      : null;
    this.isIsolationRequired = isolation?.isRequired === true;
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
      const result = await runner.run(
        await this.isolate({
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
        }),
      );
      if (
        signal.aborted &&
        (result.errorCode === "check_timeout" ||
          result.errorCode === "login_cancelled")
      )
        throw new AgentPlanCancelledError();
      // The time limit of the process is a result of its own: the run record
      // distinguishes it from a failure of the tool.
      if (result.errorCode === "check_timeout")
        throw new TextAssistantError("timeout");
      if (result.errorCode !== null || result.exitCode !== 0)
        throw new AgentError("plan_step_failed");
      return readCliPlanResponse(connection.provider, result.stdout);
    } finally {
      await store.secure(connection.id, connection.provider);
    }
  }

  /**
   * Runs in a mount namespace that hides the instance folders, where bubblewrap works.
   *
   * @remarks
   * Where it does not, the run starts as before and one warning says so, unless
   * the operator demanded isolation: then the step fails before any process.
   */
  private async isolate(request: CliRunRequest): Promise<CliRunRequest> {
    if (this.isolation === null) return request;
    const isolated = await this.isolation.isolate(request);
    if (isolated !== null) return isolated;
    if (this.isIsolationRequired)
      throw new AgentError("cli_isolation_unavailable");
    if (!this.hasWarnedWithoutIsolation) {
      this.hasWarnedWithoutIsolation = true;
      console.warn(
        "Pages runs CLI agents without a mount namespace because bubblewrap does not work on this host. Install it, or set PAGES_CLI_ISOLATION=required to refuse such runs.",
      );
    }
    return request;
  }
}
