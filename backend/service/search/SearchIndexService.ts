import { createHash } from "node:crypto";
import { buffer } from "node:stream/consumers";

import {
  ticketSearchText,
  wikiPageSearchText,
} from "@/backend/database/repositories/search/SearchSourceRepository";
import { logEvent } from "@/backend/logging/Logger";
import { GENERIC_CONTENT_TYPE } from "@/backend/service/wiki/WikiFileTypes";

import type {
  IndexedSourceRecord,
  SearchEmbeddingHit,
  SearchEmbeddingRepository,
  SearchEmbeddingSection,
  SearchEmbeddingSourceKey,
  VisibleSourceQuery,
} from "@/backend/database/repositories/search/SearchEmbeddingRepository";
import type {
  ReleasedTicketAsset,
  SearchSourceRepository,
  SearchSourceState,
  TicketSearchSource,
} from "@/backend/database/repositories/search/SearchSourceRepository";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import type { EmbeddingModel } from "./EmbeddingModels";

/**
 * Names the way texts are cut into sections. It is part of every fingerprint,
 * so a changed sectioning embeds every source anew.
 */
const SECTIONING_VERSION = "sections-v1";

/** Longest section in UTF-16 code units; bge-m3 reads far more, but short sections retrieve precisely. */
const MAX_SECTION_LENGTH = 1200;

/** Largest asset the indexer reads as text; larger released assets are skipped. */
const MAX_ASSET_TEXT_BYTES = 1024 * 1024;

/** A Markdown heading starts a new section. */
const HEADING = /^#{1,6}\s/;

/** The services the indexer works with. */
export interface SearchIndexDependencies {
  readonly embeddings: SearchEmbeddingRepository;
  readonly sources: SearchSourceRepository;
  /** Opens the bytes of a ticket asset without a person, as the asset change readers do. */
  readonly assets: Pick<TaskAttachmentService, "openStored">;
  readonly model: EmbeddingModel;
}

/** What one indexing run did. */
export interface SearchIndexRunReport {
  /** Model version of the inventory this run worked on. */
  readonly modelVersion: string;
  /** Sources embedded anew because they were new or changed. */
  readonly indexedSources: number;
  /** Sources whose fingerprint matched and that were not read. */
  readonly unchangedSources: number;
  /** Sources removed from every inventory because they no longer exist or were withdrawn. */
  readonly removedSources: number;
  /** Sections written in this run. */
  readonly writtenSections: number;
  /** Released assets recorded without sections because they are no UTF-8 text. */
  readonly skippedAssets: number;
}

/** A question for the vector search. */
export interface SearchQuestion {
  readonly question: string;
  /** The `(source_type, source_id)` pairs the reader may see. */
  readonly visibleSources: VisibleSourceQuery;
  readonly limit: number;
}

/**
 * The retrieval format handed to answering components: every hit names the
 * source, its version and the section.
 */
export interface SearchRetrieval {
  /** Model version that embedded the question and every compared section. */
  readonly modelVersion: string;
  readonly hits: readonly SearchEmbeddingHit[];
}

/** One source read for embedding. */
interface PreparedSource {
  readonly record: IndexedSourceRecord;
  /** Text to cut into sections; `null` records the source without sections. */
  readonly text: string | null;
}

/** Mutable counters of a run. */
interface RunCounters {
  indexedSources: number;
  unchangedSources: number;
  writtenSections: number;
  skippedAssets: number;
}

