import { randomUUID } from "node:crypto";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { isUniqueViolationOn } from "@/backend/database/Database";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { holdsNulCharacter } from "@/backend/security/IdentityText";
import { CAPABILITY } from "@/definition/Authorization";
import { AGENT_DOCUMENT_LIMITS } from "@/definition/AgentEmployee";
import {
  AGENT_TEMPLATE_LIMITS,
  DEFAULT_AGENT_TEMPLATES,
} from "@/definition/AgentInstructionTemplate";

import { activeAccount } from "../AdministrationAccess";
import { stripCredentials } from "./AgentEmployeeText";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentInstructionTemplate,
  AgentInstructionTemplateInput,
  AgentInstructionTemplateList,
  DefaultAgentTemplate,
} from "@/definition/AgentInstructionTemplate";
import type { Language } from "@/language/Language";

/** The texts of one default template in one language. */
export type DefaultAgentTemplateTexts = (
  template: DefaultAgentTemplate,
  language: Language,
) => AgentInstructionTemplateInput;

/** What the templates of `AGENT.md` are built from. */
export interface AgentTemplateServiceDependencies {
  readonly store: EmployeeStore;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  /** The texts of the defaults, from the language files of the interface. */
  readonly defaults: DefaultAgentTemplateTexts;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/u;

/** Reads one text field: no NUL, no credential, at most the given characters. */
function readText(input: unknown, maximum: number): string {
  if (typeof input !== "string" || holdsNulCharacter(input))
    throw new AgentEmployeeError("invalidInput");
  const text = stripCredentials(input.replace(/\r\n/gu, "\n"));
  if (Array.from(text).length > maximum)
    throw new AgentEmployeeError("invalidInput");
  return text;
}

/**
 * Checks the fields of a template a person sends.
 *
 * @param input - The parsed body of the form.
 * @returns Name and description trimmed, the content as entered.
 * @throws {AgentEmployeeError} `invalidInput` for a missing name or a field
 * beyond its limit.
 */
export function readAgentTemplateInput(
  input: unknown,
): AgentInstructionTemplateInput {
  if (typeof input !== "object" || input === null)
    throw new AgentEmployeeError("invalidInput");
  const name = readText(
    Reflect.get(input, "name"),
    AGENT_TEMPLATE_LIMITS.nameCharacters,
  ).trim();
  if (name === "") throw new AgentEmployeeError("invalidInput");
  return {
    name,
    description: readText(
      Reflect.get(input, "description") ?? "",
      AGENT_TEMPLATE_LIMITS.descriptionCharacters,
    ).trim(),
    content: readText(
      Reflect.get(input, "content") ?? "",
      AGENT_DOCUMENT_LIMITS.instructionsCharacters,
    ),
  };
}

/** Requires a template identifier as the forms and the interface send it. */
function readIdentifier(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new AgentEmployeeError("invalidInput");
  return input;
}

/**
 * The templates of `AGENT.md` for the whole instance (PAGE-283).
 *
 * @remarks
 * Whoever may enter the user administration reads them; whoever may manage
 * agents changes them, checked on the server for every change. A change of
 * a template changes no agent: picking it only copies its content once.
 * The defaults are stored once, with the texts of the language of the first
 * person who reads the templates; a removed default never comes back.
 */
export class AgentTemplateService {
  private readonly dependencies: AgentTemplateServiceDependencies;
  private readonly policy: UserPolicyService;

  public constructor(
    dependencies: AgentTemplateServiceDependencies,
    channel: ActorChannel = "ui",
  ) {
    this.dependencies = dependencies;
    this.policy = new UserPolicyService(channel);
  }

  /** The same templates with the administrator reading of another channel. */
  public forChannel(channel: ActorChannel): AgentTemplateService {
    return new AgentTemplateService(this.dependencies, channel);
  }

  /**
   * Every template and whether the person may change them.
   *
   * @throws {AgentEmployeeError} `forbidden` for a person outside the administration.
   */
  public async list(actorId: string): Promise<AgentInstructionTemplateList> {
    const actor = await this.actor(actorId);
    if (!this.policy.canEnter(actor)) throw new AgentEmployeeError("forbidden");
    await this.seedDefaults(actorId);
    return {
      templates: await this.dependencies.store.templates().list(),
      canManage: this.policy.has(actor, CAPABILITY.MANAGE_USERS),
    };
  }

  /**
   * One template, for an agent created from it.
   *
   * @returns The template, or `null` when it does not exist.
   */
  public async find(id: string): Promise<AgentInstructionTemplate | null> {
    if (!IDENTIFIER.test(id)) return null;
    return this.dependencies.store.templates().find(id);
  }

  /**
   * Stores a new template.
   *
   * @returns The identifier of the new template.
   * @throws {AgentEmployeeError} `forbidden`, `invalidInput` or `templateNameTaken`.
   */
  public async create(actorId: string, input: unknown): Promise<string> {
    await this.requireManager(actorId);
    const template = readAgentTemplateInput(input);
    const id = randomUUID();
    await this.unique(() =>
      this.dependencies.store
        .templates()
        .insert({ ...template, id, isDefault: false }),
    );
    return id;
  }

  /**
   * Replaces name, description and content of a template.
   *
   * @throws {AgentEmployeeError} `forbidden`, `invalidInput`, `notFound` or `templateNameTaken`.
   */
  public async update(
    actorId: string,
    templateId: unknown,
    input: unknown,
  ): Promise<void> {
    await this.requireManager(actorId);
    const id = readIdentifier(templateId);
    const template = readAgentTemplateInput(input);
    const isStored = await this.unique(() =>
      this.dependencies.store.templates().update(id, template),
    );
    if (!isStored) throw new AgentEmployeeError("notFound");
  }

  /**
   * Removes a template; agents filled from it keep their `AGENT.md`.
   *
   * @throws {AgentEmployeeError} `forbidden`, `invalidInput` or `notFound`.
   */
  public async remove(actorId: string, templateId: unknown): Promise<void> {
    await this.requireManager(actorId);
    const id = readIdentifier(templateId);
    if (!(await this.dependencies.store.templates().remove(id)))
      throw new AgentEmployeeError("notFound");
  }

  private async actor(actorId: string): Promise<AccountAccess> {
    const snapshot = await this.dependencies.authorization.snapshot();
    try {
      return activeAccount(snapshot, actorId);
    } catch (error: unknown) {
      if (error instanceof AdministrationError)
        throw new AgentEmployeeError("forbidden");
      throw error;
    }
  }

  private async requireManager(actorId: string): Promise<void> {
    const actor = await this.actor(actorId);
    if (!this.policy.has(actor, CAPABILITY.MANAGE_USERS))
      throw new AgentEmployeeError("forbidden");
  }

  /** Runs a write and turns a name already in use into its refusal. */
  private async unique<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
      return await work();
    } catch (error: unknown) {
      if (isUniqueViolationOn(error, "name_key"))
        throw new AgentEmployeeError("templateNameTaken");
      throw error;
    }
  }

  /** Stores the defaults once, in the language of the reading person. */
  private async seedDefaults(actorId: string): Promise<void> {
    if (await this.dependencies.store.templates().isSeeded()) return;
    const settings = await this.dependencies.languages.findByUserId(actorId);
    const language = settings?.language ?? "de";
    await this.dependencies.store.transaction(async (store) => {
      const templates = store.templates();
      if (!(await templates.claimSeeding())) return;
      for (const template of DEFAULT_AGENT_TEMPLATES)
        await templates.insert({
          ...this.dependencies.defaults(template, language),
          id: randomUUID(),
          isDefault: true,
        });
    });
  }
}
