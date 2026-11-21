import {
  AGENT_SOURCE_SEARCH_MAX_QUESTION,
  AGENT_SOURCE_SEARCH_MAX_SECTIONS,
} from "../AgentSourceSearch.js";
import { IDENTIFIER_SCHEMA, READ_ANNOTATIONS } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Answers a question from the tickets, wiki pages and released ticket assets the account may read. */
export const SOURCE_SEARCH_TOOL: Tool = {
  name: "search_sources",
  title: "Search sources",
  description: `Finds the sections of visible tickets, wiki pages and ticket assets released for the search that answer a question (1 to ${String(AGENT_SOURCE_SEARCH_MAX_QUESTION)} characters), by keyword search and vector search together; a rephrased question finds sections without the same words. A ticket number written in the question, such as TICKET-12, returns that ticket first when you may see it. projectId limits the search to the tickets, their assets and the project pages of one visible project; a hidden or missing project returns NOT_FOUND. limit is 1 to ${String(AGENT_SOURCE_SEARCH_MAX_SECTIONS)} sections (default 10). Every section has sourceType (ticket, wiki_page or ticket_asset), sourceId, title, link (the Pages address to cite), ticketKey, projectId, sourceVersion (the current revision), sectionIndex, text and matchedBy (ticketKey, keyword, vector). Pages checks your current rights before ranking and limit and reads every section from the current revision; hidden sources are neither returned nor counted. vectorSearch tells whether the vector search took part (status used with modelVersion) or not (status unavailable with reason notConfigured, embeddingFailed, vectorSearchUnavailable or timeout); the keyword search answers alone then. staleSections counts vector hits left out because their source changed since it was indexed. Responses are limited to 1 MiB UTF-8 JSON.`,
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        minLength: 1,
        maxLength: AGENT_SOURCE_SEARCH_MAX_QUESTION,
      },
      projectId: IDENTIFIER_SCHEMA,
      limit: {
        type: "integer",
        minimum: 1,
        maximum: AGENT_SOURCE_SEARCH_MAX_SECTIONS,
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
};
