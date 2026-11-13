import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";
import { McpTicketLifecycleService } from "@/backend/service/mcp/ticket/McpTicketLifecycleService";

import { PICA_WRITE_SCHEMAS } from "./PicaToolSchemas";

import type { McpTicketDependencies } from "@/backend/service/mcp/ticket/McpTicketContext";

/** Adapts Pica's ticket lifecycle calls to the same service and actor rules as the ticket API. */
export class PicaTicketLifecycleService {
  private readonly services: McpTicketDependencies;
  private readonly lifecycle = new McpTicketLifecycleService();

  /** Captures the shared ticket services; every call resolves the acting account anew. */
  public constructor(services: McpTicketDependencies) {
    this.services = services;
  }

  /**
   * Runs a Pica archive or restore, or returns null for another operation.
   *
   * @param userId - The verified acting account, supplied by the executor.
   * @param operation - The internal chat operation.
   * @param parameters - The native arguments, with an optional server-owned operation ID.
   * @returns The unchanged lifecycle result; an archive without confirmation changes nothing.
   * @throws {AgentOperationError} For malformed input or an unavailable acting account.
   * @throws {McpTicketError} For a refused lifecycle operation; the executor preserves its code.
   */
  public async handle(
    userId: string,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly result: unknown } | null> {
    if (operation !== "ticket.archive" && operation !== "ticket.restore")
      return null;
    const input = Object.fromEntries(
      Object.entries(parameters).filter(([key]) => key !== "operationId"),
    );
    if (operation === "ticket.restore") {
      const parsed = PICA_WRITE_SCHEMAS.tickets_restore.safeParse(input);
      if (!parsed.success) throw new AgentOperationError("INVALID_REQUEST");
      return {
        result: await this.lifecycle.restore(
          await this.context(userId),
          parsed.data.ticketId,
        ),
      };
    }
    const parsed = PICA_WRITE_SCHEMAS.tickets_archive.safeParse(input);
    if (!parsed.success) throw new AgentOperationError("INVALID_REQUEST");
    return {
      result: await this.lifecycle.archive(
        await this.context(userId),
        parsed.data.ticketId,
        {
          children: parsed.data.children,
          ...(parsed.data.confirmed === true ? { confirmed: true } : {}),
        },
      ),
    };
  }

  private async context(userId: string): Promise<McpTicketContext> {
    const actor = await this.services.users.getById(userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new AgentOperationError("FORBIDDEN");
    return new McpTicketContext(actor, this.services);
  }
}