function keyOf(source: SearchEmbeddingSourceKey): string {
  return `${source.sourceType}:${source.sourceId}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Names the current revision of a ticket.
 * @param ticket - Key, title and description of the ticket.
 * @returns `sha256:<hash of the indexed text>`; tickets have no revision
 * counter, so the hash of the text is their revision.
 */
export function ticketSourceVersion(ticket: TicketSearchSource): string {
  return `sha256:${sha256(ticketSearchText(ticket))}`;
}

function fingerprintOf(contentHash: string): string {
  return `${SECTIONING_VERSION}:${contentHash}`;
}

/** Cuts the last position before `limit` where a long paragraph may be split. */
function findCut(text: string, limit: number): number {
  const window = text.slice(0, limit);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("\n"),
  );
  if (sentenceEnd >= limit / 2) return sentenceEnd + 1;
  const space = window.lastIndexOf(" ");
  if (space >= limit / 2) return space + 1;
  // Never split a surrogate pair, which would store half a character.
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

function splitLongParagraph(paragraph: string): string[] {
  const parts: string[] = [];
  let rest = paragraph;
  while (rest.length > MAX_SECTION_LENGTH) {
    const cut = findCut(rest, MAX_SECTION_LENGTH);
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  parts.push(rest);
  return parts.filter((part) => part.length > 0);
}

/**
 * Cuts a text into sections of whole paragraphs.
 * @param text - Text of a source.
 * @returns Sections in text order. A Markdown heading starts a new section,
 * except right after the title, the first paragraph; a paragraph longer than
 * a section is split at sentence ends or spaces.
 * @remarks
 * The search cuts the current text of a source the same way, so a section
 * index found by the keyword search names the same section as a stored one.
 */
export function splitIntoSections(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n|\n(?=#{1,6}\s)/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap(splitLongParagraph);
  const sections: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    // The title alone says little; it stays with the first heading's section.
    const isTitleOnly = sections.length === 0 && current === paragraphs[0];
    const isFull =
      current.length + 2 + paragraph.length > MAX_SECTION_LENGTH ||
      (HEADING.test(paragraph) && !isTitleOnly);
    if (current && isFull) {
      sections.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Finds the sections closest to a question among the visible sources.
 * @param model - Model that embeds the question; its version selects the inventory.
 * @param embeddings - Inventory and exact search.
 * @param request - Question, visible sources and number of hits.
 * @returns The model version and the hits with source, version and section.
 * @throws {VectorSearchUnavailableError} Without an activated pgvector.
 * @throws {RangeError} For an empty question.
 */
export async function searchSimilarSections(
  model: EmbeddingModel,
  embeddings: Pick<SearchEmbeddingRepository, "searchExact">,
  request: SearchQuestion,
): Promise<SearchRetrieval> {
  const question = request.question.trim();
  if (!question) throw new RangeError("The search question is empty.");
  const modelVersion = await model.resolveVersion();
  const [embedding] = await model.embed([question]);
  if (!embedding) throw new Error("The embedding model returned no vector.");
  const hits = await embeddings.searchExact({
    modelVersion,
    embedding,
    visibleSources: request.visibleSources,
    limit: request.limit,
  });
  return { modelVersion, hits };
}

/**
 * Embeds tickets, wiki pages and released ticket assets into the search
 * inventory of one model version and answers questions with that version.
 * @remarks
 * A run compares the fingerprints of all current sources with what the
 * inventory recorded. It embeds new and changed sources, replaces all of
 * their sections at once, and removes sources that were deleted, moved to
 * the trash or whose asset release was withdrawn, from every model version.
 * A repeated run therefore changes nothing and writes no duplicates. Each
 * source is written in its own transaction, so an interrupted run continues
 * where it stopped.
 */
export class SearchIndexService {
  private readonly embeddings: SearchEmbeddingRepository;
  private readonly sources: SearchSourceRepository;
  private readonly assets: Pick<TaskAttachmentService, "openStored">;
  private readonly model: EmbeddingModel;

  /**
   * Creates the indexer.
   * @param dependencies - Repositories, asset reader and embedding model.
   */
  public constructor(dependencies: SearchIndexDependencies) {
    this.embeddings = dependencies.embeddings;
    this.sources = dependencies.sources;
    this.assets = dependencies.assets;
    this.model = dependencies.model;
  }

  /**
   * Brings the inventory of the model's version up to date once.
   * @returns What the run indexed, kept and removed.
   * @throws {EmbeddingModelChangedError} When the model revision changes
   * during the run; sources written before stay consistent.
   */
  public async runOnce(): Promise<SearchIndexRunReport> {
    const modelVersion = await this.model.resolveVersion();
    const states = await this.sources.listSourceStates();
    const removedSources = await this.removeVanished(
      new Set(states.map(keyOf)),
    );
    const recorded = new Map(
      (await this.embeddings.listIndexedSources(modelVersion)).map((source) => [
        keyOf(source),
        source.fingerprint,
      ]),
    );
    const counters: RunCounters = {
      indexedSources: 0,
      unchangedSources: 0,
      writtenSections: 0,
      skippedAssets: 0,
    };
    for (const state of states) {
      if (recorded.get(keyOf(state)) === fingerprintOf(state.contentHash)) {
        counters.unchangedSources += 1;
        continue;
      }
      await this.indexSource(state, modelVersion, counters);
    }
    return { modelVersion, removedSources, ...counters };
  }

  /**
   * Finds the sections closest to a question among the visible sources.
   * @param request - Question, visible sources and number of hits.
   * @returns The model version and the hits with source, version and section.
   * @throws {VectorSearchUnavailableError} Without an activated pgvector.
   * @throws {RangeError} For an empty question.
   */
  public async search(request: SearchQuestion): Promise<SearchRetrieval> {
    return searchSimilarSections(this.model, this.embeddings, request);
  }

  /**
   * Removes the inventory of a model version that is no longer used.
   * @param modelVersion - Version whose sections and records go.
   * @throws When it is the version the configured model serves.
   */
  public async removeModelInventory(modelVersion: string): Promise<void> {
    if (modelVersion === (await this.model.resolveVersion()))
      throw new Error("The inventory of the current model stays.");
    await this.embeddings.removeModelInventory(modelVersion);
  }

  private async removeVanished(current: ReadonlySet<string>): Promise<number> {
    const stored = await this.embeddings.listStoredSourceKeys();
    const vanished = stored.filter((source) => !current.has(keyOf(source)));
    for (const source of vanished)
      await this.embeddings.removeSource(source.sourceType, source.sourceId);
    return vanished.length;
  }

  private async indexSource(
    state: SearchSourceState,
    modelVersion: string,
    counters: RunCounters,
  ): Promise<void> {
    const prepared = await this.prepare(state, modelVersion);
    if (!prepared) {
      // Deleted between listing and reading; the next run would remove it too.
      await this.embeddings.removeSource(state.sourceType, state.sourceId);
      return;
    }
    if (prepared.text === null) counters.skippedAssets += 1;
    const texts =
      prepared.text === null ? [] : splitIntoSections(prepared.text);
    const vectors = await this.model.embed(texts);
    const sections: SearchEmbeddingSection[] = texts.map(
      (sectionText, sectionIndex) => ({
        sectionIndex,
        sectionText,
        embedding: vectors[sectionIndex] ?? [],
      }),
    );
    await this.embeddings.replaceIndexedSource(prepared.record, sections);
    counters.indexedSources += 1;
    counters.writtenSections += sections.length;
  }

  private async prepare(
    state: SearchSourceState,
    modelVersion: string,
  ): Promise<PreparedSource | null> {
    if (state.sourceType === "ticket")
      return this.prepareTicket(state.sourceId, modelVersion);
    if (state.sourceType === "wiki_page")
      return this.prepareWikiPage(state.sourceId, modelVersion);
    return this.prepareAsset(state.sourceId, modelVersion);
  }

  private async prepareTicket(
    id: string,
    modelVersion: string,
  ): Promise<PreparedSource | null> {
    const ticket = await this.sources.readTicket(id);
    if (!ticket) return null;
    const text = ticketSearchText(ticket);
    const contentHash = sha256(text);
    return {
      record: {
        sourceType: "ticket",
        sourceId: id,
        sourceVersion: ticketSourceVersion(ticket),
        modelVersion,
        fingerprint: fingerprintOf(contentHash),
      },
      text,
    };
  }

  private async prepareWikiPage(
    id: string,
    modelVersion: string,
  ): Promise<PreparedSource | null> {
    const page = await this.sources.readWikiPage(id);
    if (!page) return null;
    const text = wikiPageSearchText(page);
    return {
      record: {
        sourceType: "wiki_page",
        sourceId: id,
        sourceVersion: String(page.revision),
        modelVersion,
        fingerprint: fingerprintOf(sha256(text)),
      },
      text,
    };
  }

  private async prepareAsset(
    id: string,
    modelVersion: string,
  ): Promise<PreparedSource | null> {
    const asset = await this.sources.readReleasedAsset(id);
    if (!asset) return null;
    const content = await this.readAssetText(asset);
    return {
      record: {
        sourceType: "ticket_asset",
        sourceId: id,
        sourceVersion: asset.checksum,
        modelVersion,
        fingerprint: fingerprintOf(asset.checksum),
      },
      text: content === null ? null : `${asset.fileName}\n\n${content}`,
    };
  }

  /**
   * Reads a released asset as UTF-8 text.
   * @returns The text, or `null` for a recognized binary type, a missing or
   * too large file, invalid UTF-8 or a NUL character.
   */
  private async readAssetText(
    asset: ReleasedTicketAsset,
  ): Promise<string | null> {
    // Text has no signature; every recognized format is binary or markup.
    if (asset.contentType !== GENERIC_CONTENT_TYPE)
      return this.skipAsset(asset, "unsupportedFormat");
    const opened = await this.assets.openStored(asset.id);
    if (!opened) return this.skipAsset(asset, "fileMissing");
    if (opened.attachment.size > MAX_ASSET_TEXT_BYTES) {
      opened.stream.destroy();
      return this.skipAsset(asset, "tooLarge");
    }
    const bytes = await buffer(opened.stream);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\u0000")) return this.skipAsset(asset, "notText");
      return text;
    } catch (error: unknown) {
      if (error instanceof TypeError) return this.skipAsset(asset, "notText");
      throw error;
    }
  }

  private skipAsset(asset: ReleasedTicketAsset, reason: string): null {
    logEvent({
      level: "info",
      event: "search_index.asset_skipped",
      component: "SearchIndexService",
      // The log keeps only allowed metadata keys, so the identifier goes into the message.
      message: `Released ticket asset ${asset.id} is no readable UTF-8 text and gets no sections`,
      metadata: { kind: "ticket_asset", reason },
    });
    return null;
  }
}
