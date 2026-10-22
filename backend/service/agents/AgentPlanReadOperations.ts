import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { pageAgentEntries } from "./AgentCursor";
import {
  readPlanListRequest,
  readPlanReadRequest,
  readPlanReportsRequest,
  readPlanRunRequest,
  readPlanRunsRequest,
  readPlanSourcesRequest,
} from "./AgentPlanOperationInput";
import {
  agentEntry,
  hasReport,
  planDetail,
  planSummary,
  runDetail,
  runSummary,
  stepReport,
} from "./AgentPlanOperationViews";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type {
  AgentPlanReadOperation,
  AgentPlanReadResult,
} from "@/definition/AgentPlanOperations";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type {
  AgentPlanListRequest,
  AgentPlanRunSelection,
} from "./AgentPlanOperationInput";

/** The plan service functions the reads use; every one applies the rights of the plan page. */
export type AgentPlanReads = Pick<
  AgentPlanService,
  | "visible"
  | "view"
  | "directory"
  | "sources"
  | "workspaces"
  | "runEntries"
  | "runOverview"
  | "run"
>;

/** Runs listed per page when the client names no limit. */
const DEFAULT_RUN_LIMIT = 20;

/**
 * Wraps a read in the envelope within the response budget.
 *
 * @remarks
 * Result texts of runs can be long, so a page of reports can exceed the
 * budget; the client then reads the reports of one node at a time.
 */
function respond(result: AgentPlanReadResult): PagesAgentReadResponse {
  const response: PagesAgentReadResponse = { apiVersion: "1", result };
  if (
    Buffer.byteLength(JSON.stringify(response)) >
    PAGES_AGENT_LIMITS.responseBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "responseBytes",
      limit: PAGES_AGENT_LIMITS.responseBytes,
    });
  return response;
}

function matches(plan: AgentPlanView, request: AgentPlanListRequest): boolean {
  if (request.projectId !== null && plan.projectId !== request.projectId)
    return false;
  return (
    request.text === null ||
    plan.name.toLocaleLowerCase().includes(request.text.toLocaleLowerCase())
  );
}

/**
 * Lists and reads plans, their runs and the reports of a run for one person.
 *
 * @remarks
 * Every read goes through the plan service, so a plan is visible exactly as
 * on the plan page and a run only to the person who started it. A hidden plan
 * or run answers like a missing one.
 */
export class AgentPlanReadOperations {
  private readonly plans: AgentPlanReads;

  public constructor(plans: AgentPlanReads) {
    this.plans = plans;
  }

  /**
   * Runs one read for the person.
   *
   * @param userId - The verified person.
   * @param operation - The read.
   * @param input - The raw parameters.
   */
  public async read(
    userId: string,
    operation: AgentPlanReadOperation,
    input: unknown,
  ): Promise<PagesAgentReadResponse> {
    if (operation === "plans.list")
      return respond(await this.list(userId, readPlanListRequest(input)));
    if (operation === "plans.read")
      return respond(await this.detail(userId, input));
    if (operation === "plans.sources.read")
      return respond(await this.sources(userId, input));
    if (operation === "plans.runs.list")
      return respond(await this.runs(userId, input));
    if (operation === "plans.run.read") {
      const run = await this.select(userId, readPlanRunRequest(input));
      return respond({ run: runDetail(run) });
    }
    return respond(await this.reports(userId, input));
  }

