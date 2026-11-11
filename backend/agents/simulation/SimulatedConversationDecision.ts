import type { DecisionMaterial } from "@/backend/service/conversation/ConversationDecisionPrompt";
import type { AgentSimulationMode } from "./AgentSimulationMode";

/** Shortest word of a job title that counts as a keyword. */
const KEYWORD_LENGTH = 4;

function keywords(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => Array.from(word).length >= KEYWORD_LENGTH);
}

/**
 * The simulated decision model (PAGE-317), part of the development
 * simulation of PAGE-268.
 *
 * @remarks
 * It answers where the decision model would and contacts no provider: it
 * chooses the agents whose name, username or a word of their role the judged
 * message contains, finds a question or request in a text with a question
 * mark, and names the agents of the group as suggestions then. The scenario
 * `failed` fails on purpose.
 */
export class SimulatedConversationDecision {
  private readonly mode: AgentSimulationMode;

  public constructor(mode: AgentSimulationMode) {
    this.mode = mode;
  }

  /**
   * Answers one decision in the format of the decision model.
   *
   * @throws {Error} In the scenario `failed`.
   */
  public decide(material: DecisionMaterial): string {
    if (this.mode.scenario === "failed")
      throw new Error(
        "Simulation scenario failed: the decision model fails on purpose.",
      );
    const judged = (material.lines.at(-1)?.text ?? "").toLocaleLowerCase();
    const matching = material.candidates.filter((candidate) =>
      [
        candidate.name.toLocaleLowerCase(),
        candidate.username.toLocaleLowerCase(),
        ...keywords(candidate.role),
      ].some((word) => word !== "" && judged.includes(word)),
    );
    const needsAnswer = judged.includes("?");
    return JSON.stringify({
      responders: matching.slice(0, material.maximum).map((entry) => entry.id),
      needsAnswer,
      reason:
        matching.length > 0
          ? "Simulation: Die Rolle passt zur Nachricht."
          : "Simulation: Kein Agent ist erkennbar angesprochen.",
      suggested: needsAnswer
        ? material.candidates.slice(0, 2).map((entry) => entry.id)
        : [],
    });
  }
}
