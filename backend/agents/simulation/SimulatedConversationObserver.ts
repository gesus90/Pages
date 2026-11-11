import { CONVERSATION_SUMMARY_LIMITS } from "@/definition/ConversationObserver";

import type {
  ObserverLine,
  RoutingMaterial,
  SummaryMaterial,
} from "@/backend/service/conversation/ConversationObserverPrompts";
import type { AgentSimulationMode } from "./AgentSimulationMode";

/** Shortest word of a job title that counts as a keyword. */
const KEYWORD_LENGTH = 4;

function clip(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join("");
}

function keywords(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => Array.from(word).length >= KEYWORD_LENGTH);
}

function entries(
  previous: readonly string[],
  lines: readonly ObserverLine[],
  matches: (text: string) => boolean,
): string[] {
  const added = lines
    .filter((line) => matches(line.text))
    .map((line) => clip(`${line.author}: ${line.text.trim()}`, 120));
  return [...previous, ...added].slice(
    -CONVERSATION_SUMMARY_LIMITS.listEntries,
  );
}

/**
 * The simulated group observer (PAGE-296), part of the development
 * simulation of PAGE-268.
 *
 * @remarks
 * It answers where Pica's model would route or summarize and contacts no
 * model provider. A routing, also after the answer of an agent, chooses the
 * agents whose name, username or a word of their job title the judged
 * message contains; a summary lists the new messages, takes lines with
 * "entschieden" as decisions, questions as open points and lines with
 * "zuständig" as responsibilities. The scenario `failed` fails on purpose,
 * every other scenario answers.
 */
export class SimulatedConversationObserver {
  private readonly mode: AgentSimulationMode;

  public constructor(mode: AgentSimulationMode) {
    this.mode = mode;
  }

  /**
   * Answers a routing decision in the format of the observer.
   *
   * @throws {Error} In the scenario `failed`.
   */
  public route(material: RoutingMaterial): string {
    this.requireWorking();
    const judged = (material.lines.at(-1)?.text ?? "").toLocaleLowerCase();
    const agents = material.candidates
      .map((candidate) => {
        const words = [
          candidate.name.toLocaleLowerCase(),
          candidate.username.toLocaleLowerCase(),
          ...keywords(candidate.role),
        ];
        const word = words.find(
          (entry) => entry !== "" && judged.includes(entry),
        );
        return word === undefined
          ? null
          : {
              id: candidate.id,
              reason: `Simulation: „${word}“ passt zur angegebenen Zuständigkeit.`,
            };
      })
      .filter((entry) => entry !== null)
      .slice(0, material.maximum);
    return JSON.stringify({ agents });
  }

  /**
   * Answers a summary window in the format of the observer.
   *
   * @throws {Error} In the scenario `failed`.
   */
  public summarize(material: SummaryMaterial): string {
    this.requireWorking();
    const { lines, previous } = material;
    const [first] = lines;
    const last = lines.at(-1);
    const authors = [...new Set(lines.map((line) => line.author))].join(", ");
    const added = `Simulation: Nachrichten #${String(first?.sequence ?? 0)} bis #${String(last?.sequence ?? 0)} von ${authors}.`;
    const summary = clip(
      [previous?.summary ?? "", added].filter(Boolean).join(" "),
      1_000,
    );
    return JSON.stringify({
      summary,
      decisions: entries(previous?.decisions ?? [], lines, (text) =>
        text.toLocaleLowerCase().includes("entschieden"),
      ),
      openItems: entries(previous?.openItems ?? [], lines, (text) =>
        text.trim().endsWith("?"),
      ),
      responsibilities: entries(
        previous?.responsibilities ?? [],
        lines,
        (text) => text.toLocaleLowerCase().includes("zuständig"),
      ),
    });
  }

  private requireWorking(): void {
    if (this.mode.scenario === "failed")
      throw new Error(
        "Simulation scenario failed: the group observer fails on purpose.",
      );
  }
}
