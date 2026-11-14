import { z } from "zod";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_DREAM_TIME_PATTERN } from "@/definition/AgentMemory";
import {
  AGENT_CHAT_IDLE_MAXIMUM_MINUTES,
  AGENT_SESSION_LIMIT_MAXIMUM,
} from "@/definition/AgentSessionLimits";

import { requireAgentAdministrator } from "../agents/AgentServiceAccess";

import type { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { PageAgentModel } from "@/definition/PageAgent";
import type {
  AgentSessionLimits,
  AgentSessionLimitsAdministration,
} from "@/definition/AgentSessionLimits";
import type { AgentSessionSlots } from "./AgentSessionSlots";

const limit = z.coerce.number().int().min(1).max(AGENT_SESSION_LIMIT_MAXIMUM);

/** A submitted change of the limits, as the form sends it. */
const limitsInput = z
  .object({
    perAgent: limit,
    total: limit,
    revision: z.coerce.number().int().min(0),
    dreamTime: z.string().regex(AGENT_DREAM_TIME_PATTERN),
    idleMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(AGENT_CHAT_IDLE_MAXIMUM_MINUTES),
  })
  .refine((input) => input.perAgent <= input.total);

/** The model of the Lagebuch summary as the form sends it; both empty means none. */
const logbookModelInput = z
  .object({
    connectionId: z.string().max(300),
    model: z.string().max(300),
  })
  .refine((input) => (input.connectionId === "") === (input.model === ""));

/**
 * The limits of the concurrent chat sessions of agents (PAGE-304), the
 * time of day of the dream run (PAGE-305) and the idle time of a resting
 * chat session (PAGE-335), under Einstellungen → Agents.
 *
 * @remarks
 * Only an administrator in the active admin mode reads and saves them. A
 * saved change applies at once: raised limits start waiting sessions,
 * lowered ones let running sessions finish and hold back the next ones.
 */
export class AgentSessionLimitService {
  private readonly settings: AgentSessionSettingsRepository;
  private readonly slots: Pick<
    AgentSessionSlots,
    "apply" | "running" | "waiting"
  >;
  private readonly writes = new SerialQueue();
  private readonly models: (
    userId: string,
  ) => Promise<readonly PageAgentModel[]>;

  public constructor(
    settings: AgentSessionSettingsRepository,
    slots: Pick<AgentSessionSlots, "apply" | "running" | "waiting">,
    models: (userId: string) => Promise<readonly PageAgentModel[]> = () =>
      Promise.resolve([]),
  ) {
    this.settings = settings;
    this.slots = slots;
    this.models = models;
  }

  /** The limits every session applies and the dream time, read anew for each use. */
  public limits(): Promise<AgentSessionLimits> {
    return this.settings.read();
  }

  /** The idle time of a resting chat session, read anew for every rest (PAGE-335). */
  public async idleMinutes(): Promise<number> {
    return (await this.settings.read()).idleMinutes;
  }

  /** Supplies the settings card with the limits and the sessions running and waiting now. */
  public async administration(
    actor: AccountAccess,
  ): Promise<AgentSessionLimitsAdministration> {
    requireAgentAdministrator(actor);
    const [limits, logbookModel, models] = await Promise.all([
      this.settings.read(),
      this.settings.logbookModel(),
      this.models(actor.userId),
    ]);
    return {
      limits,
      running: this.slots.running,
      waiting: this.slots.waiting,
      logbookModel,
      logbookModels: models.flatMap((model) =>
        model.connectionId === undefined
          ? []
          : [
              {
                connectionId: model.connectionId,
                model: model.model,
                label: model.name,
              },
            ],
      ),
    };
  }

  /**
   * Saves the model the instance names for the background summary of the
   * Lagebuch (PAGE-377), for agents without a model of their own; empty
   * fields clear it, which leaves the agent's own model.
   *
   * @throws {AgentError} `profile_invalid` for a malformed choice or a model
   * the administrator may not give an agent.
   */
  public async saveLogbookModel(
    actor: AccountAccess,
    input: unknown,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const parsed = logbookModelInput.safeParse(input);
    if (!parsed.success) throw new AgentError("profile_invalid");
    const { connectionId, model } = parsed.data;
    if (connectionId === "") {
      await this.writes.run(() => this.settings.saveLogbookModel(null));
      return;
    }
    const allowed = (await this.models(actor.userId)).some(
      (entry) => entry.connectionId === connectionId && entry.model === model,
    );
    if (!allowed) throw new AgentError("profile_invalid");
    await this.writes.run(() =>
      this.settings.saveLogbookModel({ connectionId, model }),
    );
  }

  /**
   * Saves both limits, the time of day of the dream run (PAGE-305) and the
   * idle time of a resting chat session (PAGE-335).
   *
   * @throws {AgentError} `profile_invalid` for a value outside 1 to 64, a
   * limit per agent above the total, a time that is no `HH:MM` or an idle
   * time outside 1 to 1440 minutes,
   * `profile_conflict` after a concurrent change.
   */
  public async save(actor: AccountAccess, input: unknown): Promise<void> {
    requireAgentAdministrator(actor);
    const parsed = limitsInput.safeParse(input);
    if (!parsed.success) throw new AgentError("profile_invalid");
    await this.writes.run(() => this.settings.save(parsed.data));
    this.slots.apply(parsed.data);
  }
}
