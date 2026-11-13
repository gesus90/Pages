import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import type {
  DecisionQuestion,
  OpenRouterDecisionsResponse,
} from "./OpenRouterDecisionsClient";
import type { ObserverLine } from "./ConversationObserverPrompts";

/** An agent member the decision model may choose, with what its profile states. */
export interface DecisionCandidate {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  /** The job title of the agent; empty when none is stated. */
  readonly role: string;
  /** What its `AGENT.md` states it is for, shortened; empty when it states none. */
  readonly specialization: string;
}

/** What one decision reads: the group, its agents and the newest messages. */
export interface DecisionMaterial {
  readonly groupName: string;
  readonly candidates: readonly DecisionCandidate[];
  /** The newest messages up to the judged one, oldest first; the last line is it. */
  readonly lines: readonly ObserverLine[];
}

/** The two typed questions and the state they are about. */
export interface DecisionQuestions {
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

/** One option of the second question with its probability, 0 to 1. */
export interface DecisionOption {
  /** The agent; `null` for the option "nobody". */
  readonly agentId: string | null;
  readonly probability: number;
}

/** What the decision model gave: both answers as probabilities. */
export interface DecisionProbabilities {
  /** The chance that the message expects an answer of an agent. */
  readonly answerProbability: number;
  /** The probability of every agent of the group and of nobody. */
  readonly options: readonly DecisionOption[];
}

/** The question ID of the yes/no question. */
export const ANSWER_EXPECTED_QUESTION = "answer_expected";

/** The question ID of the question with options. */
export const AGENT_MEANT_QUESTION = "agent_meant";

/** The option of the second question that means no agent. */
export const NOBODY_OPTION = "(niemand)";

function lineText(line: ObserverLine): string {
  const who = `${line.author}${line.isAgent ? " (Agent)" : " (Mensch)"}`;
  const excerpt = line.isExcerpt ? " [Auszug, gekürzt]" : "";
  return `#${String(line.sequence)} ${who}${excerpt}: ${redactCredentials(line.text)}`;
}

function describeCandidate(candidate: DecisionCandidate): string {
  const stated = [candidate.role.trim(), candidate.specialization.trim()]
    .filter((part) => part !== "")
    .join(" · ");
  return `${candidate.name}: ${stated === "" ? "keine Angabe" : stated}`;
}

/**
 * The two typed questions of one decision (PAGE-379).
 *
 * @param material - The agents, the newest messages and the new message.
 * @returns The state and the questions of one decision request: whether the
 * new message expects an answer of an agent (yes/no), and which agent is
 * meant, with every agent of the group and "nobody" as options.
 *
 * @remarks
 * The model gets the group name, the agents with name, username, job title
 * and specialization, the newest messages of the group, which every member
 * sees, and the new message. It gets no credentials, no memory of an agent
 * and no other chat. Pages decides with thresholds; the model only gives
 * probabilities.
 */
export function decisionQuestions(
  material: DecisionMaterial,
): DecisionQuestions {
  const judged = material.lines.at(-1);
  const earlier = material.lines.slice(0, -1);
  const criteria: Record<string, string> = Object.fromEntries(
    material.candidates.map((candidate) => [
      candidate.username,
      describeCandidate(candidate),
    ]),
  );
  criteria[NOBODY_OPTION] = "Kein Agent der Gruppe ist gemeint.";
  return {
    state: {
      gruppe: material.groupName,
      agents: material.candidates.map((candidate) => ({
        name: candidate.name,
        username: candidate.username,
        spezialisierung: describeCandidate(candidate),
      })),
      letzte_nachrichten: earlier.map(lineText),
      neue_nachricht: judged === undefined ? "" : lineText(judged),
    },
    questions: {
      [ANSWER_EXPECTED_QUESTION]: {
        type: "noul",
        instructions:
          "Erwartet die neue Nachricht (neue_nachricht) eine Antwort eines Agents der Gruppe? Ja bei einer Frage oder Bitte, die ein Agent beantworten oder erledigen soll. Nein bei Dank, Zustimmung, Abschlussnachrichten und Gesprächen zwischen Menschen.",
      },
      [AGENT_MEANT_QUESTION]: {
        type: "choice",
        instructions:
          "Welcher Agent ist mit der neuen Nachricht (neue_nachricht) gemeint? Wähle „(niemand)“, wenn kein Agent gemeint ist.",
        criteria,
      },
    },
  };
}

/**
 * Reads the answers of the decision model.
 *
 * @param response - What OpenRouter answered.
 * @param candidates - The agents the question offered.
 * @returns The chance that an answer is expected and one probability for each
 * agent and for nobody; an option the model left out counts as 0.
 * @throws {ConversationObserverError} `decision_invalid` when an answer is
 * missing, has another type than asked, or gives no probability of any option
 * asked.
 */
export function readDecisionProbabilities(
  response: OpenRouterDecisionsResponse,
  candidates: readonly DecisionCandidate[],
): DecisionProbabilities {
  const expected = response.answers[ANSWER_EXPECTED_QUESTION];
  const meant = response.answers[AGENT_MEANT_QUESTION];
  if (expected?.type !== "noul" || meant?.type !== "choice")
    throw new ConversationObserverError("decision_invalid");
  const { probabilities } = meant;
  if (probabilities === null)
    throw new ConversationObserverError("decision_invalid");
  const keys = [
    ...candidates.map((candidate) => candidate.username),
    NOBODY_OPTION,
  ];
  if (!keys.some((key) => key in probabilities))
    throw new ConversationObserverError("decision_invalid");
  return {
    answerProbability: expected.noul,
    options: [
      ...candidates.map((candidate) => ({
        agentId: candidate.id,
        probability: probabilities[candidate.username] ?? 0,
      })),
      { agentId: null, probability: probabilities[NOBODY_OPTION] ?? 0 },
    ],
  };
}
