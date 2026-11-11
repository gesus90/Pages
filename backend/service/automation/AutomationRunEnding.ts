import { randomUUID } from "node:crypto";

import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationNotificationPreferenceRepository } from "@/backend/database/repositories/automation/AutomationNotificationPreferenceRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AUTOMATION_RUN_RETENTION } from "@/definition/Automation";

import { noticePrompt } from "./AutomationPrompts";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type {
  AutomationRunEnding as StoredRunEnding,
  StoredAutomationRun,
} from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationRunNotice } from "@/backend/service/mobile/notifications/PicaMobileAutomationPush";
import type { AutomationAccess } from "./AutomationAccess";

/** How a run ended, before the rules of its automation apply. */
export type AutomationRunConclusion = Omit<
  StoredRunEnding,
  "status" | "endedAt" | "paused"
>;

/** What ending a run is built from. */
export interface AutomationRunEndingDependencies {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly rules: AutomationAccess;
  readonly now: () => Date;
  /** Tells a person on their devices; does nothing where Pages cannot deliver. */
  readonly notifyPerson: (
    userId: string,
    notice: AutomationRunNotice,
  ) => Promise<void>;
}

const COMPONENT = "AutomationRunEnding";

function isFailure(outcome: AutomationRunConclusion["outcome"]): boolean {
  return outcome === "failed" || outcome === "forbidden";
}

/**
 * Ends runs and applies what follows from their result (PAGE-297).
 *
 * @remarks
 * A run ends once: its result is stored before anything else happens, so a
 * restart afterwards never repeats or interrupts it. Missing rights pause
 * the automation. A once run that succeeded deletes an automation that asks
 * for it; a failed once run leaves it switched off. The agent notification
 * reaches its agent once per run, never when that agent already produced or
 * received exactly this result, and the person who created the automation
 * hears about it as they chose.
 */
export class AutomationRunEnding {
  private readonly dependencies: AutomationRunEndingDependencies;

  public constructor(dependencies: AutomationRunEndingDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Ends a run that has not ended yet.
   *
   * @param run - The run.
   * @param conclusion - Its outcome and outputs.
   */
  public async end(
    run: StoredAutomationRun,
    conclusion: AutomationRunConclusion,
  ): Promise<void> {
    const { database, now } = this.dependencies;
    const automation = await new AutomationRepository(database).find(
      run.automationId,
    );
    const isOnce = run.triggerKind === "once";
    const shouldPause =
      conclusion.outcome === "forbidden" && automation?.isActive === true;
    const endedAt = now().toISOString();
    const isEnded = await new AutomationRunRepository(database).finish(run.id, {
      ...conclusion,
      status: isFailure(conclusion.outcome) ? "failed" : "completed",
      paused: shouldPause || (isOnce && conclusion.outcome !== "ok"),
      endedAt,
    });
    if (!isEnded || !automation) return;
    logEvent({
      level: "info",
      event: "automation.run.ended",
      component: COMPONENT,
      message: "Automation run ended",
      metadata: {
        automationId: automation.id,
        runId: run.id,
        status: conclusion.outcome,
      },
    });
    await this.followUp(automation, run, { ...conclusion, endedAt });
    if (shouldPause) await this.pause(automation);
    else if (
      isOnce &&
      conclusion.outcome === "ok" &&
      automation.deleteAfterSuccess
    )
      await new AutomationRepository(database).delete(automation.id);
    else
      await new AutomationRunRepository(database).prune(
        automation.id,
        AUTOMATION_RUN_RETENTION,
      );
  }

  private async followUp(
    automation: StoredAutomation,
    run: StoredAutomationRun,
    conclusion: AutomationRunConclusion & { readonly endedAt: string },
  ): Promise<void> {
    try {
      await this.notifyAgent(automation, run, conclusion);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
    try {
      await this.notifyCreator(automation, run, conclusion);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }

  private async pause(automation: StoredAutomation): Promise<void> {
    await this.dependencies.database.transaction(async (transaction) => {
      const automations = new AutomationRepository(transaction);
      const current = await automations.lock(automation.id);
      if (!current?.isActive) return;
      await automations.replace(
        {
          ...current,
          isActive: false,
          nextRunAt: null,
          revision: current.revision + 1,
          updatedAt: this.dependencies.now().toISOString(),
        },
        current.revision,
      );
    });
  }

  /** Whether the agent already produced or received exactly this result. */
  private isAlreadyServed(
    automation: StoredAutomation,
    agentId: string,
    conclusion: AutomationRunConclusion,
  ): boolean {
    const { action } = automation;
    if (action.type === "agent") return action.agentId === agentId;
    return (
      action.type === "script" &&
      action.forward?.agentId === agentId &&
      conclusion.forwardState === "woken"
    );
  }

  private async notifyAgent(
    automation: StoredAutomation,
    run: StoredAutomationRun,
    conclusion: AutomationRunConclusion & { readonly endedAt: string },
  ): Promise<void> {
    const { mode, agentId } = automation.agentNotification;
    if (mode === "off" || !agentId) return;
    if (mode === "error" && !isFailure(conclusion.outcome)) return;
    if (this.isAlreadyServed(automation, agentId, conclusion)) return;
    const { rules, database, now } = this.dependencies;
    const creator = await rules.account(automation.creatorId);
    if (!creator || !(await rules.canUseAgent(agentId, creator))) return;
    await new AutomationAgentJobRepository(database).enqueue({
      id: randomUUID(),
      runId: run.id,
      automationId: automation.id,
      agentId,
      creatorId: automation.creatorId,
      kind: "notification",
      prompt: noticePrompt(
        {
          automationId: automation.id,
          name: automation.name,
          runId: run.id,
          event: run.eventType ?? run.triggerKind,
          status: conclusion.outcome,
          at: conclusion.endedAt,
          exitCode: conclusion.exitCode ?? null,
          result: conclusion.answer ?? conclusion.summary ?? null,
          error: conclusion.error ?? conclusion.errorCode ?? null,
        },
        creator.language,
      ),
      queuedAt: now().toISOString(),
    });
  }

  private async notifyCreator(
    automation: StoredAutomation,
    run: StoredAutomationRun,
    conclusion: AutomationRunConclusion & { readonly endedAt: string },
  ): Promise<void> {
    const { database, rules } = this.dependencies;
    const creator = await rules.account(automation.creatorId);
    if (!creator?.isActive || creator.isAgent) return;
    const mode = await new AutomationNotificationPreferenceRepository(
      database,
    ).find(creator.id);
    if (mode === "off") return;
    if (mode === "error" && !isFailure(conclusion.outcome)) return;
    await this.dependencies.notifyPerson(creator.id, {
      automationId: automation.id,
      automationName: automation.name,
      runId: run.id,
      outcome: conclusion.outcome,
      endedAt: conclusion.endedAt,
    });
  }
}
