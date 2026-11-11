import { AgentError } from "@/backend/error/AgentErrors";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";

import { CatalogHttpClient } from "./CatalogHttpClient";
import { parseCatalogPage } from "./CatalogParsing";

import type {
  ApiProviderId,
  ZaiAccountType,
} from "@/definition/AgentConnection";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

/** The most models one catalog keeps; a stored snapshot holds no more. */
const MAXIMUM_CATALOG_MODELS = 10_000;

/** One listing a catalog is read from, page by page. */
interface CatalogListing {
  readonly provider: ApiProviderId;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly zaiAccountType?: ZaiAccountType;
  readonly path: (cursor: string | null) => string;
}

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

// OpenRouter's listing of its speech-to-text models, the one place it names them (PAGE-294).
function transcriptionPath(cursor: string | null): string {
  return `/models?output_modalities=transcription&limit=1000&offset=${cursor ?? "0"}`;
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
    zaiAccountType?: ZaiAccountType,
  ): Promise<readonly AgentCatalogModel[]> {
    if (!supportsModelCatalog(provider))
      throw new AgentError("catalog_unsupported");
    const models = await this.collect({
      provider,
      apiKey,
      signal,
      zaiAccountType,
      path: (cursor) => catalogPath(provider, cursor),
    });
    return orderCatalog(provider, [...models.values()]);
  }

  /**
   * Adds OpenRouter's speech-to-text models to its listed catalog (PAGE-294).
   *
   * @param models - The OpenRouter catalog {@link CatalogProviderClient.list} returned.
   * @param apiKey - The key of the same connection.
   * @param signal - Cancels the listing.
   * @returns Both listings merged by model ID, in the catalog's order.
   *
   * @remarks
   * OpenRouter lists a model only under the output modality asked for, and
   * its text listing holds no transcription model, so these come from
   * `GET /models?output_modalities=transcription`. A model in both listings
   * is kept once, as the text listing states it. Like
   * {@link CatalogProviderClient.list}, a failed or excessive listing rejects
   * instead of publishing a partial catalog.
   */
  public async addTranscriptionModels(
    models: readonly AgentCatalogModel[],
    apiKey: string,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const transcription = await this.collect({
      provider: "openrouter",
      apiKey,
      signal,
      path: transcriptionPath,
    });
    const merged = new Map(models.map((model) => [model.id, model]));
    for (const [id, model] of transcription)
      if (!merged.has(id)) merged.set(id, model);
    if (merged.size > MAXIMUM_CATALOG_MODELS)
      throw new AgentError("catalog_limit_exceeded");
    return orderCatalog("openrouter", [...merged.values()]);
  }

  private async collect(
    listing: CatalogListing,
  ): Promise<ReadonlyMap<string, AgentCatalogModel>> {
    const { provider } = listing;
    const models = new Map<string, AgentCatalogModel>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let remainingBytes = 16 * 1024 * 1024;
    for (let pageNumber = 0; pageNumber < 32; pageNumber += 1) {
      const response = await this.http.get({
        provider,
        zaiAccountType: listing.zaiAccountType,
        apiKey: listing.apiKey,
        signal: listing.signal,
        path: listing.path(cursor),
        remainingBytes,
      });
      remainingBytes -= response.bytes;
      const page = parseCatalogPage(
        response.payload,
        provider,
        cursor === null ? 0 : Number(cursor),
      );
      for (const model of page.models) models.set(model.id, model);
      if (models.size > MAXIMUM_CATALOG_MODELS)
        throw new AgentError("catalog_limit_exceeded");
      cursor = page.nextCursor;
      if (cursor === null) return models;
      if (cursors.has(cursor)) throw new AgentError("provider_bad_response");
      cursors.add(cursor);
    }
    throw new AgentError("catalog_limit_exceeded");
  }
}
