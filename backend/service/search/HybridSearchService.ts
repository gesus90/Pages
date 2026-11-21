import {
  ticketSearchText,
  wikiPageSearchText,
} from "@/backend/database/repositories/search/SearchSourceRepository";
import { VectorSearchUnavailableError } from "@/backend/database/repositories/search/SearchEmbeddingRepository";
import { createVisibleSourceQuery } from "@/backend/database/repositories/search/SourceSearchRepository";
import { logEvent } from "@/backend/logging/Logger";
import { parseSearchText } from "@/backend/service/wiki/WikiSearchQuery";

import {
  searchSimilarSections,
  splitIntoSections,
  ticketSourceVersion,
} from "./SearchIndexService";

import type {
  SearchEmbeddingHit,
  SearchEmbeddingRepository,
  SearchEmbeddingSourceKey,
  VisibleSourceQuery,
} from "@/backend/database/repositories/search/SearchEmbeddingRepository";
import type {
  CurrentSources,
  SourceSearchArea,
  SourceSearchRepository,
} from "@/backend/database/repositories/search/SourceSearchRepository";
import type { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import type {
  AgentSourceMatch,
  AgentSourceSearch,
  AgentSourceSection,
  AgentSourceType,
  AgentVectorSearchState,
} from "@/definition/AgentSourceSearch";
import type { EmbeddingModelFactory } from "./EmbeddingModels";

/** Fixed number of candidates each part of the search contributes before ranking. */
const KEYWORD_TICKET_CANDIDATES = 20;
const KEYWORD_PAGE_CANDIDATES = 20;
const VECTOR_CANDIDATES = 40;

/** Sections of one keyword hit handed over: those holding the most searched words. */
const KEYWORD_SECTIONS_PER_SOURCE = 2;

/** Offset of reciprocal rank fusion; 60 keeps one list from dominating. */
const RANK_OFFSET = 60;

/** Longest wait for the question embedding and the vector search. */
const DEFAULT_VECTOR_TIMEOUT_MILLISECONDS = 5000;

/** A ticket number as written in a question, such as `PAGE-12`. */
const TICKET_KEY =
  /(?<![\p{L}\p{N}_-])\p{L}[\p{L}\p{N}]*-\d+(?![\p{L}\p{N}_-])/gu;

/** Punctuation that ends or opens a word of a question, such as `?` or `(`. */
const WORD_EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/** The repositories and the model the search works with. */
export interface HybridSearchDependencies {
  readonly sources: Pick<
    SourceSearchRepository,
    "findTicketsByKey" | "searchTickets" | "readCurrentSources"
  >;
  readonly pages: Pick<WikiSearchRepository, "search">;
  readonly embeddings: Pick<SearchEmbeddingRepository, "searchExact">;
  /** Builds the model that embeds a question; `null` keeps to the keyword search. */
  readonly createModel: EmbeddingModelFactory | null;
  readonly vectorTimeoutMilliseconds?: number;
}

/**
 * The place of a section in the order of one search.
 * @remarks
 * The order is total: named ticket number, fused rank, source and section.
 * A page continues strictly after this place, so the same section is never
 * handed over twice and, while the sources stay unchanged, none is skipped.
 */
export interface HybridSearchPosition {
  /** Position of the ticket number in the question; `null` when none named it. */
  readonly keyRank: number | null;
  /** Fused rank of the keyword and vector lists. */
  readonly score: number;
  readonly sourceType: AgentSourceType;
  readonly sourceId: string;
  readonly sectionIndex: number;
}

/** What one search asks for. */
export interface HybridSearchRequest extends SourceSearchArea {
  readonly question: string;
  /** Most sections handed over. */
  readonly limit: number;
  /** Only sections of these kinds of sources; `null` keeps every kind. */
  readonly sourceTypes: readonly AgentSourceType[] | null;
  /** Hands over only sections after this place; `null` starts with the best. */
  readonly after: HybridSearchPosition | null;
}

/** One page of a search: the sections and the place to continue after. */
export interface HybridSearchResult extends Omit<
  AgentSourceSearch,
  "nextCursor"
> {
  /** Place of the last section when further sections follow; `null` otherwise. */
  readonly next: HybridSearchPosition | null;
}

/** Which sections of the ranking one page hands over. */
interface SectionWindow {
  readonly limit: number;
  readonly sourceTypes: readonly AgentSourceType[] | null;
  readonly after: HybridSearchPosition | null;
}

/** A visible source in its current revision. */
interface ResolvedSource {
  readonly sourceType: AgentSourceType;
  readonly sourceId: string;
  readonly title: string;
  readonly link: string;
  readonly ticketKey: string | null;
  readonly projectId: string | null;
  readonly version: string;
  /** Sections of the current text; `null` for assets, whose bytes the search does not read. */
  readonly sections: readonly string[] | null;
}

/** The vector part of a search: its state and its hits. */
interface VectorCandidates {
  readonly state: AgentVectorSearchState;
  readonly hits: readonly SearchEmbeddingHit[];
}

/** A section on its way to the ranking. */
interface RankedSection {
  readonly source: ResolvedSource;
  readonly sectionIndex: number;
  readonly text: string;
  readonly matches: Set<AgentSourceMatch>;
  score: number;
  /** Position of the ticket number in the question; `null` when none named it. */
  keyRank: number | null;
}

/** Raised when the vector part takes longer than the search may wait. */
class VectorSearchTimeoutError extends Error {
  public constructor() {
    super("The vector search did not answer in time.");
    this.name = "VectorSearchTimeoutError";
  }
}

function keyOf(source: SearchEmbeddingSourceKey): string {
  return `${source.sourceType}:${source.sourceId}`;
}

/**
 * Reads the ticket numbers and the keyword search words of a question.
 * @param question - The question as asked.
 * @returns Ticket keys in order without repetition, and words and phrases
 * as the wiki search reads them, without punctuation at their edges.
 */
function readQuestion(question: string): {
  readonly ticketKeys: readonly string[];
  readonly needles: readonly string[];
} {
  const ticketKeys = [
    ...new Set(
      Array.from(question.matchAll(TICKET_KEY), ([key]) => key.toUpperCase()),
    ),
  ];
  const { terms, phrases } = parseSearchText(question);
  const words = terms
    .map((term) => term.replace(WORD_EDGE_PUNCTUATION, ""))
    .filter((term) => term.length > 0);
  return { ticketKeys, needles: [...words, ...phrases] };
}

/** Waits for the vector part at most the given time; a late answer is dropped. */
async function withTimeout<T>(
  work: Promise<T>,
  milliseconds: number,
): Promise<T> {
  // A late rejection after the timeout must not become an unhandled one.
  void work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new VectorSearchTimeoutError()),
      milliseconds,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Names the reason the vector part failed, for the agent and the log. */
function unavailableReason(error: unknown): AgentVectorSearchState {
  if (error instanceof VectorSearchUnavailableError)
    return { status: "unavailable", reason: "vectorSearchUnavailable" };
  if (error instanceof VectorSearchTimeoutError)
    return { status: "unavailable", reason: "timeout" };
  return { status: "unavailable", reason: "embeddingFailed" };
}

/** Indexes the current sources by `type:id`, with links, versions and sections. */
function resolveSources(current: CurrentSources): Map<string, ResolvedSource> {
  const resolved: ResolvedSource[] = [
    ...current.tickets.map((ticket): ResolvedSource => ({
      sourceType: "ticket",
      sourceId: ticket.id,
      title: `${ticket.key}: ${ticket.title}`,
      link: `/tasks/${ticket.key}`,
      ticketKey: ticket.key,
      projectId: ticket.projectId,
      version: ticketSourceVersion(ticket),
      sections: splitIntoSections(ticketSearchText(ticket)),
    })),
    ...current.pages.map((page): ResolvedSource => ({
      sourceType: "wiki_page",
      sourceId: page.id,
      title: page.title,
      link: `/wiki/${page.id}`,
      ticketKey: null,
      projectId: page.projectId,
      version: String(page.revision),
      sections: splitIntoSections(wikiPageSearchText(page)),
    })),
    ...current.assets.map((asset): ResolvedSource => ({
      sourceType: "ticket_asset",
      sourceId: asset.id,
      title: asset.fileName,
      link: `/aufgaben/attachments/${asset.id}`,
      ticketKey: asset.ticketKey,
      projectId: asset.projectId,
      version: asset.checksum,
      sections: null,
    })),
  ];
  return new Map(resolved.map((source) => [keyOf(source), source]));
}

/** The place of a ranked section in the order of the search. */
function positionOf(section: RankedSection): HybridSearchPosition {
  return {
    keyRank: section.keyRank,
    score: section.score,
    sourceType: section.source.sourceType,
    sourceId: section.source.sourceId,
    sectionIndex: section.sectionIndex,
  };
}

/**
 * Orders two places of a search.
 * @returns Below zero when `left` comes first: exactly named ticket numbers
 * first, in question order, then by fused rank; equal ranks by source and section.
 */
function comparePositions(
  left: HybridSearchPosition,
  right: HybridSearchPosition,
): number {
  return (
    (left.keyRank ?? Number.MAX_SAFE_INTEGER) -
      (right.keyRank ?? Number.MAX_SAFE_INTEGER) ||
    right.score - left.score ||
    keyOf(left).localeCompare(keyOf(right)) ||
    left.sectionIndex - right.sectionIndex
  );
}

/** The section as handed over, with the link of its source. */
function toSourceSection(section: RankedSection): AgentSourceSection {
  return {
    sourceType: section.source.sourceType,
    sourceId: section.source.sourceId,
    title: section.source.title,
    link: section.source.link,
    ticketKey: section.source.ticketKey,
    projectId: section.source.projectId,
    sourceVersion: section.source.version,
    sectionIndex: section.sectionIndex,
    text: section.text,
    matchedBy: (["ticketKey", "keyword", "vector"] as const).filter((match) =>
      section.matches.has(match),
    ),
  };
}

/** The positions of the sections holding the most searched words, first section when none does. */
function keywordSectionIndexes(
  sections: readonly string[],
  needles: readonly string[],
): number[] {
  const lowered = needles.map((needle) => needle.toLowerCase());
  const matching = sections
    .map((text, index) => {
      const lower = text.toLowerCase();
      return {
        index,
        count: lowered.filter((needle) => lower.includes(needle)).length,
      };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .slice(0, KEYWORD_SECTIONS_PER_SOURCE)
    .map((entry) => entry.index);
  return matching.length > 0 ? matching : [0];
}

/** Collects the sections of every part of the search and orders them. */
class SectionRanking {
  private readonly sections = new Map<string, RankedSection>();

  /**
   * Adds a section found at a rank of one list.
   * @param source - The visible source in its current revision.
   * @param found - Position and text of the section, how it was found and its rank from 0.
   */
  public add(
    source: ResolvedSource,
    found: {
      readonly sectionIndex: number;
      readonly text: string;
      readonly match: AgentSourceMatch;
      readonly rank: number;
    },
  ): void {
    const key = `${keyOf(source)}:${String(found.sectionIndex)}`;
    const section: RankedSection = this.sections.get(key) ?? {
      source,
      sectionIndex: found.sectionIndex,
      text: found.text,
      matches: new Set<AgentSourceMatch>(),
      score: 0,
      keyRank: null,
    };
    section.matches.add(found.match);
    if (found.match === "ticketKey")
      section.keyRank = Math.min(section.keyRank ?? found.rank, found.rank);
    else section.score += 1 / (RANK_OFFSET + found.rank + 1);
    this.sections.set(key, section);
  }

  /**
   * Orders the sections and hands over one page of them.
   * @param window - Most sections, the kinds of sources and the place to continue after.
   * @returns The sections in the order of {@link comparePositions} and the
   * place of the last one when further sections follow.
   */
  public page(window: SectionWindow): {
    readonly sections: AgentSourceSection[];
    readonly next: HybridSearchPosition | null;
  } {
    const { after, sourceTypes } = window;
    const remaining = [...this.sections.values()]
      .filter(
        (section) =>
          sourceTypes === null ||
          sourceTypes.includes(section.source.sourceType),
      )
      .map((section) => ({ section, position: positionOf(section) }))
      .filter(
        (entry) =>
          after === null || comparePositions(entry.position, after) > 0,
      )
      .sort((left, right) => comparePositions(left.position, right.position));
    const selected = remaining.slice(0, window.limit);
    const last = selected.at(-1);
    return {
      sections: selected.map((entry) => toSourceSection(entry.section)),
      next: remaining.length > selected.length && last ? last.position : null,
    };
  }
}

/** Keyword hits of one kind of source, best first. */
interface KeywordHits {
  readonly sourceType: "ticket" | "wiki_page";
  readonly ids: readonly string[];
  readonly needles: readonly string[];
}

/** Adds the sections of keyword hits whose source is still visible. */
function addKeywordHits(
  ranking: SectionRanking,
  sources: ReadonlyMap<string, ResolvedSource>,
  keyword: KeywordHits,
): void {
  keyword.ids.forEach((sourceId, rank) => {
    const source = sources.get(
      keyOf({ sourceType: keyword.sourceType, sourceId }),
    );
    const sections = source?.sections;
    if (!source || !sections) return;
    for (const sectionIndex of keywordSectionIndexes(
      sections,
      keyword.needles,
    )) {
      const text = sections[sectionIndex];
      if (text !== undefined)
        ranking.add(source, { sectionIndex, text, match: "keyword", rank });
    }
  });
}

/**
 * Adds the vector hits whose source is visible and unchanged.
 * @param ranking - Sections collected so far.
 * @param sources - Visible candidate sources in their current revision.
 * @param hits - Hits of the vector search, closest first.
 * @returns How many hits were left out because the source changed since it
 * was indexed: another revision, or for tickets and pages another section text.
 */
function addVectorHits(
  ranking: SectionRanking,
  sources: ReadonlyMap<string, ResolvedSource>,
  hits: readonly SearchEmbeddingHit[],
): number {
  let staleSections = 0;
  hits.forEach((hit, rank) => {
    const source = sources.get(keyOf(hit));
    // Hidden since the vector search ran: neither handed over nor counted.
    if (!source) return;
    const current =
      source.sections === null
        ? hit.sectionText
        : source.sections[hit.sectionIndex];
    if (source.version !== hit.sourceVersion || current !== hit.sectionText) {
      staleSections += 1;
      return;
    }
    ranking.add(source, {
      sectionIndex: hit.sectionIndex,
      text: current,
      match: "vector",
      rank,
    });
  });
  return staleSections;
}

/**
 * Answers a question from the tickets, wiki pages and released ticket assets
 * the reader may see, by keyword search and vector search together.
 * @remarks
 * Every candidate comes from a query that applies the current visibility of
 * the reader, and the candidates are read again in their current revision
 * with the same visibility before they are ranked and limited. A stored
 * section of an older revision is left out, so only text the reader may see
 * now is handed over. Without a model, with a failing model or without
 * pgvector the keyword search answers alone.
 */
export class HybridSearchService {
  private readonly dependencies: HybridSearchDependencies;

  /**
   * Creates the search.
   * @param dependencies - Repositories, wiki search and the optional model.
   */
  public constructor(dependencies: HybridSearchDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Finds the sections that answer a question best.
   * @param request - Reader scope, optional project, question, limit, kinds
   * of sources and the place to continue after.
   * @returns One page of sections with source link and current revision,
   * the place to continue after, the state of the vector search and the
   * number of outdated vector hits left out.
   * @throws {RangeError} For an empty question.
   * @remarks
   * Every page ranks the same candidates anew, so a continuation keeps the
   * order of the first page while the sources and the vector state stay unchanged.
   */
  public async search(
    request: HybridSearchRequest,
  ): Promise<HybridSearchResult> {
    const question = request.question.trim();
    if (!question) throw new RangeError("The search question is empty.");
    const { ticketKeys, needles } = readQuestion(question);
    const visible = createVisibleSourceQuery(request);
    const [keyTickets, keywordTickets, keywordPages, vector] =
      await Promise.all([
        this.dependencies.sources.findTicketsByKey(request, ticketKeys),
        this.dependencies.sources.searchTickets(
          request,
          needles,
          KEYWORD_TICKET_CANDIDATES,
        ),
        this.searchPages(request, needles),
        this.vectorCandidates(question, visible),
      ]);
    const candidates: SearchEmbeddingSourceKey[] = [
      ...[...keyTickets, ...keywordTickets].map(
        (sourceId): SearchEmbeddingSourceKey => ({
          sourceType: "ticket",
          sourceId,
        }),
      ),
      ...keywordPages.map((sourceId): SearchEmbeddingSourceKey => ({
        sourceType: "wiki_page",
        sourceId,
      })),
      ...vector.hits,
    ];
    const sources = resolveSources(
      await this.dependencies.sources.readCurrentSources(visible, candidates),
    );
    const ranking = new SectionRanking();
    keyTickets.forEach((sourceId, rank) => {
      const source = sources.get(keyOf({ sourceType: "ticket", sourceId }));
      const text = source?.sections?.[0];
      if (source && text !== undefined)
        ranking.add(source, {
          sectionIndex: 0,
          text,
          match: "ticketKey",
          rank,
        });
    });
    addKeywordHits(ranking, sources, {
      sourceType: "ticket",
      ids: keywordTickets,
      needles,
    });
    addKeywordHits(ranking, sources, {
      sourceType: "wiki_page",
      ids: keywordPages,
      needles,
    });
    const staleSections = addVectorHits(ranking, sources, vector.hits);
    const { sections, next } = ranking.page(request);
    return { sections, next, vectorSearch: vector.state, staleSections };
  }

  private async searchPages(
    area: SourceSearchArea,
    needles: readonly string[],
  ): Promise<string[]> {
    if (needles.length === 0) return [];
    const { hits } = await this.dependencies.pages.search(area.scope, {
      terms: needles,
      phrases: [],
      titleOnly: false,
      area:
        area.projectId === null
          ? null
          : { scope: "project", projectId: area.projectId },
      underPageId: null,
      creatorId: null,
      editedFrom: null,
      editedTo: null,
      sort: "relevance",
      limit: KEYWORD_PAGE_CANDIDATES,
    });
    return hits.map((hit) => hit.id);
  }

  /**
   * Runs the vector part, or reports why it cannot take part.
   * @remarks
   * Every failure of the model or of pgvector, and a model slower than the
   * timeout, falls back to the keyword search instead of failing the search.
   */
  private async vectorCandidates(
    question: string,
    visibleSources: VisibleSourceQuery,
  ): Promise<VectorCandidates> {
    const { createModel, embeddings } = this.dependencies;
    if (!createModel)
      return {
        state: { status: "unavailable", reason: "notConfigured" },
        hits: [],
      };
    try {
      const retrieval = await withTimeout(
        searchSimilarSections(createModel(), embeddings, {
          question,
          visibleSources,
          limit: VECTOR_CANDIDATES,
        }),
        this.dependencies.vectorTimeoutMilliseconds ??
          DEFAULT_VECTOR_TIMEOUT_MILLISECONDS,
      );
      return {
        state: { status: "used", modelVersion: retrieval.modelVersion },
        hits: retrieval.hits,
      };
    } catch (error: unknown) {
      const state = unavailableReason(error);
      logEvent({
        level: "warn",
        event: "search.vector_unavailable",
        component: "HybridSearchService",
        message:
          "The vector search is unavailable; the keyword search answers alone",
        metadata: {
          kind: "search",
          reason: state.status === "unavailable" ? state.reason : null,
        },
        error,
      });
      return { state, hits: [] };
    }
  }
}
