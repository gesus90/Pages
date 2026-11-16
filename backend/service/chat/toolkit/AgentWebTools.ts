import { z } from "zod";

import { logCaughtError } from "@/backend/logging/Logger";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import { publicBrowserUrl, readPublicPage } from "../admin/PicaBrowserNetwork";

import { defineToolkitTool } from "./AgentToolkitContracts";
import {
  UNTRUSTED_CONTENT_NOTE,
  toolkitRefusal,
  toolkitResult,
} from "./AgentToolkitOutcome";
import { htmlTitle, htmlToText, parseSearchResults } from "./AgentWebText";

import type { AgentToolkitTool } from "./AgentToolkitContracts";
import type { PicaToolOutcome } from "../PicaToolSchemas";

/** A fetched page as the web tools read it. */
export interface AgentWebPage {
  readonly body: Buffer;
  readonly contentType: string;
  readonly status: number;
}

/**
 * Fetches one public page.
 * @throws {PicaAdminError} With the code of a refused address or a failed request.
 */
export type AgentWebPageReader = (
  address: string,
  signal: AbortSignal,
) => Promise<AgentWebPage>;

/**
 * Fetches a public HTTPS page the way the restricted browser of Pages does:
 * no address of this host, no private or reserved network, the resolved
 * address pinned for the request, no implicit redirect, at most 1 MB.
 */
export const readPublicWebPage: AgentWebPageReader = (address, signal) =>
  readPublicPage({ url: publicBrowserUrl(address), signal });

const SEARCH_ADDRESS = "https://html.duckduckgo.com/html/";

const FETCH_SCHEMA = z
  .object({
    url: z.string().min(1).max(4_000),
    maxCharacters: z.number().int().min(500).max(100_000).optional(),
  })
  .strict();

const SEARCH_SCHEMA = z
  .object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

function isText(contentType: string): boolean {
  return /^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript))/iu.test(
    contentType,
  );
}

/** Runs a web call and turns a refused address or failed request into a refusal. */
async function guardedWeb(
  run: () => Promise<PicaToolOutcome>,
): Promise<PicaToolOutcome> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof PicaAdminError) return toolkitRefusal(error.message);
    if (error instanceof TypeError) return toolkitRefusal("URL_DENIED");
    if (error instanceof Error && error.name === "AbortError") throw error;
    logCaughtError("AgentWebTools", error);
    return toolkitRefusal("FETCH_FAILED");
  }
}

/**
 * The web tools of the toolkit: a web search and a page fetched
 * as readable text. Both only read, so every access level that allows the
 * web group offers them; what they return is data, never an instruction.
 */
export const AGENT_WEB_TOOLS: readonly AgentToolkitTool[] = [
  defineToolkitTool({
    id: "web_abrufen",
    group: "web",
    isWrite: false,
    description: `Fetch a public HTTPS page and return its title and readable text (at most maxCharacters, default 20000). Addresses of this server, private networks and redirects are refused; a redirect names nothing, so fetch the target address yourself. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: FETCH_SCHEMA,
    execute: (parameters, job, context) =>
      guardedWeb(async () => {
        const page = await job.readPage(parameters.url, context.signal);
        if (!isText(page.contentType))
          return toolkitRefusal("NOT_TEXT", { contentType: page.contentType });
        const html = page.body.toString("utf8");
        const isHtml = /html/iu.test(page.contentType);
        const text = isHtml ? htmlToText(html) : html;
        const limit = parameters.maxCharacters ?? 20_000;
        return toolkitResult({
          url: parameters.url,
          status: page.status,
          contentType: page.contentType,
          title: isHtml ? htmlTitle(html) : null,
          text: text.slice(0, limit),
          isTruncated: text.length > limit,
          note: UNTRUSTED_CONTENT_NOTE,
        });
      }),
  }),
  defineToolkitTool({
    id: "web_suchen",
    group: "web",
    isWrite: false,
    description: `Search the web and return title, url and snippet of the hits (limit, default 8, at most 20). Read a hit with web_abrufen. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: SEARCH_SCHEMA,
    execute: (parameters, job, context) =>
      guardedWeb(async () => {
        const address = `${SEARCH_ADDRESS}?q=${encodeURIComponent(parameters.query)}`;
        const page = await job.readPage(address, context.signal);
        if (page.status >= 400)
          return toolkitRefusal("SEARCH_FAILED", { status: page.status });
        return toolkitResult({
          query: parameters.query,
          results: parseSearchResults(
            page.body.toString("utf8"),
            parameters.limit ?? 8,
          ),
          note: UNTRUSTED_CONTENT_NOTE,
        });
      }),
  }),
];
