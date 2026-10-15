import { Readable } from "node:stream";

import { vi } from "vitest";

import { AgentTicketAssetService } from "@/backend/service/agents/AgentTicketAssetService";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";

import { TICKET, TICKET_ACTOR } from "./page55-ticket-fixture";

import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { User } from "@/definition/User";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { Mock } from "vitest";
import type { WorkItemDetail } from "@/definition/Task";

/** A real one-pixel PNG; tests compare complete bytes, never just its name. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG2kAAAAASUVORK5CYII=",
  "base64",
);
/** Long UTF-8 content, including a literal template token and a trailing newline. */
export const TEXT = "Grüße {{ticket.assets}}\n".repeat(4000);

interface TicketAssetWorld {
  readonly assets: AgentTicketAssetService;
  readonly service: AgentTicketParameterService;
  readonly context: Mock<
    ConstructorParameters<typeof AgentTicketParameterService>[0]
  >;
  readonly dependencies: AgentTicketAssetDependencies;
  readonly open: Mock<AgentTicketAssetDependencies["tickets"]["open"]>;
  readonly getById: Mock<(actor: User, id: string) => Promise<WorkItemDetail>>;
  readonly files: Map<string, Buffer>;
  readonly tickets: Map<string, WorkItemDetail>;
  readonly denied: Set<string>;
}

/** File stores and authorization are synthetic boundaries; the services are real. */
export function ticketAssetWorld(
  description = "Full description\n![image](/aufgaben/attachments/png)\n[text][source]\n\n[source]: /wiki/attachments/text",
): TicketAssetWorld {
  const files = new Map([
    ["png", PNG],
    ["text", Buffer.from(TEXT)],
  ]);
  const denied = new Set<string>();
  const tickets = new Map<string, WorkItemDetail>([
    [TICKET.id, { ...TICKET, description }],
  ]);
  const getById = vi.fn(async (actor: User, id: string) => {
    if (!actor.isActive) throw new Error("Inactive account");
    const ticket = tickets.get(id);
    if (!ticket || denied.has(id)) throw new Error("Private ticket");
    return ticket;
  });
  const open = vi.fn<AgentTicketAssetDependencies["tickets"]["open"]>(
    async (actor: User, id: string) => {
      if (!actor.isActive) throw new Error("Inactive account");
      const bytes = files.get(id);
      if (!bytes || denied.has(id)) throw new Error("Private file");
      return {
        attachment: {
          fileName: id === "png" ? "diagram.png" : "notes.txt",
          size: bytes.length,
        },
        stream: Readable.from([bytes]),
      };
    },
  );
  const dependencies: AgentTicketAssetDependencies = {
    tickets: { list: vi.fn(async () => [{ id: "png" }]), open },
    wiki: { openAttachment: open },
    assets: {
      open: async (actor, id) => {
        const opened = await open(actor, id);
        return { ...opened.attachment, stream: opened.stream };
      },
    },
  };
  const assets = new AgentTicketAssetService(dependencies);
  const context: TicketAssetWorld["context"] = vi.fn(
    async (userId: string) => ({
      actor: { ...TICKET_ACTOR, isActive: userId !== "inactive" },
      tasks: {
        getById,
        findAll: async () => [...tickets.values()],
        findChecklistItems: async () => [],
      },
    }),
  );
  const service = new AgentTicketParameterService(context, assets);
  return {
    assets,
    service,
    context,
    dependencies,
    open,
    getById,
    files,
    tickets,
    denied,
  };
}

/** A declaration remains a single ticket parameter, regardless of which fields are used. */
export function ticketDeclaration(
  name: string,
  ticketId = TICKET.id,
): AgentParameter {
  return {
    name,
    type: "ticket",
    description: "",
    isRequired: true,
    defaultValue: { type: "ticket", ticketId },
  };
}
