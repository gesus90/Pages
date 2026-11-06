import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { pagesPlanBridgeOpenedSchema } from "@/definition/PagesRunsRunner";

import { callRunApi } from "./RunsSocket";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type {
  AgentPlanMcpSettings,
  AgentPlanSessionGrant,
  AgentPlanSessionGrants,
} from "../AgentPlanSessionAccess";

const OPEN_DEADLINE_MS = 10_000;
const CLOSE_ATTEMPTS = 3;

/**
 * The plan bridge access of an engine that runs in its own process.
 *
 * @remarks
 * The API process issues the step credential and keeps the bearer in its
 * memory, because only it serves the plan bridge. This class asks it over the
 * private run API socket and receives the bearer only; the credential never
 * crosses the socket. Nothing of the grant is stored on this side.
 *
 * Opening is retried only for a transport failure, and the API replaces an
 * earlier grant of the same step, so a lost answer leaves one live capability.
 * Ending is retried too, but a call that never arrives does not decide
 * anything: the API admits a bearer only while its step is `running` in the
 * stored run, which the engine ends before or right after it revokes. A
 * restart of the API ends every bearer; a restart of this process does not,
 * and startup recovery revokes the runs it interrupted.
 */
export class RunApiPlanAccess implements AgentPlanSessionGrants {
  private readonly socketPath: string;
  private readonly settings: AgentPlanMcpSettings;

  public constructor(socketPath: string, settings: AgentPlanMcpSettings) {
    this.socketPath = socketPath;
    this.settings = settings;
  }

  /** Asks the API for the bearer of one node; an unreachable API refuses the node. */
  public async grant(
    grant: AgentPlanSessionGrant,
  ): Promise<CliSessionMcp | null> {
    if (grant.reach === "tickets" && grant.tickets.length === 0) return null;
    const deadline = Date.now() + OPEN_DEADLINE_MS;
    for (;;) {
      try {
        return this.read(
          await callRunApi(this.socketPath, this.request(grant)),
        );
      } catch (error: unknown) {
        if (error instanceof AgentError) throw error;
        if (Date.now() >= deadline) {
          logCaughtError("RunApiPlanAccess", error);

          throw new AgentError("plan_mcp_unavailable");
        }
        await wait(250);
      }
    }
  }

  /**
   * Ends the bearers in the API.
   *
   * @returns How many credentials were still valid; `0` also when the API could not be reached after
   * every attempt. That case is logged and does not keep the bearer usable,
   * because the API refuses it as soon as its step is no longer `running`.
   */
  public async revoke(runId: string, stepId: string | null): Promise<number> {
    for (let attempt = 1; attempt <= CLOSE_ATTEMPTS; attempt += 1) {
      try {
        return z
          .number()
          .int()
          .nonnegative()
          .parse(
            await callRunApi(this.socketPath, {
              version: 1,
              operation: "closePlanBridge",
              runId,
              stepId,
            }),
          );
      } catch (error: unknown) {
        logCaughtError("RunApiPlanAccess", error);
        await wait(250);
      }
    }
    logEvent({
      level: "warn",
      event: "plan_bridge.revoke_unconfirmed",
      component: "RunApiPlanAccess",
      message:
        "The API did not confirm the end of a plan bridge grant; it still refuses it once the step is no longer running",
      metadata: { runId },
    });
    return 0;
  }

  private request(grant: AgentPlanSessionGrant): Record<string, unknown> {
    return {
      version: 1,
      operation: "openPlanBridge",
      userId: grant.userId,
      runId: grant.runId,
      stepId: grant.stepId,
      instanceId: grant.instanceId,
      tickets: grant.tickets.map(({ id, key }) => ({ id, key })),
      lifetimeMs: grant.lifetimeMs,
      reach: grant.reach,
      ...(grant.canSetStatus === undefined
        ? {}
        : { canSetStatus: grant.canSetStatus }),
    };
  }

  private read(answer: unknown): CliSessionMcp | null {
    const { access } = pagesPlanBridgeOpenedSchema.parse(answer);
    if (access === null) return null;
    return {
      url: this.settings.url,
      token: access.token,
      tools: access.tools,
    };
  }
}
