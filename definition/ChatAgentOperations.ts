/** Agent mutations available only through the signed-in Pages chat. */
export const CHAT_AGENT_WRITE_OPERATIONS = [
  "agents.clone",
  "agents.delete",
] as const;

export type ChatAgentWriteOperation =
  (typeof CHAT_AGENT_WRITE_OPERATIONS)[number];

/** A deletion receipt; historical runs remain available under their existing rights. */
export interface ChatAgentDeleted {
  readonly id: string;
  readonly deleted: true;
}
