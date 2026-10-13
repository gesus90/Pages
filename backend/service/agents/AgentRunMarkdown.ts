import type { PageAgentRunRecord } from "@/definition/PageAgent";

/** Wraps text in a code fence that no line inside the text can close. */
function fenced(text: string, language = ""): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/gu) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

/**
 * Renders the markdown file of one agent run from its stored record.
 *
 * @param record - The persisted record; text fields are already redacted.
 * @returns Metadata as a JSON block, then the prepared input and the result as
 * fenced text, so the file stays machine-readable whatever the text contains.
 */
export function renderAgentRunRecord(record: PageAgentRunRecord): string {
  const { input, result, ...metadata } = record;
  const sections = [
    `# Agent run ${record.runId}`,
    fenced(JSON.stringify(metadata, null, 2), "json"),
    "## Input",
    fenced(input),
    "## Result",
    fenced(result),
  ];
  return `${sections.join("\n\n")}\n`;
}
