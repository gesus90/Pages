import type {
  AgentMemoryCaller,
  AgentMemoryModel,
} from "@/backend/service/employee/AgentMemoryModel";
import type {
  AgentDreamAnswer,
  AgentDreamInput,
} from "@/backend/service/employee/AgentLearningPrompt";
import type { AgentTopicUpdate } from "@/backend/service/employee/AgentMemoryPrompt";
import type { AgentLogbookDraft } from "@/backend/service/employee/AgentLogbookService";

/** Words of a message that make the title of a simulated topic. */
const TITLE_WORDS = 6;
/** Lessons one simulated dream run derives at most. */
const DREAM_LESSONS = 5;
/** Topics one simulated dream run takes from the Lagebuch at most. */
const DREAM_TOPICS = 3;
const TICKET_KEY = /\b[A-Z][A-Z0-9]*-\d+\b/gu;
/** Entries one simulated Lagebuch summary writes at most. */
const LOGBOOK_ENTRIES = 3;

function cut(text: string, maximum: number): string {
  const single = text.replace(/\s+/gu, " ").trim();
  const characters = Array.from(single);
  return characters.length <= maximum
    ? single
    : `${characters.slice(0, maximum - 1).join("")}…`;
}

/**
 * The model calls of the memory in the development simulation (PAGE-305,
 * part of PAGE-268).
 *
 * @remarks
 * It contacts no model provider and derives its answers from the input
 * alone: a topic titled by the first words of the message with the ticket
 * keys it names, a summary of the first words of each message, and lessons
 * from the people's messages and plan runs of the day.
 */
export class SimulatedAgentMemoryModel implements AgentMemoryModel {
  /** One topic per exchange; a message with "erledigt" finishes it. */
  public topics(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["topics"]>[1],
  ): Promise<readonly AgentTopicUpdate[] | null> {
    const { message, answer } = input.exchange;
    const title = message.trim().split(/\s+/u).slice(0, TITLE_WORDS).join(" ");
    if (title === "") return Promise.resolve([]);
    return Promise.resolve([
      {
        title,
        about: cut(message, 300),
        status: `${caller.agent.displayName} hat geantwortet: ${cut(answer, 160)}`,
        nextStep: "",
        tickets: [...new Set(`${message} ${answer}`.match(TICKET_KEY) ?? [])],
        wikiPages: [],
        isDone: /\berledigt\b/iu.test(message),
      },
    ]);
  }

  /** The first words of every message, in order. */
  public summarize(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["summarize"]>[1],
  ): Promise<string | null> {
    const lines = input.messages.map(
      (message) => `${message.from}: ${cut(message.text, 60)}`,
    );
    return Promise.resolve(
      cut(
        [
          input.previous ?? `Chat mit ${caller.agent.displayName}`,
          ...lines,
        ].join(" · "),
        4_000,
      ) || null,
    );
  }

  /**
   * A lesson per message of a person and per plan run, the newest first, a
   * topic per decision of the Lagebuch and a knowledge recipe for the call the
   * agent repeats most.
   */
  public dream(
    caller: AgentMemoryCaller,
    input: AgentDreamInput,
  ): Promise<AgentDreamAnswer | null> {
    const lessons = [...input.sources]
      .reverse()
      .filter(
        (source) =>
          (source.kind === "chat" && !source.origin.startsWith("→")) ||
          source.kind === "plan",
      )
      .slice(0, DREAM_LESSONS)
      .map((source) => ({
        text:
          source.kind === "plan"
            ? `Planläufe in ${source.origin} prüfen: ${cut(source.text, 80)}`
            : `${source.origin} wünscht: ${cut(source.text, 80)}`,
        evidence: `${source.kind === "plan" ? "Planlauf" : `Chat von ${caller.agent.displayName}`} ${source.at}`,
        date: input.today,
      }));
    return Promise.resolve({
      topics: this.dreamTopics(input),
      discarded: [],
      lessons,
      recipes: this.dreamRecipes(input),
      dropRecipes: [],
    });
  }

  /** An entry per message that names a ticket or a decision, the newest first. */
  public logbook(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["logbook"]>[1],
  ): Promise<readonly AgentLogbookDraft[] | null> {
    const entries = [...input.messages]
      .reverse()
      .filter((message) => message.from !== caller.agent.displayName)
      .filter((message) =>
        /\b(?:[A-Z][A-Z0-9]*-\d+|beschlossen|entschieden|bis)\b/u.test(
          message.text,
        ),
      )
      .slice(0, LOGBOOK_ENTRIES)
      .map((message) => ({
        kind: /\b(?:beschlossen|entschieden)\b/u.test(message.text)
          ? ("decision" as const)
          : ("open" as const),
        text: `${message.from}: ${cut(message.text, 200)}`,
      }));
    return Promise.resolve(entries);
  }

  /** A topic per decision of the Lagebuch, resting on that entry. */
  private dreamTopics(input: AgentDreamInput): AgentDreamAnswer["topics"] {
    return input.logbook
      .map((entry, index) => ({ entry, number: index + 1 }))
      .filter(({ entry }) => entry.kind === "Entscheidung")
      .slice(0, DREAM_TOPICS)
      .map(({ entry, number }) => ({
        title: cut(entry.text, 60),
        about: cut(entry.text, 300),
        status: `Festgehalten im Lagebuch (${entry.chat})`,
        nextStep: "",
        tickets: [...new Set(entry.text.match(TICKET_KEY) ?? [])],
        wikiPages: [],
        isDone: false,
        entries: [number],
      }));
  }

  /** A knowledge recipe for the call the agent made again and again. */
  private dreamRecipes(input: AgentDreamInput): AgentDreamAnswer["recipes"] {
    const call = input.toolUse.repeated[0];
    if (!call) return [];
    return [
      {
        name: `${call.tool}-wiederholt`,
        kind: "knowledge",
        summary: `Fester Wert für ${call.tool}`,
        keywords: [call.tool],
        body: `${call.tool} wurde ${String(call.calls)}× mit ${call.input} aufgerufen; Ergebnis: ${call.output}`,
        evidence: `Werkzeugaufrufe bis ${input.today}`,
      },
    ];
  }
}
