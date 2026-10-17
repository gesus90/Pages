import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { MAX_TICKET_ASSET_BYTES } from "./AgentTicketAssetService";

import type { AgentTicketChoice } from "@/definition/AgentParameters";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentTicketAssetService } from "./AgentTicketAssetService";
import type {
  ResolvedAgentTicket,
  AgentTicketInput,
  AgentTicketAssetContent,
  AgentTicketAsset,
} from "@/definition/AgentTicketParameter";

interface TicketParameterContext {
  readonly actor: AgentTaskContext["actor"];
  readonly tasks: Pick<
    AgentTaskContext["tasks"],
    "findAll" | "getById" | "findChecklistItems"
  >;
}

/** Complete ticket input, including description task lists and separately stored acceptance criteria. */
export type AgentTicketParameterText = ResolvedAgentTicket;

/** Resolves ticket references through the existing ticket service and the executor's live rights. */
export class AgentTicketParameterService {
  private readonly context: (userId: string) => Promise<TicketParameterContext>;
  private readonly assets: Pick<AgentTicketAssetService, "references" | "read">;

  public constructor(
    context: (userId: string) => Promise<TicketParameterContext>,
    assets: Pick<AgentTicketAssetService, "references" | "read">,
  ) {
    this.context = context;
    this.assets = assets;
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
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        assets: await this.assets.references(
          actor,
          ticket.id,
          ticket.description,
        ),
        markdown: `# ${ticket.key}: ${ticket.title}\n\n${ticket.description}${acceptance ? `\n\n## Acceptance criteria\n\n${acceptance}` : ""}`,
        version: JSON.stringify([ticket.updatedAt, criteria]),
      };
    } catch (error: unknown) {
      logCaughtError("AgentTicketParameterService", error);

      if (error instanceof AgentError) throw error;
      throw new AgentError("parameter_ticket_unavailable");
    }
  }

  /** Rechecks the ticket, its references and the executing user's file rights for every transmission. */
  public async readAssets(
    userId: string,
    inputs: readonly AgentTicketInput[],
  ): Promise<readonly AgentTicketAssetContent[]> {
    const contents: AgentTicketAssetContent[] = [];
    let size = 0;
    for (const input of inputs) {
      const ticket = await this.resolve(userId, input.ticket.id);
      // Status, checkbox and text revisions do not change the file handoff.
      // Keep the asset identity check and every live ticket/file authorization.
      if (JSON.stringify(ticket.assets) !== JSON.stringify(input.ticket.assets))
        throw new AgentError("parameter_ticket_changed");
      for (const asset of ticket.assets) {
        const { actor } = await this.context(userId);
        if (!actor.isActive)
          throw new AgentError("parameter_asset_unavailable");
        const file = await this.assets.read(actor, asset);
        size += file.size;
        if (size > MAX_TICKET_ASSET_BYTES)
          throw new AgentError("parameter_assets_too_large");
        contents.push({
          parameter: input.parameter,
          ticketId: ticket.id,
          ticketKey: ticket.key,
          asset,
          fileName: file.fileName,
          content: file.content,
        });
      }
    }
    return contents;
  }

  /** Historical results retain the original file references even after a description removes its links. */
  public async requireAssets(
    userId: string,
    assets: readonly AgentTicketAsset[],
  ): Promise<void> {
    for (const asset of assets) {
      const { actor } = await this.context(userId);
      if (!actor.isActive) throw new AgentError("parameter_asset_unavailable");
      await this.assets.read(actor, asset);
    }
  }
}
