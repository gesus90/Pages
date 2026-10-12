import { EXTENSION_WRITE_TOOLS } from "./extensions.js";
import { ADMIN_WRITE_TOOLS } from "./administration.js";
import { ASSET_UPLOAD_TOOL } from "./asset-upload.js";
import {
  MILESTONE_CREATE_TOOL,
  MILESTONE_DEPENDENCY_ADD_TOOL,
  MILESTONE_DEPENDENCY_REMOVE_TOOL,
  MILESTONE_SET_DESCRIPTION_TOOL,
  MILESTONE_SET_DUE_TOOL,
  MILESTONE_SET_NAME_TOOL,
  MILESTONE_SET_START_TOOL,
  MILESTONE_SET_STATUS_TOOL,
} from "./milestone.js";
import { STRUCTURED_IMPORT_APPLY_TOOL } from "./structured-import-apply.js";
import { TICKET_CREATE_TOOL } from "./ticket-create.js";
import {
  TICKET_SET_DESCRIPTION_TOOL,
  TICKET_SET_PARENT_TOOL,
  TICKET_SET_STATUS_TOOL,
  TICKET_SET_TITLE_TOOL,
} from "./ticket-field.js";
import { WIKI_CREATE_TOOL } from "./wiki-create.js";
import { WIKI_IMPORT_APPLY_TOOL } from "./wiki-import-apply.js";
import { WIKI_IMPORT_UPDATE_TOOL } from "./wiki-import-update.js";
import { WIKI_MOVE_TOOL } from "./wiki-move.js";
import {
  WIKI_SET_CONTENT_TOOL,
  WIKI_SET_ICON_TOOL,
  WIKI_SET_TITLE_TOOL,
} from "./wiki-page-fields.js";

import type { Tool } from "@modelcontextprotocol/server";
import type { PagesAgentWriteOperation } from "../../../definition/PagesAgentWrites.js";

/** Fixed write contracts; Pages resolves write permission afresh for each list and call. */
export const WRITE_TOOLS: readonly {
  readonly operation: PagesAgentWriteOperation;
  readonly tool: Tool;
}[] = [
  ...EXTENSION_WRITE_TOOLS,
  ...ADMIN_WRITE_TOOLS,
  { operation: "assets.upload.prepare", tool: ASSET_UPLOAD_TOOL },
  { operation: "wiki.page.create", tool: WIKI_CREATE_TOOL },
  { operation: "wiki.import.apply", tool: WIKI_IMPORT_APPLY_TOOL },
  { operation: "wiki.import.update", tool: WIKI_IMPORT_UPDATE_TOOL },
  { operation: "import.structured.apply", tool: STRUCTURED_IMPORT_APPLY_TOOL },
  { operation: "wiki.page.setTitle", tool: WIKI_SET_TITLE_TOOL },
  { operation: "wiki.page.setContent", tool: WIKI_SET_CONTENT_TOOL },
  { operation: "wiki.page.setIcon", tool: WIKI_SET_ICON_TOOL },
  { operation: "wiki.page.move", tool: WIKI_MOVE_TOOL },
  { operation: "ticket.create", tool: TICKET_CREATE_TOOL },
  { operation: "ticket.setTitle", tool: TICKET_SET_TITLE_TOOL },
  { operation: "ticket.setDescription", tool: TICKET_SET_DESCRIPTION_TOOL },
  { operation: "ticket.setStatus", tool: TICKET_SET_STATUS_TOOL },
  { operation: "ticket.setParent", tool: TICKET_SET_PARENT_TOOL },
  { operation: "milestone.create", tool: MILESTONE_CREATE_TOOL },
  { operation: "milestone.setName", tool: MILESTONE_SET_NAME_TOOL },
  {
    operation: "milestone.setDescription",
    tool: MILESTONE_SET_DESCRIPTION_TOOL,
  },
  { operation: "milestone.setStatus", tool: MILESTONE_SET_STATUS_TOOL },
  { operation: "milestone.setStartAt", tool: MILESTONE_SET_START_TOOL },
  { operation: "milestone.setDueAt", tool: MILESTONE_SET_DUE_TOOL },
  {
    operation: "milestone.dependency.add",
    tool: MILESTONE_DEPENDENCY_ADD_TOOL,
  },
  {
    operation: "milestone.dependency.remove",
    tool: MILESTONE_DEPENDENCY_REMOVE_TOOL,
  },
];
