import { AgentError } from "@/backend/error/AgentErrors";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";

import { CatalogHttpClient } from "./CatalogHttpClient";
import { parseCatalogPage } from "./CatalogParsing";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

function catalogPath(provider: ApiProviderId, cursor: string | null): string {
  // Text output is OpenRouter's documented default; the parser still checks
  // every entry's modalities, because this list includes image and audio output.
  if (provider === "openrouter")
    return `/models?output_modalities=text&limit=1000&offset=${cursor ?? "0"}`;
  if (provider === "google_ai_studio") {
    const suffix =
      cursor === null ? "" : `&pageToken=${encodeURIComponent(cursor)}`;
    return `/models?pageSize=1000${suffix}`;
  }
  if (provider === "anthropic") {
    const suffix =
      cursor === null ? "" : `&after_id=${encodeURIComponent(cursor)}`;
    return `/models?limit=1000${suffix}`;
  }
  return "/models";
}

// Anthropic documents its listing as newest first; other listings follow no stated order.
function orderCatalog(
  provider: ApiProviderId,
  models: AgentCatalogModel[],
): readonly AgentCatalogModel[] {
  if (provider === "anthropic") return models;
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

/** Provider-specific catalog adapters, using only documented listing endpoints. */
export class CatalogProviderClient {
  private readonly http: CatalogHttpClient;

  public constructor(http: CatalogHttpClient = new CatalogHttpClient()) {
    this.http = http;
  }

  /** Follows every page, rejecting cycles and excessive catalogs instead of publishing partial results. */
  public async list(
    provider: ApiProviderId,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    if (!supportsModelCatalog(provider))
      throw new AgentError("catalog_unsupported");
    const models = new Map<string, AgentCatalogModel>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let remainingBytes = 16 * 1024 * 1024;
    for (let pageNumber = 0; pageNumber < 32; pageNumber += 1) {
      const response = await this.http.get({
        provider,
        apiKey,
        signal,
        path: catalogPath(provider, cursor),
        remainingBytes,
      });
      remainingBytes -= response.bytes;
      const page = parseCatalogPage(
        response.payload,
        provider,
        cursor === null ? 0 : Number(cursor),
      );
      for (const model of page.models) models.set(model.id, model);
      if (models.size > 10_000) throw new AgentError("catalog_limit_exceeded");
      cursor = page.nextCursor;
      if (cursor === null) return orderCatalog(provider, [...models.values()]);
      if (cursors.has(cursor)) throw new AgentError("provider_bad_response");
      cursors.add(cursor);
    }
    throw new AgentError("catalog_limit_exceeded");
  }
}
