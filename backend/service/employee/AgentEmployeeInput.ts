import { z } from "zod";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { holdsNulCharacter } from "@/backend/security/IdentityText";
import {
  AGENT_DOCUMENT_LIMITS,
  isAgentEmployeeAccess,
} from "@/definition/AgentEmployee";
import { AGENT_MEMORY_CHARACTERS } from "@/definition/AgentMemory";
import { isPersonColor, readPersonColor } from "@/definition/PersonColor";

import { stripCredentials } from "./AgentEmployeeText";

import type {
  AgentEmployeeDocuments,
  AgentEmployeeSettings,
} from "@/definition/AgentEmployee";
import type { AgentMemoryLimits } from "@/definition/AgentMemory";
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
  /** `DREAM.md`; `null` leaves it unchanged (PAGE-305). */
  readonly dream: string | null;
  /** The character limits of both files (PAGE-305). */
  readonly limits: AgentMemoryLimits;
  /** Whether the nightly dream run is on. */
  readonly isLearningEnabled: boolean;
}

/** The character limits as the panel sends them; absent ones take the start values. */
const limitsInput = z.object({
  memoryCharacters: z.coerce
    .number()
    .int()
    .min(AGENT_MEMORY_CHARACTERS.memoryMinimum)
    .max(AGENT_MEMORY_CHARACTERS.memoryMaximum)
    .default(AGENT_MEMORY_CHARACTERS.memoryDefault),
  dreamCharacters: z.coerce
    .number()
    .int()
    .min(AGENT_MEMORY_CHARACTERS.dreamMinimum)
    .max(AGENT_MEMORY_CHARACTERS.dreamMaximum)
    .default(AGENT_MEMORY_CHARACTERS.dreamDefault),
});

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

/** Reads `MEMORY.md` or `DREAM.md`; the limit of the agent is checked where it is stored. */
function readMemoryFile(input: unknown, maximum: number): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string" || holdsNulCharacter(input))
    throw new AgentEmployeeError("invalidInput");
  const text = stripCredentials(input.replace(/\r\n/gu, "\n"));
  if (Array.from(text).length > maximum)
    throw new AgentEmployeeError("invalidInput");
  return text;
}

function readLimits(
  fields: Readonly<Record<string, unknown>>,
): AgentMemoryLimits {
  const parsed = limitsInput.safeParse({
    memoryCharacters: fields.memoryCharacters ?? undefined,
    dreamCharacters: fields.dreamCharacters ?? undefined,
  });
  if (!parsed.success) throw new AgentEmployeeError("invalidInput");
  return parsed.data;
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
    memory: readMemoryFile(
      fields.memory,
      AGENT_MEMORY_CHARACTERS.memoryMaximum,
    ),
    dream: readMemoryFile(fields.dream, AGENT_MEMORY_CHARACTERS.dreamMaximum),
    limits: readLimits(fields),
    isLearningEnabled: fields.isLearningEnabled !== false,
  };
}
