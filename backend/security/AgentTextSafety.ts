import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

const CREDENTIALS =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|AIza[a-zA-Z0-9_-]{20,}|Bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[=:]\s*["']?[^\s"']{8,}|v1\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/gi;

/** Masks recognizable pasted credentials before any message is persisted or returned. */
export function redactCredentials(text: string): string {
  return text.replace(CREDENTIALS, "[redacted]");
}

/** Rejects credential-shaped input instead of forwarding it to an external provider. */
export function requireCredentialFreeText(text: string): void {
  if (redactCredentials(text) !== text)
    throw new AgentExecutionError("credentialsInText");
}
