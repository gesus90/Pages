import { z } from "zod";

/** Only explicit Anthropic catalog IDs may override automatic model matching. */
export const claudePriceModelsSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9._/\[\]-]+$/u),
    z
      .string()
      .max(200)
      .regex(/^anthropic\/[a-zA-Z0-9._:-]+$/u),
  )
  .refine((models) => Object.keys(models).length <= 200);

/** Canonical model/version spelling, independent of context and dated deployment suffixes. */
export function canonicalClaudeModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/^anthropic\//u, "")
    .replace(/\[\d+m\]$/u, "")
    .replace(/-\d{8}$/u, "")
    .replaceAll(".", "-")
    .replace(/-(\d+)-0$/u, "-$1");
}
