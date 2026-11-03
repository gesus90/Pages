/** Instance administration reads, offered only to the chat in active admin mode. */
export const CHAT_INSTANCE_READ_OPERATIONS = [
  "admin.connections.list",
  "admin.settings.read",
] as const;

/** Instance administration mutations, offered only to the chat in active admin mode. */
export const CHAT_INSTANCE_WRITE_OPERATIONS = [
  "admin.connections.setActive",
  "admin.settings.setCompanyName",
] as const;

export type ChatInstanceReadOperation =
  (typeof CHAT_INSTANCE_READ_OPERATIONS)[number];
export type ChatInstanceWriteOperation =
  (typeof CHAT_INSTANCE_WRITE_OPERATIONS)[number];
/** An instance administration operation of the chat. */
export type ChatInstanceOperation =
  ChatInstanceReadOperation | ChatInstanceWriteOperation;

/** Narrows an operation name to the instance administration reads. */
export function isChatInstanceReadOperation(
  input: unknown,
): input is ChatInstanceReadOperation {
  return CHAT_INSTANCE_READ_OPERATIONS.some((operation) => operation === input);
}

/** Narrows an operation name to the instance administration mutations. */
export function isChatInstanceWriteOperation(
  input: unknown,
): input is ChatInstanceWriteOperation {
  return CHAT_INSTANCE_WRITE_OPERATIONS.some(
    (operation) => operation === input,
  );
}

/**
 * A connection as the administration chat reads it.
 *
 * @remarks
 * Only identity, state and kind: API keys, CLI account labels and check
 * details stay inside the connection service.
 */
export interface AgentAdminConnection {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly accessKind: string;
  readonly isActive: boolean;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  readonly updatedAt: string;
}

/** What identifies the instance, as the administration chat reads it. */
export interface AgentAdminSettings {
  readonly companyName: string | null;
  readonly hasLogo: boolean;
}
