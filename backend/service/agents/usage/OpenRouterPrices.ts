import { z } from "zod";

import type { CodexPrice } from "@/definition/CodexPlanUsage";

const rate = z
  .union([z.string().trim().min(1).transform(Number), z.number()])
  .pipe(z.number().finite().nonnegative());
const catalogModel = z.object({
  id: z.string().min(1),
  pricing: z.object({
    prompt: rate,
    completion: rate,
    input_cache_read: rate.nullish(),
    internal_reasoning: rate.nullish(),
  }),
});
/** Stored validated public catalog; a timestamp identifies the exact price version. */
export const openRouterPricesSchema = z.object({
  fetchedAt: z.string(),
  models: z.array(catalogModel),
});
export type OpenRouterPrices = z.infer<typeof openRouterPricesSchema>;

/** Invalid model entries cannot become zero-price models. */
export function parseOpenRouterPrices(
  input: unknown,
  fetchedAt: string,
): OpenRouterPrices {
  const response = z.object({ data: z.array(z.unknown()) }).parse(input);
  const models = response.data.flatMap((entry) => {
    const parsed = catalogModel.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  if (models.length === 0) throw new Error("OpenRouter price catalog is empty");
  return { fetchedAt, models };
}

function canonicalModel(model: string): string {
  return model.replace(/^openai\//u, "").replace(/-\d{4}-\d{2}-\d{2}$/u, "");
}

/** Explicit mappings win; automatic matching only accepts one OpenAI catalog ID. */
export function resolveCodexPrice(
  catalog: OpenRouterPrices | null,
  model: string,
  mapping?: string,
): CodexPrice | null {
  if (!catalog) return null;
  const matches = catalog.models.filter((entry) =>
    mapping
      ? entry.id === mapping
      : entry.id.startsWith("openai/") &&
        canonicalModel(entry.id) === canonicalModel(model),
  );
  const exact = matches.find((entry) => entry.id === `openai/${model}`);
  const match = exact ?? (matches.length === 1 ? matches[0] : undefined);
  if (!match) return null;
  return {
    modelId: match.id,
    catalogAt: catalog.fetchedAt,
    prompt: match.pricing.prompt,
    completion: match.pricing.completion,
    cache: match.pricing.input_cache_read ?? match.pricing.prompt,
    reasoning: match.pricing.internal_reasoning ?? match.pricing.completion,
  };
}
