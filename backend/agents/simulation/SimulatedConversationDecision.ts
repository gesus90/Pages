import type {
  DecisionMaterial,
  DecisionOption,
  DecisionProbabilities,
} from "@/backend/service/conversation/ConversationDecisionPrompt";
import type { AgentSimulationMode } from "./AgentSimulationMode";

/** Shortest word of a job title that counts as a keyword. */
const KEYWORD_LENGTH = 4;

function keywords(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => Array.from(word).length >= KEYWORD_LENGTH);
}

/** The probability of the first agent a message names, alone and next to others. */
const ONLY_AGENT = 0.85;
const FIRST_OF_SEVERAL = 0.5;
const FURTHER_AGENT = 0.4;

/**
 * The simulated decision model (PAGE-317, PAGE-379), part of the development
 * simulation of PAGE-268.
 *
 * @remarks
 * It answers where the decision model would and contacts no provider: it
 * gives the agents whose name, username or a word of their role or
 * specialization the judged message contains a high probability, expects an
 * answer when it names an agent or contains a question mark, and gives
 * nobody the rest. The scenario `failed` fails on purpose.
 */
export class SimulatedConversationDecision {
  private readonly mode: AgentSimulationMode;

  public constructor(mode: AgentSimulationMode) {
    this.mode = mode;
  }

  /**
   * Answers one decision with probabilities.
   *
   * @throws {Error} In the scenario `failed`.
   */
  public decide(material: DecisionMaterial): DecisionProbabilities {
    if (this.mode.scenario === "failed")
      throw new Error(
        "Simulation scenario failed: the decision model fails on purpose.",
      );
    const judged = (material.lines.at(-1)?.text ?? "").toLocaleLowerCase();
    const matching = new Set(
      material.candidates
        .filter((candidate) =>
          [
            candidate.name.toLocaleLowerCase(),
            candidate.username.toLocaleLowerCase(),
            ...keywords(candidate.role),
            ...keywords(candidate.specialization),
          ].some((word) => word !== "" && judged.includes(word)),
        )
        .map((candidate) => candidate.id),
    );
    let rank = 0;
    const options: DecisionOption[] = material.candidates.map((candidate) => {
      if (!matching.has(candidate.id))
        return { agentId: candidate.id, probability: 0 };
      rank += 1;
      const first = matching.size === 1 ? ONLY_AGENT : FIRST_OF_SEVERAL;
      return {
        agentId: candidate.id,
        probability: rank === 1 ? first : FURTHER_AGENT,
      };
    });
    const named = matching.size > 0;
    const taken = options.reduce((sum, option) => sum + option.probability, 0);
    return {
      answerProbability: named || judged.includes("?") ? 0.9 : 0.1,
      options: [
        ...options,
        { agentId: null, probability: Math.max(0, 1 - taken) },
      ],
    };
  }
}
