import { z } from "zod";

import type { Tool } from "@modelcontextprotocol/server";

/** Keys only Pages sets; the model can neither replay an operation nor confirm a change. */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  "operationId",
  "confirmation",
]);

type SchemaEntry = Parameters<typeof z.fromJSONSchema>[0];

function isSchemaEntry(input: unknown): input is SchemaEntry {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/**
 * Derives the strict native input schema of a static tool contract.
 *
 * @param tool - The transport-neutral contract that MCP clients list as well.
 * @returns The same arguments without `operationId` and `confirmation`, which Pages supplies itself.
 * @throws {Error} For a contract whose properties are not JSON Schema objects.
 */
export function nativeToolInputSchema(tool: Tool): z.ZodType {
  const properties: Record<string, SchemaEntry> = {};
  for (const [key, entry] of Object.entries(
    tool.inputSchema.properties ?? {},
  )) {
    if (SERVER_OWNED_KEYS.has(key)) continue;
    if (!isSchemaEntry(entry)) throw new Error("Invalid static tool schema");
    properties[key] = entry;
  }
  return z.fromJSONSchema({
    ...tool.inputSchema,
    properties,
    required: (tool.inputSchema.required ?? []).filter(
      (key) => !SERVER_OWNED_KEYS.has(key),
    ),
  });
}
