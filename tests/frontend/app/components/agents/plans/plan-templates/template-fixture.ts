import { vi } from "vitest";

import type { Mock } from "vitest";
import type { AgentPlanParameter } from "@/definition/AgentPlan";
import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

/** A text parameter as a template keeps it, at the grid origin. */
export function parameterNode(
  overrides: Partial<AgentPlanParameter> = {},
): AgentPlanParameter {
  return {
    id: "parameter",
    type: "parameter",
    name: "topic",
    format: "string",
    value: { type: "text", text: "Hello" },
    x: 0,
    y: 0,
    ...overrides,
  };
}

/** A saved personal template of the given node. */
export function savedTemplate(
  node: AgentPlanTemplateNode = parameterNode(),
  overrides: Partial<AgentPlanNodeTemplate> = {},
): AgentPlanNodeTemplate {
  return {
    id: "template",
    name: "Topic",
    type: node.type,
    isShared: false,
    createdAt: "2026-10-28 00:00:00",
    node,
    ...overrides,
  };
}

/** A JSON answer of the template route. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Replaces `fetch` with a spy that answers each call in turn. */
export function stubFetch(
  ...answers: readonly (Response | Error)[]
): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>();
  for (const answer of answers)
    if (answer instanceof Error) fetchMock.mockRejectedValueOnce(answer);
    else fetchMock.mockResolvedValueOnce(answer);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The form fields a template request posted. */
export function postedFields(
  fetchMock: Mock<typeof fetch>,
  call = 0,
): Record<string, unknown> {
  const body = fetchMock.mock.calls[call]?.[1]?.body;
  if (!(body instanceof FormData)) throw new Error("Expected a form body");
  return Object.fromEntries(body.entries());
}
