/**
 * Templates for `AGENT.md` (PAGE-283).
 *
 * @remarks
 * A template belongs to the whole instance. Picking it fills `AGENT.md` of
 * an agent once; a later change of the template changes no agent. The
 * defaults Coder, Designer and Manager are stored once and can be changed and
 * removed like every other template.
 */

/** Length limits of a template; its content follows the limit of `AGENT.md`. */
export const AGENT_TEMPLATE_LIMITS = {
  /** Characters of the name. */
  nameCharacters: 80,
  /** Characters of the short description. */
  descriptionCharacters: 200,
} as const;

/** The defaults stored once with the texts of the current language. */
export const DEFAULT_AGENT_TEMPLATES = [
  "coder",
  "designer",
  "manager",
] as const;

/** A default of {@link DEFAULT_AGENT_TEMPLATES}. */
export type DefaultAgentTemplate = (typeof DEFAULT_AGENT_TEMPLATES)[number];

/** One stored template. */
export interface AgentInstructionTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  /** Whether the template was stored as one of the defaults. */
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What a person enters for a new or changed template. */
export interface AgentInstructionTemplateInput {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

/** The templates and whether the person may change them. */
export interface AgentInstructionTemplateList {
  readonly templates: readonly AgentInstructionTemplate[];
  readonly canManage: boolean;
}
