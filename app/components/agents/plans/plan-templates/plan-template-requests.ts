import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { readPlanTemplate } from "@/backend/agents/AgentPlanTemplateInput";
import { isPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

const TEMPLATES_URL = "/agent-api/plan-templates";

/** The edited plan a request names; the server checks both again. */
export interface PlanTemplateTarget {
  /** The saved plan, or an empty text for a plan that was never saved. */
  readonly planId: string;
  readonly workspaceId: string;
}

/** The answer of a template request: its value, or a stable error code. */
export type PlanTemplateResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };

/** The stable error code of a refused request, or `general` without one. */
async function failure(response: Response): Promise<{
  readonly ok: false;
  readonly error: string;
}> {
  try {
    const body: unknown = await response.json();
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : null;
    return { ok: false, error: typeof error === "string" ? error : "general" };
  } catch (error: unknown) {
    console.warn("Pages could not read a template error.", error);
    return { ok: false, error: "general" };
  }
}

async function post(
  target: PlanTemplateTarget,
  fields: Readonly<Record<string, string>>,
): Promise<Response> {
  const body = new FormData();
  body.set("planId", target.planId);
  body.set("workspaceId", target.workspaceId);
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return fetch(TEMPLATES_URL, { method: "POST", body, cache: "no-store" });
}

/**
 * Reads the signed-in person's own templates.
 *
 * @throws When the server cannot list them; the list then says so.
 */
export async function fetchPlanTemplates(): Promise<
  readonly AgentPlanNodeTemplate[]
> {
  const response = await fetch(TEMPLATES_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Node templates unavailable");
  const body: unknown = await response.json();
  const templates =
    typeof body === "object" && body !== null && "templates" in body
      ? body.templates
      : null;
  if (!Array.isArray(templates)) throw new Error("Node templates malformed");
  return templates.map(readPlanTemplate);
}

/** Saves one node's configuration under a name; the plan stays unchanged. */
export async function savePlanTemplate(
  target: PlanTemplateTarget,
  draft: { readonly name: string; readonly node: AgentPlanTemplateNode },
): Promise<PlanTemplateResult<AgentPlanNodeTemplate>> {
  try {
    const response = await post(target, {
      intent: "save-template",
      name: draft.name,
      node: JSON.stringify(draft.node),
    });
    if (!response.ok) return await failure(response);
    const body: unknown = await response.json();
    const template =
      typeof body === "object" && body !== null && "template" in body
        ? body.template
        : null;
    return { ok: true, value: readPlanTemplate(template) };
  } catch (error: unknown) {
    console.error("Pages could not save the node template.", error);
    return { ok: false, error: "general" };
  }
}

/** Asks the server for a checked, independent copy of a template. */
export async function insertPlanTemplate(
  target: PlanTemplateTarget,
  templateId: string,
): Promise<PlanTemplateResult<AgentPlanTemplateNode>> {
  try {
    const response = await post(target, {
      intent: "insert-template",
      templateId,
    });
    if (!response.ok) return await failure(response);
    const body: unknown = await response.json();
    const node = readPlanNode(
      typeof body === "object" && body !== null && "node" in body
        ? body.node
        : null,
    );
    if (!isPlanTemplateNode(node)) return { ok: false, error: "general" };
    return { ok: true, value: node };
  } catch (error: unknown) {
    console.error("Pages could not insert the node template.", error);
    return { ok: false, error: "general" };
  }
}
