import { z } from "zod";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { planWorkWriteSchema } from "@/backend/agents/AgentPlanWorkInput";
import { AgentPlanWorkRepository } from "@/backend/database/repositories/agent/AgentPlanWorkRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { readPlanStepTickets } from "@/backend/agents/AgentPlanStepTickets";
import { materializeTicketChecklist } from "@/backend/service/task/TicketChecklist";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { logCaughtError } from "@/backend/logging/Logger";

import { createAgentTaskContext } from "./AgentTaskAccess";
import { agentTransactionScope } from "./AgentTransactionScope";
import { planWorkContext, planWorkStep } from "./AgentPlanWorkContext";
import { planWorkIssues, planWorkScopeHash } from "./AgentPlanWorkEvaluation";
import { readPlanWorkRecordForContext } from "./AgentPlanWorkRecords";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  AgentPlanWorkRecord,
  AgentPlanWorkView,
} from "@/definition/AgentPlanWork";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { User } from "@/definition/User";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentRunScope } from "@/definition/McpAuthorization";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { PlanWorkContext } from "./AgentPlanWorkContext";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";

const readSchema = z.strictObject({
  ticketId: z.string().trim().min(1).max(200),
});

function requireWritableGateProvider(
  provider: AgentProviderId | null | undefined,
  options: AgentRunOptions | undefined,
): void {
  if (!provider || isApiProvider(provider))
    throw new AgentError("plan_work_gate_unavailable");
  if (agentRunOptionsFor(provider, options).access === "read_only")
    throw new AgentError("plan_work_gate_unavailable");
}

function writableGateStep(snapshot: AgentPlanSnapshot, stepId: string): void {
  const local = snapshot.steps.find((entry) => entry.step.id === stepId);
  const step = local?.step ?? planWorkStep({ ...snapshot }, stepId);
  if (!step || step.completion !== "todos")
    throw new AgentError("plan_work_gate_unavailable");
  if (!readPlanStepTickets(snapshot)[stepId]?.length)
    throw new AgentError("plan_work_gate_unavailable");
  requireWritableGateProvider(
    local?.provider ?? step.configuration?.provider,
    local?.template.run ?? step.configuration?.template.run,
  );
}

function requireCurrentWork(
  view: AgentPlanWorkView,
  request: z.infer<typeof planWorkWriteSchema>,
): void {
  if (
    request.expectedRevision !== (view.record?.revision ?? 0) ||
    request.requirementsHash !== view.requirementsHash ||
    request.contentHash !== view.contentHash
  )
    throw new AgentOperationError("CONFLICT");
  if (
    request.action === "confirm" &&
    (!view.record ||
      JSON.stringify(view.record.scope) !== JSON.stringify(request.scope))
  )
    throw new AgentOperationError("CONFLICT");
}

/** Server-owned scope and evidence checks shared by local and remote execution. */
export class AgentPlanWorkGate {
  private readonly database: Pick<Database, "transaction">;
  private readonly users: Pick<UserService, "getById">;

  public constructor(
    database: Pick<Database, "transaction">,
    users: Pick<UserService, "getById">,
  ) {
    this.database = database;
    this.users = users;
  }

