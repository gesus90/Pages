import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { holdsNulCharacter } from "@/backend/security/IdentityText";
import {
  AGENT_DOCUMENT_LIMITS,
  AGENT_MAXIMUM_COST_LIMIT,
  AGENT_MEMORY_LIMITS,
  countWords,
  isAgentEmployeeAccess,
} from "@/definition/AgentEmployee";
import { isPersonColor, readPersonColor } from "@/definition/PersonColor";

import { stripCredentials } from "./AgentEmployeeText";

import type {
  AgentEmployeeDocuments,
  AgentEmployeeSettings,
} from "@/definition/AgentEmployee";
import type { PersonColor } from "@/definition/PersonColor";

/** Longest name, username or job title. */
const MAXIMUM_NAME = 200;
/** The characters a username of an agent may use. */
const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{1,64}$/u;

/** What an administrator creates or saves for an agent. */
export interface AgentEmployeeInput {
  readonly displayName: string;
  readonly username: string;
  /** The job title, apart from the role. */
  readonly position: string | null;
  readonly avatarColor: PersonColor | null;
  /** A normal role; agents never get the administrator account. */
  readonly roleId: string;
  readonly departments: readonly string[];
  readonly settings: AgentEmployeeSettings;
  readonly documents: AgentEmployeeDocuments;
  /** `MEMORY.md`; `null` leaves it unchanged. */
  readonly memory: string | null;
  readonly isLearningEnabled: boolean;
}

function readName(input: unknown, isOptional: boolean): string | null {
  if (input === null || input === undefined || input === "") {
    if (isOptional) return null;
    throw new AgentEmployeeError("invalidInput");
  }
  if (typeof input !== "string") throw new AgentEmployeeError("invalidInput");
  const text = input.trim();
  if (
    (text === "" && !isOptional) ||
    text.length > MAXIMUM_NAME ||
    holdsNulCharacter(text)
  )
    throw new AgentEmployeeError("invalidInput");
  return text === "" ? null : text;
}

function readDocument(input: unknown, maximum: number): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "string" || holdsNulCharacter(input))
    throw new AgentEmployeeError("invalidInput");
  const text = stripCredentials(input.replace(/\r\n/gu, "\n"));
  if (Array.from(text).length > maximum)
    throw new AgentEmployeeError("invalidInput");
  return text;
}

function readCostLimit(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  const value =
    typeof input === "string" ? Number(input.replace(",", ".")) : input;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > AGENT_MAXIMUM_COST_LIMIT
  )
    throw new AgentEmployeeError("invalidInput");
  return Math.round(value * 100) / 100;
}

function readSettings(input: Record<string, unknown>): AgentEmployeeSettings {
  const { connectionId, model, reasoningEffort, access } = input;
  if (
    typeof connectionId !== "string" ||
    connectionId === "" ||
    typeof model !== "string" ||
    model === "" ||
    model.length > 300 ||
    !isAgentEmployeeAccess(access) ||
    (reasoningEffort !== null &&
      reasoningEffort !== undefined &&
      reasoningEffort !== "" &&
      (typeof reasoningEffort !== "string" || reasoningEffort.length > 40))
  )
    throw new AgentEmployeeError("invalidInput");
  return {
    connectionId,
    model,
    reasoningEffort:
      typeof reasoningEffort === "string" && reasoningEffort !== ""
        ? reasoningEffort
        : null,
    access,
    monthlyCostLimit: readCostLimit(input.monthlyCostLimit),
  };
}

function readDepartments(input: unknown): readonly string[] {
  if (input === undefined || input === null) return [];
  if (
    !Array.isArray(input) ||
    input.length > 100 ||
    !input.every((entry): entry is string => typeof entry === "string")
  )
    throw new AgentEmployeeError("invalidInput");
  return [...new Set(input)];
}

function readMemory(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string" || holdsNulCharacter(input))
    throw new AgentEmployeeError("invalidInput");
  const memory = stripCredentials(input.replace(/\r\n/gu, "\n"));
  if (countWords(memory) > AGENT_MEMORY_LIMITS.coreWords)
    throw new AgentEmployeeError("invalidInput");
  return memory;
}

/**
 * Reads the fields of the agent panel from an untrusted source.
 *
 * @param input - The decoded fields.
 * @returns The checked input; credentials are removed from every document.
 * @throws {AgentEmployeeError} `invalidInput` for anything outside the limits.
 */
export function readAgentEmployeeInput(input: unknown): AgentEmployeeInput {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentEmployeeError("invalidInput");
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(
    Object.entries(input),
  );
  const username = readName(fields.username, false) ?? "";
  if (!USERNAME_PATTERN.test(username))
    throw new AgentEmployeeError("invalidInput");
  if (
    fields.avatarColor !== null &&
    fields.avatarColor !== undefined &&
    fields.avatarColor !== "" &&
    !isPersonColor(fields.avatarColor)
  )
    throw new AgentEmployeeError("invalidInput");
  const roleId: unknown = fields.roleId;
  if (typeof roleId !== "string" || roleId === "")
    throw new AgentEmployeeError("invalidInput");
  return {
    displayName: readName(fields.displayName, false) ?? "",
    username,
    position: readName(fields.position, true),
    avatarColor: readPersonColor(fields.avatarColor),
    roleId,
    departments: readDepartments(fields.departments),
    settings: readSettings(fields),
    documents: {
      soul: readDocument(fields.soul, AGENT_DOCUMENT_LIMITS.soulCharacters),
      instructions: readDocument(
        fields.instructions,
        AGENT_DOCUMENT_LIMITS.instructionsCharacters,
      ),
    },
    memory: readMemory(fields.memory),
    isLearningEnabled: fields.isLearningEnabled !== false,
  };
}
