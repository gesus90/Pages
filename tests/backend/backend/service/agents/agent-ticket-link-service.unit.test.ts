import { beforeEach, expect, it, vi } from "vitest";

import { AgentTicketLinkService } from "@/backend/service/agents/AgentTicketLinkService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTicketLinkDependencies } from "@/backend/service/agents/AgentTicketLinkService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

const getById = vi.fn();
const findLinks = vi.fn();
const addLink = vi.fn();
const removeLink = vi.fn();
const announce = vi.fn();
const context = partial<AgentTaskContext>({
  actor: { id: "user" },
  tasks: { getById, findLinks, addLink, removeLink },
});
const service = new AgentTicketLinkService(
  partial<AgentTicketLinkDependencies>({
    transaction: {
      run: async (request: {
        work: (value: AgentTaskContext) => Promise<unknown>;
      }) => request.work(context),
    },
    announcer: { announce },
  }),
);
const identity = partial<AgentIdentity>({ userId: "user" });
const ticket = { id: "one", key: "P-1", archivedAt: null };
const target = { id: "two", key: "P-2", archivedAt: null };
const link = {
  id: "link",
  linkType: "relates_to",
  direction: "outgoing",
  linkedWorkItemId: "two",
  linkedWorkItemKey: "P-2",
};
const input = {
  operationId: "op",
  ticketId: "one",
  targetTicketId: "two",
  linkType: "relates_to",
};

beforeEach(() => {
  vi.resetAllMocks();
  getById.mockImplementation(async (actor, id: string) => {
    expect(actor).toEqual({ id: "user" });
    return id === "one" ? ticket : target;
  });
  findLinks.mockResolvedValue([]);
  addLink.mockResolvedValue([link]);
});

it("adds a visible typed link and announces the result", async () => {
  expect(
    (await service.apply(identity, "tickets.link.add", input)).result,
  ).toMatchObject({
    linkId: "link",
    ticketId: "one",
    linkedTicketId: "two",
    removed: false,
  });
  expect(addLink).toHaveBeenCalledWith(
    context.actor,
    "one",
    "P-2",
    "relates_to",
  );
  expect(announce).toHaveBeenCalledOnce();
});

it("rejects duplicate, self and archived links", async () => {
  findLinks.mockResolvedValueOnce([{ ...link, direction: "incoming" }]);
  await expect(
    service.apply(identity, "tickets.link.add", input),
  ).rejects.toThrow();
  await expect(
    service.apply(identity, "tickets.link.add", {
      ...input,
      targetTicketId: "one",
    }),
  ).rejects.toThrow();
  getById
    .mockImplementationOnce(async () => ({ ...ticket, archivedAt: "now" }))
    .mockResolvedValueOnce(target);
  await expect(
    service.apply(identity, "tickets.link.add", input),
  ).rejects.toThrow();
  expect(addLink).not.toHaveBeenCalled();
});

it("removes only a link visible on the ticket", async () => {
  findLinks.mockResolvedValueOnce([link]);
  expect(
    (
      await service.apply(identity, "tickets.link.remove", {
        operationId: "op",
        ticketId: "one",
        linkId: "link",
      })
    ).result,
  ).toMatchObject({ removed: true });
  expect(removeLink).toHaveBeenCalledWith(context.actor, "one", "link");
  await expect(
    service.apply(identity, "tickets.link.remove", {
      operationId: "op",
      ticketId: "one",
      linkId: "missing",
    }),
  ).rejects.toThrow();
});
