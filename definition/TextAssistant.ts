/** The only agent function role implemented by the text assistant. */
export interface TextAgentRole {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** Instance administration is separate from personal editor preferences. */
export interface TextAssistantSettings {
  readonly role: TextAgentRole | null;
  readonly retentionDays: number;
}

export interface TextAssistantPreferences {
  readonly autoApply: boolean;
  readonly targetLanguage: string;
}

/** A version belongs to a single wiki page or ticket description. */
export interface TextAssistantContext {
  readonly kind: "wiki" | "ticket";
  readonly id: string;
  /** Wiki revision, or the exact saved ticket description used as its base. */
  readonly version: string;
}

export type TextAssistantAction =
  | "translate"
  | "proofread"
  | "generate"
  | "summarize"
  | "explain"
  | "instruct"
  | "chat";

export type TextAssistantScope = "none" | "selection" | "document";
export type TextAssistantChange = "answer" | "replace" | "insert";

/** Client requests contain no provider selection or writable metadata fields. */
export interface TextAssistantRequest {
  readonly requestId: string;
  readonly conversationId: string | null;
  readonly context: TextAssistantContext;
  readonly action: TextAssistantAction;
  readonly scope: TextAssistantScope;
  readonly change: TextAssistantChange;
  readonly source: string;
  readonly instruction: string;
  readonly targetLanguage: string;
}

/** A completed suggestion never writes to the document by itself. */
export interface TextAssistantResult {
  readonly requestId: string;
  readonly conversationId: string;
  readonly text: string;
  readonly change: TextAssistantChange;
  readonly context: TextAssistantContext;
}

export interface AssistantConversation {
  readonly id: string;
  readonly lastMessageAt: string;
}

export interface AssistantMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly change: TextAssistantChange;
  readonly createdAt: string;
}
