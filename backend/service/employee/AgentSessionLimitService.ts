import { z } from "zod";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_DREAM_TIME_PATTERN } from "@/definition/AgentMemory";
import { AGENT_SESSION_LIMIT_MAXIMUM } from "@/definition/AgentSessionLimits";

import { requireAgentAdministrator } from "../agents/AgentServiceAccess";

import type { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
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
  })
  .refine((input) => input.perAgent <= input.total);

/**
 * The limits of the concurrent chat sessions of agents (PAGE-304) and the
 * time of day of the dream run (PAGE-305), under Einstellungen → Agents.
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

  public constructor(
    settings: AgentSessionSettingsRepository,
    slots: Pick<AgentSessionSlots, "apply" | "running" | "waiting">,
  ) {
    this.settings = settings;
    this.slots = slots;
  }

  /** The limits every session applies and the dream time, read anew for each use. */
  public limits(): Promise<AgentSessionLimits> {
    return this.settings.read();
  }

  /** Supplies the settings card with the limits and the sessions running and waiting now. */
  public async administration(
    actor: AccountAccess,
  ): Promise<AgentSessionLimitsAdministration> {
    requireAgentAdministrator(actor);
    return {
      limits: await this.settings.read(),
      running: this.slots.running,
      waiting: this.slots.waiting,
    };
  }

  /**
   * Saves both limits and the time of day of the dream run (PAGE-305).
   *
   * @throws {AgentError} `profile_invalid` for a value outside 1 to 64, a
   * limit per agent above the total or a time that is no `HH:MM`,
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