  /** Reads or appends separate metadata using only the verified current run credential. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<AgentPlanWorkView> {
    if (!identity.run) throw new AgentOperationError("FORBIDDEN");
    const isWrite = operation === "ticket.work.save";
    const parsed = isWrite
      ? planWorkWriteSchema.safeParse(input)
      : readSchema.safeParse(input);
    if (!parsed.success) throw new AgentOperationError("INVALID_REQUEST");
    if (isWrite && identity.run.reach === "read")
      throw new AgentOperationError("FORBIDDEN");
    const scope = identity.run;
    const actor = await this.actor(identity.userId);
    return this.database.transaction(async (transaction) => {
      const repository = new AgentPlanWorkRepository(transaction);
      const basis = await repository.basis(scope.runId);
      if (!basis || basis.run.userId !== actor.id)
        throw new AgentOperationError("FORBIDDEN");
      const context = planWorkContext(basis, scope.stepId);
      if (context.result.status !== "running" || basis.run.stopRequested)
        throw new AgentOperationError("CONFLICT");
      const view = await this.read(
        transaction,
        actor,
        context,
        parsed.data.ticketId,
      );
      if (!isWrite) return view;
      const access = createAgentTaskContext(
        agentTransactionScope(transaction),
        actor,
      );
      if (
        !(await access.tasks.actionPermissions(actor)).canWrite ||
        !(await access.projects.canWriteProject(actor, context.projectId))
      )
        throw new AgentOperationError("FORBIDDEN");
      const request = planWorkWriteSchema.parse(input);
      requireCurrentWork(view, request);
      const record: AgentPlanWorkRecord = {
        revision: request.expectedRevision + 1,
        requirementsHash: view.requirementsHash,
        contentHash: view.contentHash,
        scopeHash: planWorkScopeHash(view.items, request.scope),
        scope: request.scope,
        note: request.note,
        proofs: request.proofs,
        checks: request.checks,
        confirmed: request.action === "confirm",
      };
      const candidate = { ...view, record };
      const issues = this.issues(candidate);
      if (record.confirmed && issues.length)
        throw new AgentOperationError("CONFLICT");
      if (request.action === "scope") this.validateScope(candidate);
      await repository.insert(
        { ...context.key, ticketId: view.ticketId },
        record,
      );
      return { ...candidate, issues };
    });
  }

  /** Fails before a provider starts when ticket binding or actual write rights are missing. */
  public async preflight(
    userId: string,
    snapshot: AgentPlanSnapshot,
    stepId: string,
  ): Promise<void> {
    if (!planWorkStep({ ...snapshot }, stepId)?.completionGate) return;
    writableGateStep(snapshot, stepId);
    const ids = readPlanStepTickets(snapshot)[stepId] ?? [];
    const actor = await this.actor(userId);
    await this.database.transaction(async (transaction) => {
      const context = createAgentTaskContext(
        agentTransactionScope(transaction),
        actor,
      );
      if (
        !(await context.tasks.actionPermissions(actor)).canWrite ||
        !(await context.projects.canWriteProject(
          actor,
          snapshot.plan.projectId,
        ))
      )
        throw new AgentError("plan_work_gate_write_required");
      for (const id of ids) {
        const ticket = await context.tasks.getById(actor, id);
        if (
          ticket.projectId !== snapshot.plan.projectId ||
          ticket.archivedAt !== null
        )
          throw new AgentError("plan_binding_invalid");
      }
    });
  }

  /** Rechecks current ticket versions and persisted evidence, without trusting model output. */
  public async verify(
    runId: string,
    stepId: string,
    userId: string,
  ): Promise<readonly AgentPlanWorkView[]> {
    const actor = await this.actor(userId);
    return this.database.transaction(async (transaction) => {
      const basis = await new AgentPlanWorkRepository(transaction).basis(runId);
      if (!basis || basis.run.userId !== actor.id)
        throw new AgentError("plan_run_unavailable");
      const context = planWorkContext(basis, stepId);
      const views: AgentPlanWorkView[] = [];
      for (const id of context.ticketIds)
        views.push(await this.read(transaction, actor, context, id));
      if (
        !views.length ||
        views.some((view) => view.issues.length || view.statusKey !== "review")
      )
        throw new AgentError("plan_work_gate_failed");
      return views;
    });
  }

