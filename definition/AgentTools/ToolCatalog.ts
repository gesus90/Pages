import { READ_TOOLS } from "./Registry.js";
import { COMMENT_TOOLS } from "./WikiComments.js";
import { WRITE_TOOLS } from "./WriteRegistry.js";

/** One transport-neutral catalog for listing, verification and dispatch. */
export const TOOL_ENTRIES = [...READ_TOOLS, ...COMMENT_TOOLS, ...WRITE_TOOLS];

/** Supported operations are derived from their registrations, never repeated by dispatchers. */
export type McpToolOperation = (typeof TOOL_ENTRIES)[number]["operation"];
