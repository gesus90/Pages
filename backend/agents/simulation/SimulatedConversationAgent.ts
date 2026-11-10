import { setTimeout as delay } from "node:timers/promises";

import type { AgentSimulationMode } from "./AgentSimulationMode";

/** Characters of the answered message the simulated answer quotes at most. */
const QUOTE_CHARACTERS = 200;
const SLOW_DELAY_MS = 5_000;

/** What the simulated agent answers. */
export interface SimulatedConversationQuestion {
  readonly agentName: string;
  /** The text of the answered message. */
  readonly lastMessage: string;
}

/**
 * The simulated agent of a conversation (PAGE-276), part of the development
 * simulation of PAGE-268.
 *
 * @remarks
 * It answers where the agent's model would answer and contacts no model
 * provider. `ok` answers at once with a fixed text that names the last
 * message, `slow` the same after five seconds, `failed` fails on purpose.
 * The other scenarios concern plan nodes and answer like `ok`.
 */
export class SimulatedConversationAgent {
  private readonly mode: AgentSimulationMode;

  public constructor(mode: AgentSimulationMode) {
    this.mode = mode;
  }

  /**
   * Answers one message.
   *
   * @throws {Error} In the scenario `failed`.
   */
  public async answer(
    question: SimulatedConversationQuestion,
  ): Promise<string> {
    const { scenario } = this.mode;
    if (scenario === "slow") await delay(SLOW_DELAY_MS);
    if (scenario === "failed")
      throw new Error(
        "Simulation scenario failed: the answer of the agent fails on purpose.",
      );
    const characters = Array.from(question.lastMessage.trim());
    const quote =
      characters.length > QUOTE_CHARACTERS
        ? `${characters.slice(0, QUOTE_CHARACTERS).join("")}…`
        : characters.join("");
    return `Simulation (Szenario ${scenario}): ${question.agentName} hat deine Nachricht „${quote}“ erhalten. Kein Modellanbieter wurde angefragt.`;
  }
}