  /** Enforces acceptance after runner closeout while preserving the final script input byte for byte. */
  public async settle(
    runId: string,
    stepId: string,
    result: Partial<AgentPlanStepResult>,
    userId: string,
  ): Promise<Partial<AgentPlanStepResult>> {
    if (result.status !== "succeeded") return result;
    try {
      const views = await this.verify(runId, stepId, userId);
      const todos = views.flatMap((view) =>
        view.items
          .filter((item) =>
            view.record?.scope.some(
              (entry) => entry.itemId === item.id && entry.relevant,
            ),
          )
          .map((item) => ({
            id: item.id,
            text: item.text,
            ticket: { id: view.ticketId, key: view.ticketKey, itemId: item.id },
          })),
      );
      const numbered = todos.map((item, index) => ({
        ...item,
        id: `T${index + 1}`,
      }));
      return {
        ...result,
        ...(result.session
          ? {
              session: {
                ...result.session,
                contract: {
                  completion: "todos",
                  completionGate: {
                    version: 1,
                    requiredChecks: views[0]?.requiredChecks ?? [],
                  },
                  todos: numbered,
                  criteria: [],
                  tickets: views.map((view) => ({
                    id: view.ticketId,
                    key: view.ticketKey,
                  })),
                },
                acceptance: {
                  verdict: "accepted",
                  todos: numbered.map((item) => ({
                    id: item.id,
                    status: "done",
                  })),
                  criteria: [],
                  decisions: [],
                  issues: [],
                  summary: views
                    .map((view) => view.record?.note ?? "")
                    .join("; "),
                },
              },
            }
          : {}),
      };
    } catch (error: unknown) {
      const code =
        error instanceof AgentError ? error.code : "plan_work_gate_failed";
      return {
        ...result,
        status: "failed",
        error: code,
        ...(result.session
          ? {
              session: {
                ...result.session,
                resultCode: -1,
                acceptance: {
                  verdict: "open",
                  todos: [],
                  criteria: [],
                  decisions: [],
                  summary: "",
                  issues: [code],
                },
              },
            }
          : {}),
      };
    }
  }

  /** Adds freshly read, persistent scope/evidence to authorized run details after reload or reconnect. */
  public async withProgress(run: AgentPlanRun): Promise<AgentPlanRun> {
    const actor = await this.actor(run.userId);
    return this.database.transaction(async (transaction) => {
      const basis = await new AgentPlanWorkRepository(transaction).basis(
        run.id,
      );
      if (!basis) return run;
      const steps: AgentPlanStepResult[] = [];
      for (const step of run.steps) {
        if (
          (!step.execution?.attemptId &&
            !step.session?.attemptId &&
            !step.session?.instanceId) ||
          !step.progress ||
          !planWorkStep(basis.snapshot, step.id)?.completionGate
        ) {
          steps.push(step);
          continue;
        }
        steps.push(await this.progress(transaction, actor, basis, step));
      }
      return { ...run, steps };
    });
  }

  /** Stops Review/Done-style status changes from bypassing this run's required ticket check. */
  public async guardStatus(
    identity: AgentIdentity,
    input: unknown,
    context?: AgentTaskContext,
  ): Promise<void> {
    if (!identity.run) return;
    const fields = z
      .object({ ticketId: z.string(), statusId: z.string() })
      .safeParse(input);
    if (!fields.success) return;
    const actor = context?.actor ?? (await this.actor(identity.userId));
    const scope = identity.run;
    const check = (transaction: DatabaseTransaction): Promise<void> =>
      this.guardCurrentStatus(transaction, actor, scope, fields.data.statusId);
    if (context) await check(context.database);
    else await this.database.transaction(check);
  }

  private async actor(userId: string): Promise<User> {
    const actor = await this.users.getById(userId);
    if (!actor?.isActive) throw new AgentOperationError("FORBIDDEN");
    return actor;
  }

