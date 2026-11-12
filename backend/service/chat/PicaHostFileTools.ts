import { z } from "zod";

import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { AgentHostFileTarget } from "@/backend/service/employee/AgentHostFiles";
import type { PicaToolOutcome } from "./PicaToolSchemas";

/** Attaches a file of the chat's working folder; `ok: false` with an error code names a refusal. */
export type PicaHostFileAttach = (
  target: AgentHostFileTarget,
  file: string,
) => Promise<{ readonly ok: boolean; readonly error?: string }>;

/** What the tools need from the registry of one turn. */
export interface PicaHostFileToolsInput {
  readonly attach: PicaHostFileAttach;
  /** Checks the turn again and spends one call of its budget; `false` when the budget is gone. */
  readonly admit: (context: RuntimeExecutionContext) => Promise<boolean>;
}

const FILE_PATH = z.string().trim().min(1).max(1_000);

const TICKET_SCHEMA = z
  .object({ ticketId: z.string().trim().min(1).max(200), path: FILE_PATH })
  .strict();

const WIKI_SCHEMA = z
  .object({ pageId: z.string().trim().min(1).max(200), path: FILE_PATH })
  .strict();

type TicketParameters = z.infer<typeof TICKET_SCHEMA>;
type WikiParameters = z.infer<typeof WIKI_SCHEMA>;

const PATH_NOTE =
  "path is a file you created in the working folder of this chat, relative to it or absolute inside it; files elsewhere are refused. Returns attachmentId, fileName, size and contentType.";

async function run(
  input: PicaHostFileToolsInput,
  context: RuntimeExecutionContext,
  upload: { readonly target: AgentHostFileTarget; readonly file: string },
): Promise<PicaToolOutcome> {
  if (!(await input.admit(context)))
    return { ok: false, result: null, error: "STEP_LIMIT" };
  const outcome = await input.attach(upload.target, upload.file);
  context.signal.throwIfAborted();
  return {
    ok: outcome.ok,
    result: redactCredentials(JSON.stringify(outcome)),
    error: outcome.ok ? null : (outcome.error ?? "FAILED"),
  };
}

/**
 * Registers the tools that attach a file the agent made, such as a rendered
 * PNG, to a ticket or a wiki page (PAGE-303).
 *
 * @remarks
 * Only an agent employee on "Arbeitsplatz" or YOLO gets them. They act with
 * the agent's own account, so the ticket and wiki rules decide every call.
 */
export function registerPicaHostFileTools(
  registry: RuntimeToolRegistry,
  input: PicaHostFileToolsInput,
): void {
  registry.register<TicketParameters, PicaToolOutcome>({
    id: "tickets_attach_file",
    description: `Attach a file to a ticket as a ticket attachment. ticketId is the ticket ID or its key such as PAGE-12. ${PATH_NOTE}`,
    inputSchema: TICKET_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      run(input, context, {
        target: { kind: "ticket", ticketId: parameters.ticketId },
        file: parameters.path,
      }),
  });
  registry.register<WikiParameters, PicaToolOutcome>({
    id: "wiki_page_attach_file",
    description: `Attach a file to a wiki page as a page attachment. pageId is the page ID from wiki_search or wiki_tree_read. ${PATH_NOTE}`,
    inputSchema: WIKI_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      run(input, context, {
        target: { kind: "wikiPage", pageId: parameters.pageId },
        file: parameters.path,
      }),
  });
}
