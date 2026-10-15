import { expect, it, vi } from "vitest";

import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { agentParameterIssues } from "@/definition/AgentParameters";

import { TICKET } from "./page55-ticket-fixture";
import {
  ticketAssetWorld,
  ticketDeclaration,
} from "./page60-ticket-assets-fixture";

it("resolves full descriptions and separately associated assets for arbitrary and multiple parameter names", async () => {
  const world = ticketAssetWorld("  Full {{literal}} description\n");
  world.tickets.set("second", {
    ...TICKET,
    id: "second",
    key: "SYN-2",
    description: "Second description",
  });
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown:
      "{{ticket.description}}\n{{referenz.description}}\n{{ticket.assets}}\n{{referenz.assets}}",
    parameters: [
      ticketDeclaration("ticket"),
      ticketDeclaration("referenz", "second"),
    ],
  };
  const bound = await bindAgentParameters(
    configuration,
    {},
    {
      ticket: (id) => world.service.resolve("executor", id),
      workspace: vi.fn(),
      wiki: vi.fn(),
    },
  );
  expect(bound.tickets.ticket).toMatchObject({
    id: TICKET.id,
    key: TICKET.key,
    description: "  Full {{literal}} description\n",
    assets: [{ id: "png" }],
  });
  expect(bound.markdown).toContain(
    "  Full {{literal}} description\n\nSecond description",
  );
  expect(
    bound.assetInputs.map((entry) => [entry.parameter, entry.ticket.id]),
  ).toEqual([
    ["ticket", TICKET.id],
    ["referenz", "second"],
  ]);
  expect(bound.markdown).toContain(
    '"parameter":"referenz","ticketId":"second"',
  );
  expect(bound.markdown).not.toContain("iVBOR");
});

it("keeps bare placeholders compatible and sends repeated assets only once per parameter", async () => {
  const world = ticketAssetWorld();
  const bound = await bindAgentParameters(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket}}\n{{ticket.assets}}\n{{ticket}}",
      parameters: [ticketDeclaration("ticket")],
    },
    {},
    {
      ticket: (id) => world.service.resolve("executor", id),
      workspace: vi.fn(),
      wiki: vi.fn(),
    },
  );
  expect(bound.markdown).toContain(`# ${TICKET.key}: ${TICKET.title}`);
  expect(bound.markdown).toContain(
    world.tickets.get(TICKET.id)?.description ?? "",
  );
  expect(bound.assetInputs).toHaveLength(1);
  expect(bound.assetInputs[0].ticket.assets).toHaveLength(2);
});

it("delivers description and an empty list when a ticket has no assets", async () => {
  const world = ticketAssetWorld("Complete description\n");
  vi.mocked(world.dependencies.tickets.list).mockResolvedValue([]);
  const bound = await bindAgentParameters(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket}} {{ticket.assets}}",
      parameters: [ticketDeclaration("ticket")],
    },
    {},
    {
      ticket: (id) => world.service.resolve("executor", id),
      workspace: vi.fn(),
      wiki: vi.fn(),
    },
  );
  expect(bound.tickets.ticket.assets).toEqual([]);
  expect(bound.markdown).toContain("Complete description\n");
  expect(await world.service.readAssets("executor", bound.assetInputs)).toEqual(
    [],
  );
});

it("a description-only placeholder selects no file delivery and fields are restricted to ticket parameters", async () => {
  const world = ticketAssetWorld();
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown: "{{referenz.description}}",
    parameters: [ticketDeclaration("referenz")],
  };
  const bound = await bindAgentParameters(
    configuration,
    {},
    {
      ticket: (id) => world.service.resolve("executor", id),
      workspace: vi.fn(),
      wiki: vi.fn(),
    },
  );
  expect(bound.markdown).toBe(world.tickets.get(TICKET.id)?.description);
  expect(bound.assetInputs).toEqual([]);
  expect(
    agentParameterIssues({
      ...configuration,
      parameters: [
        { ...ticketDeclaration("referenz"), type: "text", defaultValue: null },
      ],
    }),
  ).toContain("typeMismatch");
});
