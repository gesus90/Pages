/** A model choice on one connection, without credentials or execution authority. */
export interface AgentModelSelection {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
}
