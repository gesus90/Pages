import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";

/** A resolved text agent for a synthetic connection; no credential is involved. */
export function textInput(
  fields: {
    readonly model?: string;
    readonly reasoningEffort?: string | null;
    readonly instructions?: string;
    readonly webSearch?: boolean;
    readonly prompt?: string;
  } = {},
): TextExecutionInput {
  return {
    agent: {
      connection: {
        isActive: true,
        id: "connection-1",
        name: "Synthetic connection",
        provider: "openai",
        hasApiKey: true,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: "2026-10-15T00:00:00.000Z",
      },
      model: fields.model ?? "model-1",
      reasoningEffort: fields.reasoningEffort ?? null,
    },
    userId: "user-1",
    prompt: fields.prompt ?? "Translate this.",
    ...(fields.instructions === undefined
      ? {}
      : { instructions: fields.instructions }),
    ...(fields.webSearch === undefined ? {} : { webSearch: fields.webSearch }),
  };
}

/** One ticket image and one ticket text file, as a runner would send them. */
export const TICKET_ASSETS: readonly AgentTicketAssetContent[] = [
  {
    parameter: "screenshot",
    ticketId: "ticket-1",
    ticketKey: "SYN-1",
    asset: { source: "ticket", id: "asset-1", link: "/files/asset-1" },
    fileName: "screen.png",
    content: { type: "image", mimeType: "image/png", base64: "QUJD" },
  },
  {
    parameter: "notes",
    ticketId: "ticket-1",
    ticketKey: "SYN-1",
    asset: { source: "ticket", id: "asset-2", link: "/files/asset-2" },
    fileName: "notes.txt",
    content: { type: "text", text: "plain notes" },
  },
];

/** The provenance label that precedes the image, as the provider receives it. */
export const IMAGE_LABEL = JSON.stringify({
  parameter: "screenshot",
  ticketId: "ticket-1",
  ticketKey: "SYN-1",
  asset: { source: "ticket", id: "asset-1", link: "/files/asset-1" },
  fileName: "screen.png",
});

/** The provenance label that precedes the text file. */
export const NOTES_LABEL = JSON.stringify({
  parameter: "notes",
  ticketId: "ticket-1",
  ticketKey: "SYN-1",
  asset: { source: "ticket", id: "asset-2", link: "/files/asset-2" },
  fileName: "notes.txt",
});
