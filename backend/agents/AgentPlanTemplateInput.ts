import { AgentError } from "@/backend/error/AgentErrors";
import {
  isPlanTemplateNode,
  isPlanTemplateType,
  PLAN_TEMPLATE_NAME_LENGTH,
} from "@/definition/AgentPlanNodeTemplate";

import { readPlanNode } from "./AgentPlanInput";
import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

/** The longest node a template request may carry, as long as a whole plan. */
const NODE_TEXT_LENGTH = 2_000_000;

/**
 * Reads the name of a new template.
 *
 * @throws {AgentError} `template_name_required` for an empty name,
 * `template_invalid` for a name that is too long or holds control characters.
 */
export function readPlanTemplateName(input: unknown): string {
  if (typeof input !== "string" || !input.trim())
    throw new AgentError("template_name_required");
  const name = input.trim();
  if (
    name.length > PLAN_TEMPLATE_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(name)
  )
    throw new AgentError("template_invalid");
  return name;
}

/**
 * Reads the node whose configuration becomes a template.
 *
 * @throws {AgentError} `template_invalid` for a node type without templates,
 * or the plan reader's code for a malformed node.
 */
export function readPlanTemplateNode(input: unknown): AgentPlanTemplateNode {
  if (typeof input !== "string" || input.length > NODE_TEXT_LENGTH)
    throw new AgentError("template_invalid");
  const node = readPlanNode(JSON.parse(input) as unknown);
  if (!isPlanTemplateNode(node)) throw new AgentError("template_invalid");
  return node;
}

/**
 * Reads one template as the server sends it to the editor.
 *
 * @throws {AgentError} `template_invalid` for anything but a complete
 * template of a node type this version knows.
 */
export function readPlanTemplate(input: unknown): AgentPlanNodeTemplate {
  const { id, name, type, createdAt, node } = readAgentObject(input);
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof type !== "string" ||
    typeof createdAt !== "string" ||
    !isPlanTemplateType(type)
  )
    throw new AgentError("template_invalid");
  const templateNode = readPlanNode(node);
  if (templateNode.type !== type || !isPlanTemplateNode(templateNode))
    throw new AgentError("template_invalid");
  return { id, name, type, createdAt, node: templateNode };
}
