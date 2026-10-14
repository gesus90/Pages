import { expect, it, vi } from "vitest";

import {
  readAgentConfiguration,
  readAgentParameterValue,
} from "@/backend/agents/AgentConfigurationInput";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { CRITERIA, TICKET, TICKET_ACTOR } from "./page55-ticket-fixture";

import type {
  AgentParameterValue,
  AgentParameter,
} from "@/definition/AgentParameters";

it.each([-1, 121, 0.5, Infinity, "0", null])(
  "refuses invalid timeout %s",
  (timeoutMinutes) => {
    expect(() =>
      readAgentConfiguration({
        ...emptyAgentConfiguration(),
        run: {
          access: "workspace_write",
          shell: false,
          web: false,
          timeoutMinutes,
        },
      }),
    ).toThrow(new AgentError("configuration_invalid"));
  },
);

it.each([0, 1, 120])("retains valid timeout %s", (timeoutMinutes) => {
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    run: {
      access: "workspace_write",
      shell: false,
      web: false,
      timeoutMinutes,
    },
  });
  expect(configuration.run?.timeoutMinutes).toBe(timeoutMinutes);
});

it("retains typed numeric and ticket values in plan parameter nodes", () => {
  const plan = readPlanInput({
    name: "Synthetic plan",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes: [
      {
        id: "number",
        type: "parameter",
        name: "amount",
        x: 0,
        y: 0,
        format: "number",
        value: { type: "number", number: -12.5 },
      },
      {
        id: "ticket",
        type: "parameter",
        name: "ticketID",
        x: 0,
        y: 0,
        format: "string",
        value: { type: "ticket", ticketId: "ticket-id" },
      },
    ],
    edges: [],
  });
  expect(plan.nodes[0]).toMatchObject({
    value: { type: "number", number: -12.5 },
  });
  expect(plan.nodes[1]).toMatchObject({
    value: { type: "ticket", ticketId: "ticket-id" },
  });
});

function parameter(
  name: string,
  defaultValue: AgentParameterValue | null,
  type: AgentParameter["type"] = "text",
): AgentParameter {
  return {
    name,
    type: defaultValue?.type ?? type,
    description: "",
    isRequired: true,
    defaultValue,
  };
}

function ticketService(): AgentTicketParameterService {
  return new AgentTicketParameterService(async () => ({
    actor: TICKET_ACTOR,
    tasks: {
      findAll: async () => [TICKET],
      getById: async () => TICKET,
      findChecklistItems: async () => [...CRITERIA],
    },
  }));
}

it("inserts complete ticket text, strings and numbers at every original position without recursively changing ticket content", async () => {
  const ticket = await ticketService().resolve("owner", TICKET.id);
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    markdown:
      "INTRO\n{{name}}={{count}}\n{{ticketID}}\nMIDDLE\n{{ticketID}}\n{{name}}={{count}}\nEND",
    parameters: [
      parameter("name", { type: "text", text: "Agent $&" }),
      parameter("count", { type: "number", number: 0 }),
      parameter("ticketID", { type: "ticket", ticketId: TICKET.id }),
    ],
  });
  const bound = await bindAgentParameters(
    configuration,
    {},
    { workspace: vi.fn(), wiki: vi.fn(), ticket: async () => ticket },
  );
  expect(bound.markdown).toBe(
    `INTRO\nAgent $&=0\n${ticket.markdown}\nMIDDLE\n${ticket.markdown}\nAgent $&=0\nEND`,
  );
  expect(ticket.markdown).toContain(TICKET.description);
  expect(ticket.markdown).toContain("- [ ] Criterion is included in full");
  expect(bound.markdown.match(/Literal \{\{inside_ticket\}\}/g)).toHaveLength(
    2,
  );
});

it.each([NaN, Infinity, -Infinity, null, "12", "", "not a number"])(
  "rejects invalid numeric input %s instead of coercing it",
  (number) => {
    expect(() => readAgentParameterValue({ type: "number", number })).toThrow(
      new AgentError("parameter_number_invalid"),
    );
  },
);

it.each([null, { type: "text", text: "   " }] as const)(
  "refuses missing values even for optional parameters whose placeholders are used",
  async (defaultValue) => {
    const declaration = {
      ...parameter("name", defaultValue),
      isRequired: false,
    };
    await expect(
      bindAgentParameters(
        {
          ...emptyAgentConfiguration(),
          markdown: "{{name}}",
          parameters: [declaration],
        },
        {},
        { workspace: vi.fn(), wiki: vi.fn() },
      ),
    ).rejects.toThrow(new AgentError("parameter_required"));
  },
);

it.each(["{{missing}}", "{{name.invalid}}", "{{name", "{{count.path}}"])(
  "refuses unresolved or invalid placeholders %s",
  async (markdown) => {
    await expect(
      bindAgentParameters(
        {
          ...emptyAgentConfiguration(),
          markdown,
          parameters: [
            parameter("name", { type: "text", text: "Name" }),
            parameter("count", { type: "number", number: 1 }),
          ],
        },
        {},
        { workspace: vi.fn(), wiki: vi.fn() },
      ),
    ).rejects.toThrow(new AgentError("parameter_invalid"));
  },
);

it("lists only the ticket projection the existing authorized service returns", async () => {
  expect(await ticketService().choices("owner")).toEqual([
    { id: TICKET.id, key: TICKET.key, title: TICKET.title },
  ]);
});

it("refuses inaccessible, archived and inactive ticket references without disclosing their content", async () => {
  for (const situation of ["hidden", "archived", "inactive"]) {
    const service = new AgentTicketParameterService(async () => ({
      actor: { ...TICKET_ACTOR, isActive: situation !== "inactive" },
      tasks: {
        findAll: vi.fn(),
        findChecklistItems: vi.fn(),
        getById: async () => {
          if (situation === "hidden") throw new Error("Hidden private content");
          return {
            ...TICKET,
            archivedAt: situation === "archived" ? "2026-01-03" : null,
          };
        },
      },
    }));
    await expect(service.resolve("owner", "ticket-id")).rejects.toThrow(
      new AgentError("parameter_ticket_unavailable"),
    );
  }
});
