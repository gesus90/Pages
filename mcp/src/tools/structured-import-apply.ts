import { STRUCTURED_MANIFEST_SCHEMA } from "./structured-import-plan.js";
import { ADDITIVE_ANNOTATIONS, IDENTIFIER_SCHEMA } from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Applies a confirmed structured manifest; the outcome of every source persists on its own. */
export const STRUCTURED_IMPORT_APPLY_TOOL: Tool = {
  name: "apply_structured_import",
  title: "Apply structured import",
  description:
    "Applies a plan_structured_import manifest: milestones first, then tickets with parents before children, then milestone dependencies, then wiki pages (A9.8 rules) with relative image and file links rewritten to /agent-assets/<assetId> and the assets linked to the page. Repeat the exact manifest and its fingerprint; a plan with errors is refused (nothing written), a stale fingerprint returns CONFLICT. Supply a new operationId per import; reuse it unchanged after response loss or interruption to recover the same run and the same IDs. Per source the result is created, skipped (unchanged) or conflict (source_changed, target_changed, target_removed, or blocked by an object it builds on) or failed; nothing is overwritten and every source commits its object, mapping and outcome together. A second run of an unchanged manifest creates nothing. Tickets follow the Pages GitHub setting of their project; nothing is forced. Rights and credentials are rechecked for every source. Timeout 30 seconds; repeat after a timeout.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["operationId", "fingerprint", "manifest"],
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      manifest: STRUCTURED_MANIFEST_SCHEMA,
    },
  },
  annotations: ADDITIVE_ANNOTATIONS,
};