  private async guardCurrentStatus(
    transaction: DatabaseTransaction,
    actor: User,
    scope: AgentRunScope,
    statusId: string,
  ): Promise<void> {
    const basis = await new AgentPlanWorkRepository(transaction).basis(
      scope.runId,
    );
    if (!basis || !planWorkStep(basis.snapshot, scope.stepId)?.completionGate)
      return;
    if (basis.run.userId !== actor.id)
      throw new AgentOperationError("FORBIDDEN");
    const tasks = createAgentTaskContext(
      agentTransactionScope(transaction),
      actor,
    ).tasks;
    const status = (await tasks.findAllStatuses(actor)).find(
      (entry) => entry.id === statusId,
    );
    if (!status || (status.key !== "review" && !status.isDone)) return;
    const context = planWorkContext(basis, scope.stepId);
    for (const id of context.ticketIds) {
      const view = await this.read(transaction, actor, context, id);
      if (view.issues.length) throw new AgentOperationError("CONFLICT");
    }
  }

  private async read(
    transaction: DatabaseTransaction,
    actor: User,
    context: PlanWorkContext,
    reference: string,
  ): Promise<AgentPlanWorkView> {
    const tasks = createAgentTaskContext(
      agentTransactionScope(transaction),
      actor,
    ).tasks;
    const ticket = context.ticketIds.includes(reference)
      ? await tasks.getById(actor, reference)
      : await tasks.getByKey(actor, reference);
    if (
      !context.ticketIds.includes(ticket.id) ||
      ticket.projectId !== context.projectId ||
      ticket.archivedAt !== null
    )
      throw new AgentOperationError("FORBIDDEN");
    const checklist = materializeTicketChecklist(
      ticket.description,
      await tasks.findChecklistItems(actor, ticket.id),
    );
    const record = await readPlanWorkRecordForContext(
      new AgentPlanWorkRepository(transaction),
      context,
      ticket.id,
    );
    const view = {
      ...context.key,
      ticketId: ticket.id,
      ticketKey: ticket.key,
      statusKey: ticket.statusKey,
      requirementsHash: planContentDigest(
        JSON.stringify([ticket.title, checklist.requirementsHash]),
      ),
      contentHash: checklist.contentHash,
      items: checklist.items,
      requiredChecks: context.step.completionGate?.requiredChecks ?? [],
      record,
    };
    return { ...view, issues: this.issues(view) };
  }

  private issues(view: Omit<AgentPlanWorkView, "issues">): readonly string[] {
    return planWorkIssues({
      ...view,
      checklist: { items: view.items, contentHash: view.contentHash },
    });
  }

  private async progress(
    transaction: DatabaseTransaction,
    actor: User,
    basis: {
      readonly run: AgentPlanRun;
      readonly snapshot: Record<string, unknown>;
    },
    step: AgentPlanStepResult,
  ): Promise<AgentPlanStepResult> {
    if (!step.progress) return step;
    try {
      const context = planWorkContext(basis, step.id);
      const work: AgentPlanWorkView[] = [];
      for (const id of context.ticketIds)
        work.push(await this.read(transaction, actor, context, id));
      const todos = step.progress.todos.filter(
        (item) =>
          !work.some(
            (view) =>
              view.ticketId === item.ticket?.id &&
              view.record?.scope.some(
                (entry) =>
                  entry.itemId === item.ticket?.itemId && !entry.relevant,
              ),
          ),
      );
      return { ...step, progress: { ...step.progress, todos, work } };
    } catch (error: unknown) {
      logCaughtError("AgentPlanWorkGate", error);
      return {
        ...step,
        progress: {
          ...step.progress,
          availability: "unavailable",
          work: [],
          todos: step.progress.todos.map((item) => ({
            ...item,
            status: "missing",
          })),
        },
      };
    }
  }

  private validateScope(view: AgentPlanWorkView): void {
    const scope = view.record?.scope ?? [];
    if (
      !scope.some((item) => item.relevant) ||
      scope.length !== view.items.length ||
      new Set(scope.map((item) => item.itemId)).size !== scope.length ||
      scope.some(
        (item) =>
          !view.items.some((entry) => entry.id === item.itemId) ||
          (!item.relevant && !item.reason.trim()),
      )
    )
      throw new AgentOperationError("INVALID_REQUEST");
  }
}