  private async list(
    userId: string,
    request: AgentPlanListRequest,
  ): Promise<AgentPlanReadResult> {
    const [plans, directory] = await Promise.all([
      this.plans.visible(userId),
      this.plans.directory(userId),
    ]);
    const page = pageAgentEntries(
      plans.filter((plan) => matches(plan, request)),
      {
        cursor: request.cursor,
        limit: request.limit,
        context: JSON.stringify([
          userId,
          "plans.list",
          request.text,
          request.projectId,
        ]),
        // Plans come ordered by name, which is what a person looks for.
        preserveOrder: true,
      },
    );
    const runs = await this.plans.runOverview(
      userId,
      page.entries.map((plan) => plan.id),
    );
    return {
      plans: page.entries.map((plan) =>
        planSummary(plan, directory, runs.get(plan.id) ?? []),
      ),
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }

  private async detail(
    userId: string,
    input: unknown,
  ): Promise<AgentPlanReadResult> {
    const plan = await this.plans.view(userId, readPlanReadRequest(input));
    const [directory, sources, entries] = await Promise.all([
      this.plans.directory(userId),
      this.plans.sources(userId, plan.workspaceId),
      this.plans.runEntries(userId, plan.id, "newest"),
    ]);
    return { plan: planDetail(plan, { directory, sources, entries }) };
  }

  private async sources(
    userId: string,
    input: unknown,
  ): Promise<AgentPlanReadResult> {
    const workspaceId = readPlanSourcesRequest(input);
    const workspaces = await this.plans.workspaces(userId);
    // The sources of the workspace's project, as the plan page loads them.
    const sources =
      workspaceId === null
        ? null
        : await this.plans.sources(userId, workspaceId);
    const interpreters = sources?.interpreters?.map(
      ({ id, name, status, version }) => ({ id, name, status, version }),
    );
    return {
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        projectId: workspace.projectId,
        projectName: workspace.projectName,
        isUsable: workspace.isUsable,
      })),
      agents: (sources?.agents ?? []).map(agentEntry),
      models: sources?.models ?? [],
      remoteTargets: sources?.remoteTargets ?? [],
      limits: {
        nodes: 100,
        edges: 500,
        groupMembers: 50,
        coordinateMinimum: 0,
        coordinateMaximum: 6000,
        changes: 200,
        timeoutMinutes: [0, 120],
      },
      ...(interpreters === undefined ? {} : { interpreters }),
    };
  }

  private async runs(
    userId: string,
    input: unknown,
  ): Promise<AgentPlanReadResult> {
    const request = readPlanRunsRequest(input);
    const plan = await this.plans.view(userId, request.planId);
    const entries = await this.plans.runEntries(userId, plan.id, request.order);
    const page = pageAgentEntries(entries, {
      cursor: request.cursor,
      limit: request.limit ?? DEFAULT_RUN_LIMIT,
      context: JSON.stringify([
        userId,
        "plans.runs.list",
        plan.id,
        request.order,
      ]),
      preserveOrder: true,
    });
    return {
      planId: plan.id,
      order: request.order,
      runs: page.entries.map((entry) => runSummary(plan, entry)),
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }

  /** Finds the run a selection names; one of another plan or person is missing. */
  private async select(
    userId: string,
    selection: AgentPlanRunSelection,
  ): Promise<AgentPlanRun> {
    if ("runId" in selection) {
      const run = await this.plans.run(userId, selection.runId);
      if (selection.planId !== null && run.planId !== selection.planId)
        throw new AgentOperationError("NOT_FOUND");
      return run;
    }
    const entries = await this.plans.runEntries(
      userId,
      selection.planId,
      selection.select === "latest" ? "newest" : "oldest",
    );
    const entry = entries.at(0);
    if (!entry) throw new AgentOperationError("NOT_FOUND");
    return this.plans.run(userId, entry.id);
  }

  private async reports(
    userId: string,
    input: unknown,
  ): Promise<AgentPlanReadResult> {
    const request = readPlanReportsRequest(input);
    const run = await this.select(userId, request.run);
    const steps = run.steps.filter(
      (step) =>
        (request.stepId === null || step.id === request.stepId) &&
        hasReport(step),
    );
    if (request.stepId !== null && steps.length === 0)
      throw new AgentOperationError("NOT_FOUND");
    return {
      run: runSummary(
        { id: run.planId, name: run.planName },
        { id: run.id, startedAt: run.startedAt, status: run.status },
      ),
      reports: steps.map((step) => stepReport(run, step)),
    };
  }
}
