import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  VIRTUAL_GROUP_DESCRIPTION_LENGTH,
  VIRTUAL_GROUP_NAME_LENGTH,
} from "@/definition/VirtualChat";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { User } from "@/definition/User";
import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** Members a new group may start with. */
const MAXIMUM_MEMBERS = 500;

/** What the group service reads and writes. */
export interface ChatGroupDependencies {
  readonly store: EmployeeStore;
  /** The current time; tests pass a fixed one. */
  readonly now?: () => Date;
  /** A new group ID; tests pass a fixed one. */
  readonly createId?: () => string;
}

/** The raw input of a new group, as the page sends it. */
export interface ChatGroupInput {
  readonly name: unknown;
  readonly description: unknown;
  readonly memberIds: unknown;
}

interface TextRule {
  readonly maximum: number;
  readonly isRequired: boolean;
}

function readText(value: unknown, rule: TextRule): string {
  if (typeof value !== "string") throw new AgentEmployeeError("invalidInput");
  const text = value.trim();
  if (text.length > rule.maximum || (rule.isRequired && text === ""))
    throw new AgentEmployeeError("invalidInput");
  return text;
}

function readIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_MEMBERS ||
    !value.every((entry): entry is string => typeof entry === "string")
  )
    throw new AgentEmployeeError("invalidInput");
  return [...new Set(value)];
}

function readId(value: unknown): string {
  if (typeof value !== "string" || value === "")
    throw new AgentEmployeeError("invalidInput");
  return value;
}

/**
 * The groups of a person's chat page and the last activity of both lists
 * (PAGE-259).
 *
 * @remarks
 * Every operation is bound to the signed-in person: a group or participant of
 * another account is never read or changed, whatever ID a request names.
 * Members are always participants of the person's own list.
 */
export class ChatGroupService {
  private readonly dependencies: ChatGroupDependencies;

  public constructor(dependencies: ChatGroupDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Creates a group of the person with at least one of their participants.
   *
   * @returns The ID of the new group.
   * @throws {AgentEmployeeError} `invalidInput` for a missing or too long
   * name, a too long description, no members, or a member outside the
   * person's own list.
   */
  public async create(person: User, input: ChatGroupInput): Promise<string> {
    const name = readText(input.name, {
      maximum: VIRTUAL_GROUP_NAME_LENGTH,
      isRequired: true,
    });
    const description = readText(input.description ?? "", {
      maximum: VIRTUAL_GROUP_DESCRIPTION_LENGTH,
      isRequired: false,
    });
    const memberIds = readIds(input.memberIds);
    await this.requireParticipants(person, memberIds);
    const id = this.dependencies.createId?.() ?? randomUUID();
    await this.dependencies.store.groups().create(person.id, {
      id,
      name,
      description,
      memberIds,
      createdAt: this.now(),
    });
    return id;
  }

  /**
   * Adds one of the person's participants to one of their groups; adding a
   * member twice changes nothing.
   *
   * @throws {AgentEmployeeError} `notFound` for a group of another account
   * or none, `invalidInput` for a participant outside the person's list.
   */
  public async addMember(
    person: User,
    groupId: unknown,
    participantId: unknown,
  ): Promise<void> {
    const group = readId(groupId);
    const participant = readId(participantId);
    const members = await this.dependencies.store
      .groups()
      .memberIds(person.id, group);
    if (!members) throw new AgentEmployeeError("notFound");
    if (members.includes(participant)) return;
    await this.requireParticipants(person, [participant]);
    await this.dependencies.store
      .groups()
      .addMember(person.id, group, participant, this.now());
  }

  /**
   * Records a sent message as the last activity of a group or participant.
   *
   * @throws {AgentEmployeeError} `notFound` when the person has no such
   * group or participant.
   */
  public async recordActivity(
    person: User,
    selection: VirtualChatSelection,
  ): Promise<void> {
    const at = this.now();
    const isKnown =
      selection.kind === "group"
        ? await this.dependencies.store
            .groups()
            .touch(person.id, selection.id, at)
        : await this.dependencies.store
            .contacts()
            .touch(person.id, selection.id, at);
    if (!isKnown) throw new AgentEmployeeError("notFound");
  }

  private async requireParticipants(
    person: User,
    ids: readonly string[],
  ): Promise<void> {
    const own = new Set(
      (await this.dependencies.store.contacts().list(person.id)).map(
        (entry) => entry.contactId,
      ),
    );
    if (!ids.every((id) => own.has(id)))
      throw new AgentEmployeeError("invalidInput");
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
