import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";

/** Administrator model overrides; only public catalog identifiers are stored. */
export const codexPriceMappingsSchema = z
  .record(
    z.string().regex(/^[^\s\p{Cc}=]{1,200}$/u),
    z.string().regex(/^[a-zA-Z0-9._:/-]{1,200}$/u),
  )
  .refine((mappings) => Object.keys(mappings).length <= 500);

/** Reads the connection form's one-model-per-line mapping, preserving absent updates. */
export function readCodexPriceMappings(
  input: unknown,
): Readonly<Record<string, string>> | undefined {
  if (input === undefined) return undefined;
  let mappings: unknown = input;
  if (typeof input === "string") {
    if (input.length > 100_000)
      throw new AgentError("codex_price_mapping_invalid");
    const entries = input
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("=").map((part) => part.trim()));
    if (
      entries.some((entry) => entry.length !== 2) ||
      new Set(entries.map((entry) => entry[0])).size !== entries.length
    )
      throw new AgentError("codex_price_mapping_invalid");
    mappings = Object.fromEntries(entries);
  }
  const parsed = codexPriceMappingsSchema.safeParse(mappings);
  if (!parsed.success) throw new AgentError("codex_price_mapping_invalid");
  return parsed.data;
}
