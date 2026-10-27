import { expect, it, vi } from "vitest";

import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import { readPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { createTextProviderRequest } from "@/backend/agents/providers/TextProviderPayload";
import { readTicketAssetInput } from "@/backend/agents/TicketAssetInput";
import { AGENT_ERROR_MESSAGES, AgentError } from "@/backend/error/AgentErrors";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { planBindings } from "@/backend/service/agents/AgentPlanBindings";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { parameterRunFixture } from "./page55-run-fixture";
import { TICKET } from "./page55-ticket-fixture";
import {
  PNG,
  TEXT,
  ticketAssetWorld,
  ticketDeclaration,
} from "./page60-ticket-assets-fixture";

import type { ApiProviderId } from "@/definition/AgentConnection";

const PROVIDERS: readonly ApiProviderId[] = [
  "openai",
  "openrouter",
  "anthropic",
  "google_ai_studio",
];

it.each(PROVIDERS)(
  "delivers native PNG blocks and full text for %s, keeping binary contents out of the instruction",
  async (provider) => {
    const world = ticketAssetWorld();
    const fixture = await parameterRunFixture(
      {
        ...emptyAgentConfiguration(),
        markdown: "{{ticket.description}}\n{{ticket.assets}}",
        parameters: [ticketDeclaration("ticket")],
      },
      provider,
      world.service,
    );
    const prepared = await fixture.start.prepare(
      fixture.run,
      fixture.snapshot,
      fixture.step,
    );
    const contents = await readTicketAssetInput(prepared.input);
    const request = createTextProviderRequest(
      provider,
      prepared.input,
      contents,
    );
    expect(JSON.stringify(request.body)).toContain(PNG.toString("base64"));
    expect(JSON.stringify(request.body)).toContain(
      JSON.stringify(TEXT).slice(1, -1),
    );
    expect(prepared.input.prompt).not.toContain(PNG.toString("base64"));
    expect(prepared.input.prompt).not.toContain(TEXT);
    expect(prepared.input.ticketInputs?.[0].ticket.id).toBe(TICKET.id);
    if (provider === "openai") {
      const search = createTextProviderRequest(
        provider,
        { ...prepared.input, webSearch: true },
        contents,
      );
      expect(JSON.stringify(search.body.input)).toContain(
        JSON.stringify({
          type: "input_image",
          image_url: `data:image/png;base64,${PNG.toString("base64")}`,
        }),
      );
    }
  },
);

it("reauthorizes before the API request and preserves safe asset errors without making a network request", async () => {
  const world = ticketAssetWorld();
  const fixture = await parameterRunFixture(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket}}",
      parameters: [ticketDeclaration("ticket")],
    },
    "openai",
    world.service,
  );
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  const cipher = new InstanceSecretCipher(Buffer.alloc(32, 1));
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: "Read both files" } },
          ],
        }),
      ),
  );
  const execution = new ApiTextExecution(
    {
      find: async () => prepared.input.agent.connection,
      findSecretEncrypted: async () =>
        cipher.encrypt("connection", "synthetic-key"),
    },
    cipher,
    request,
  );
  expect(
    await execution.run(prepared.input, new AbortController().signal),
  ).toBe("Read both files");
  expect(String(request.mock.calls[0]?.[1]?.body)).toContain(
    PNG.toString("base64"),
  );
  world.denied.add("text");
  await expect(
    execution.run(prepared.input, new AbortController().signal),
  ).rejects.toThrow(AGENT_ERROR_MESSAGES.parameter_asset_unavailable);
  expect(request).toHaveBeenCalledTimes(1);
});

it("keeps typed plan sources and two parameter associations through later agent starts", async () => {
  const world = ticketAssetWorld();
  world.tickets.set("second", {
    ...TICKET,
    id: "second",
    key: "SYN-2",
    description: "Second ticket",
  });
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown: "{{ticket}}\n{{referenz}}",
    parameters: [
      ticketDeclaration("ticket"),
      ticketDeclaration("referenz", "second"),
    ],
  };
  const fixture = await parameterRunFixture(
    configuration,
    "openai",
    world.service,
  );
  const plan = {
    ...fixture.snapshot.plan,
    nodes: [
      ...fixture.snapshot.plan.nodes,
      {
        id: "source",
        type: "parameter" as const,
        name: "ticket",
        x: 0,
        y: 0,
        format: "string" as const,
        value: { type: "ticket" as const, ticketId: TICKET.id },
      },
    ],
  };
  const bindings = planBindings(
    plan,
    {
      ...fixture.step.step,
      bindings: { ticket: { kind: "source", nodeId: "source" } },
    },
    [],
    configuration.parameters,
  );
  expect(bindings.ticket).toEqual({ type: "ticket", ticketId: TICKET.id });
  const first = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  const firstContents = await readTicketAssetInput(first.input);
  const next = await fixture.start.prepare(fixture.run, fixture.snapshot, {
    ...fixture.step,
    step: { ...fixture.step.step, id: "next-agent" },
  });
  expect(await readTicketAssetInput(next.input)).toEqual(firstContents);
  expect(
    firstContents.map((entry) => [entry.parameter, entry.ticketId]),
  ).toEqual([
    ["ticket", TICKET.id],
    ["ticket", TICKET.id],
    ["referenz", "second"],
  ]);
  world.denied.add(TICKET.id);
  await expect(readTicketAssetInput(next.input)).rejects.toThrow(
    new AgentError("parameter_ticket_unavailable"),
  );
});

