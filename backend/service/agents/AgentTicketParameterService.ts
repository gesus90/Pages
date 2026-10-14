import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentTicketChoice } from "@/definition/AgentParameters";
import type { AgentTaskContext } from "./AgentTaskAccess";

interface TicketParameterContext {
  readonly actor: AgentTaskContext["actor"];
  readonly tasks: Pick<
    AgentTaskContext["tasks"],
    "findAll" | "getById" | "findChecklistItems"
  >;
}

/** Complete ticket input, including description task lists and separately stored acceptance criteria. */
export interface AgentTicketParameterText {
  readonly markdown: string;
  readonly version: string;
}

/** Resolves ticket references through the existing ticket service and the executor's live rights. */
export class AgentTicketParameterService {
  private readonly context: (userId: string) => Promise<TicketParameterContext>;

  public constructor(
    context: (userId: string) => Promise<TicketParameterContext>,
  ) {
    this.context = context;
  }

  /** Lists active tickets the authenticated person may currently read. */
  public async choices(userId: string): Promise<readonly AgentTicketChoice[]> {
    const { actor, tasks } = await this.context(userId);
    if (!actor.isActive) throw new AgentError("agent_usage_denied");
    return (await tasks.findAll(actor, { archived: "active" })).map(
      (ticket) => ({
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
      }),
    );
  }

  /** Resolves the entire ticket without trimming its description or silently substituting another ticket. */
  public async resolve(
    userId: string,
    ticketId: string,
  ): Promise<AgentTicketParameterText> {
    try {
      const { actor, tasks } = await this.context(userId);
      if (!actor.isActive) throw new AgentError("parameter_ticket_unavailable");
      const ticket = await tasks.getById(actor, ticketId);
      if (ticket.archivedAt !== null)
        throw new AgentError("parameter_ticket_unavailable");
      const criteria = await tasks.findChecklistItems(actor, ticket.id);
      const acceptance = criteria
        .map((item) => `- [${item.isDone ? "x" : " "}] ${item.title}`)
        .join("\n");
      return {
        markdown: `# ${ticket.key}: ${ticket.title}\n\n${ticket.description}${acceptance ? `\n\n## Acceptance criteria\n\n${acceptance}` : ""}`,
        version: JSON.stringify([ticket.updatedAt, criteria]),
      };
    } catch {
      throw new AgentError("parameter_ticket_unavailable");
    }
  }
}