it("explicitly rejects reference forwarding when the receiving execution has no live asset reader", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("owner", TICKET.id);
  await expect(
    readTicketAssetInput({ ticketInputs: [{ parameter: "ticket", ticket }] }),
  ).rejects.toThrow(new AgentError("parameter_asset_transfer_unsupported"));
});

it("retains original asset references in historical run authorization", async () => {
  const world = ticketAssetWorld();
  const fixture = await parameterRunFixture(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket}}",
      parameters: [ticketDeclaration("ticket")],
    },
    "openai",
    world.service,
  );
  expect(readPlanRunResources(fixture.snapshot).ticketAssets).toEqual(
    fixture.step.prepared.parameters.tickets.ticket.assets,
  );
});

it("reports text-result-to-ticket handoffs explicitly", async () => {
  const world = ticketAssetWorld();
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown: "{{ticket}}",
    parameters: [ticketDeclaration("ticket")],
  };
  const fixture = await parameterRunFixture(
    configuration,
    "openai",
    world.service,
  );
  const step = {
    ...fixture.step.step,
    bindings: { ticket: { kind: "result" as const, stepId: "previous" } },
  };
  const plan = {
    ...fixture.snapshot.plan,
    nodes: [step, { ...fixture.step.step, id: "previous" }],
  };
  const issues = planConnectionIssues(plan, [
    {
      id: "agent",
      name: "Agent",
      purposes: ["agent"],
      revision: 1,
      availability: { isUsable: true, reason: null, personalChoices: [] },
      provider: "openai",
      model: "model",
      reasoningEffort: null,
      configuration,
    },
  ]);
  expect(issues).toContainEqual({
    nodeId: "step",
    port: "ticket",
    reason: "ticketHandoff",
  });
});

it("rejects result text derived from assets unless the next agent also receives the structured ticket", async () => {
  const world = ticketAssetWorld();
  const source = await parameterRunFixture(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket}}",
      parameters: [ticketDeclaration("ticket")],
    },
    "openai",
    world.service,
  );
  const target = await parameterRunFixture(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{result}}",
      parameters: [
        {
          name: "result",
          type: "text",
          description: "",
          isRequired: true,
          defaultValue: { type: "text", text: "pending" },
        },
      ],
    },
    "openai",
    world.service,
  );
  const previous = {
    ...source.step,
    step: { ...source.step.step, id: "previous" },
  };
  const step = {
    ...target.step,
    step: {
      ...target.step.step,
      bindings: { result: { kind: "result" as const, stepId: "previous" } },
    },
  };
  const snapshot = { ...target.snapshot, steps: [previous, step] };
  const run = {
    ...target.run,
    steps: [
      {
        id: "previous",
        name: "Previous",
        status: "succeeded" as const,
        isBlocked: false,
        cancellation: "none" as const,
        output: "Text from a private attachment",
        error: null,
      },
    ],
  };
  await expect(target.start.prepare(run, snapshot, step)).rejects.toThrow(
    new AgentError("parameter_asset_transfer_unsupported"),
  );
});

it("refuses newly added asset references after a plan was prepared", async () => {
  const world = ticketAssetWorld("Description");
  const fixture = await parameterRunFixture(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket}}",
      parameters: [ticketDeclaration("ticket")],
    },
    "openai",
    world.service,
  );
  world.tickets.set(TICKET.id, {
    ...TICKET,
    description: "[new file](/wiki/attachments/text)",
  });
  await expect(
    fixture.start.prepare(fixture.run, fixture.snapshot, fixture.step),
  ).rejects.toThrow(new AgentError("parameter_ticket_changed"));
});
