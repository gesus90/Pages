import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { ticketSourceVersion } from "../../backend/service/search/SearchIndexService";

import { QUESTIONS } from "./acceptance-data";

import type { EmbeddingModelFactory } from "../../backend/service/search/EmbeddingModels";
import type {
  AgentSourceSearch,
  AgentSourceSection,
} from "../../definition/AgentSourceSearch";
import type { AcceptanceContext } from "./acceptance-context";
import type { AcceptanceQuestion, ExpectedSource } from "./acceptance-data";

/** Sections a hit must be among. */
const TOP = 5;

/** A search mode of the comparison. */
export interface SearchMode {
  readonly name: "keyword" | "hybrid";
  /** `null` is the keyword search alone. */
  readonly createModel: EmbeddingModelFactory | null;
}

/** The result of one question in one mode. */
export interface QuestionResult {
  readonly id: string;
  readonly language: "de" | "en";
  readonly form: AcceptanceQuestion["form"];
  readonly question: string;
  readonly expected: readonly string[];
  /** Sources of the first five sections, as `ticketKey`, page title or file name. */
  readonly top: readonly string[];
  /** Position from 1 of the first expected source; `null` when none is among the first five. */
  readonly hitRank: number | null;
  /** Share of the first five sections whose source answers the question. */
  readonly precision: number;
  readonly vectorSearch: string;
  readonly staleSections: number;
  readonly latenciesMilliseconds: readonly number[];
}

/** A share with its sample size. */
export interface Rate {
  readonly hits: number;
  readonly total: number;
  readonly rate: number;
}

/** Latency figures of a mode. */
export interface LatencySummary {
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** The measurement of one mode over the whole question set. */
export interface ModeMeasurement {
  readonly mode: SearchMode["name"];
  readonly repetitions: number;
  readonly top5: Rate;
  readonly byLanguage: Readonly<Record<string, Rate>>;
  readonly byForm: Readonly<Record<string, Rate>>;
  readonly meanReciprocalRank: number;
  readonly precisionAt5: number;
  readonly latency: LatencySummary;
  readonly links: SourceLinkQuality;
  readonly vectorStates: Readonly<Record<string, number>>;
  readonly questions: readonly QuestionResult[];
}

/** How the source links of the returned sections resolved. */
export interface SourceLinkQuality {
  readonly checked: number;
  readonly valid: number;
  readonly problems: readonly string[];
}

/** The reference a section's source is named by in the question set. */
export function referenceOf(section: AgentSourceSection): string {
  return section.sourceType === "ticket"
    ? (section.ticketKey ?? section.title)
    : section.title;
}

function sourceName(source: ExpectedSource): string {
  return `${source.sourceType}:${source.reference}`;
}

function sectionName(section: AgentSourceSection): string {
  return `${section.sourceType}:${referenceOf(section)}`;
}

function rate(hits: number, total: number): Rate {
  return { hits, total, rate: total === 0 ? 0 : hits / total };
}

/**
 * Reads a percentile by the nearest-rank method.
 * @param sorted - Values in ascending order.
 * @param percentile - From 0 to 100.
 * @returns The value, 0 without values.
 */
function nearestRank(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] ?? 0;
}

function summarizeLatency(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    samples: sorted.length,
    p50: round(nearestRank(sorted, 50)),
    p95: round(nearestRank(sorted, 95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

function vectorStateName(result: AgentSourceSearch): string {
  return result.vectorSearch.status === "used"
    ? "used"
    : result.vectorSearch.reason;
}

function evaluate(
  question: AcceptanceQuestion,
  result: AgentSourceSearch,
  latencies: readonly number[],
): QuestionResult {
  const top = result.sections.slice(0, TOP);
  const expected = new Set(question.expected.map(sourceName));
  const relevant = new Set([
    ...expected,
    ...question.alsoRelevant.map(sourceName),
  ]);
  const hitIndex = top.findIndex((section) =>
    expected.has(sectionName(section)),
  );
  return {
    id: question.id,
    language: question.language,
    form: question.form,
    question: question.question,
    expected: question.expected.map((source) => source.reference),
    top: top.map(referenceOf),
    hitRank: hitIndex === -1 ? null : hitIndex + 1,
    precision:
      top.length === 0
        ? 0
        : top.filter((section) => relevant.has(sectionName(section))).length /
          top.length,
    vectorSearch: vectorStateName(result),
    staleSections: result.staleSections,
    latenciesMilliseconds: latencies,
  };
}

async function checkTicketLink(
  context: AcceptanceContext,
  reader: string,
  section: AgentSourceSection,
): Promise<string | null> {
  if (section.link !== `/tasks/${section.ticketKey ?? ""}`)
    return `ticket link ${section.link}`;
  const { tasks, actor } = await context.tasks(reader);
  const detail = await tasks.getById(actor, section.sourceId);
  if (detail.key !== section.ticketKey)
    return `ticket ${section.link} names ${detail.key}`;
  return ticketSourceVersion(detail) === section.sourceVersion
    ? null
    : `ticket ${section.link} has another revision`;
}

async function checkAssetLink(
  context: AcceptanceContext,
  reader: string,
  section: AgentSourceSection,
): Promise<string | null> {
  if (section.link !== `/aufgaben/attachments/${section.sourceId}`)
    return `asset link ${section.link}`;
  const bytes = await context.download(reader, section.sourceId);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return checksum === section.sourceVersion
    ? null
    : `asset ${section.link} has another checksum`;
}

async function checkPageLink(
  context: AcceptanceContext,
  section: AgentSourceSection,
): Promise<string | null> {
  if (section.link !== `/wiki/${section.sourceId}`)
    return `page link ${section.link}`;
  const rows = await context.db.query(
    "SELECT revision FROM wiki_pages WHERE id = $id AND deleted_at IS NULL;",
    { id: section.sourceId },
  );
  return String(rows[0]?.[0]) === section.sourceVersion
    ? null
    : `page ${section.link} has another revision`;
}

/**
 * Checks that the link of a section resolves for its reader to the source in the handed-over revision.
 * @param context - Services of the database.
 * @param reader - The person who searched.
 * @param section - A returned section.
 * @returns A problem description, or `null` when the link is valid.
 * @remarks
 * A ticket link must open the ticket for the reader with the same text hash,
 * an asset link must download for the reader with the handed-over SHA-256,
 * and a page link must name a page in the handed-over revision.
 */
export async function checkSourceLink(
  context: AcceptanceContext,
  reader: string,
  section: AgentSourceSection,
): Promise<string | null> {
  try {
    if (section.sourceType === "ticket")
      return await checkTicketLink(context, reader, section);
    if (section.sourceType === "ticket_asset")
      return await checkAssetLink(context, reader, section);
    return await checkPageLink(context, section);
  } catch (error: unknown) {
    return `${section.link}: ${error instanceof Error ? error.message : "failed"}`;
  }
}

async function checkLinks(
  context: AcceptanceContext,
  checks: readonly {
    readonly reader: string;
    readonly sections: readonly AgentSourceSection[];
  }[],
): Promise<SourceLinkQuality> {
  const problems: string[] = [];
  let checked = 0;
  for (const check of checks)
    for (const section of check.sections) {
      checked += 1;
      const problem = await checkSourceLink(context, check.reader, section);
      if (problem !== null) problems.push(problem);
    }
  return { checked, valid: checked - problems.length, problems };
}

function groupRates(
  results: readonly QuestionResult[],
  keyOf: (result: QuestionResult) => string,
): Record<string, Rate> {
  const groups = new Map<string, QuestionResult[]>();
  for (const result of results)
    groups.set(keyOf(result), [...(groups.get(keyOf(result)) ?? []), result]);
  const rates: Record<string, Rate> = {};
  for (const [key, members] of groups)
    rates[key] = rate(
      members.filter((member) => member.hitRank !== null).length,
      members.length,
    );
  return rates;
}

/**
 * Asks every question of the fixed set in one mode and measures hits, latency and source quality.
 * @param context - Services of the indexed database.
 * @param mode - Keyword search alone or hybrid search.
 * @param repetitions - Timed runs per question after one untimed warm-up run.
 * @returns The measurement with the sample sizes.
 */
export async function measureMode(
  context: AcceptanceContext,
  mode: SearchMode,
  repetitions: number,
): Promise<ModeMeasurement> {
  const results: QuestionResult[] = [];
  const linkChecks: {
    reader: string;
    sections: readonly AgentSourceSection[];
  }[] = [];
  for (const question of QUESTIONS) {
    const search = {
      reader: question.reader,
      question: question.question,
      limit: TOP,
    };
    const first = await context.search(mode.createModel, search);
    const latencies: number[] = [];
    for (let run = 0; run < repetitions; run += 1) {
      const started = performance.now();
      await context.search(mode.createModel, search);
      latencies.push(performance.now() - started);
    }
    results.push(evaluate(question, first, latencies));
    linkChecks.push({ reader: question.reader, sections: first.sections });
  }
  const vectorStates: Record<string, number> = {};
  for (const result of results)
    vectorStates[result.vectorSearch] =
      (vectorStates[result.vectorSearch] ?? 0) + 1;
  return {
    mode: mode.name,
    repetitions,
    top5: rate(
      results.filter((result) => result.hitRank !== null).length,
      results.length,
    ),
    byLanguage: groupRates(results, (result) => result.language),
    byForm: groupRates(results, (result) => result.form),
    meanReciprocalRank:
      results.reduce(
        (sum, result) =>
          sum + (result.hitRank === null ? 0 : 1 / result.hitRank),
        0,
      ) / results.length,
    precisionAt5:
      results.reduce((sum, result) => sum + result.precision, 0) /
      results.length,
    latency: summarizeLatency(
      results.flatMap((result) => result.latenciesMilliseconds),
    ),
    links: await checkLinks(context, linkChecks),
    vectorStates,
    questions: results,
  };
}

/**
 * Lists the sources of the first sections of every question, to compare two databases.
 * @param context - Services of a database.
 * @param mode - The search mode.
 * @returns One line per question: its identifier and the sections as `type:id#section`.
 */
export async function fingerprintAnswers(
  context: AcceptanceContext,
  mode: SearchMode,
): Promise<string[]> {
  const lines: string[] = [];
  for (const question of QUESTIONS) {
    const result = await context.search(mode.createModel, {
      reader: question.reader,
      question: question.question,
      limit: TOP,
    });
    lines.push(
      `${question.id} ${vectorStateName(result)} ${result.sections
        .map(
          (section) =>
            `${section.sourceType}:${section.sourceId}@${section.sourceVersion}#${String(section.sectionIndex)}`,
        )
        .join(" ")}`,
    );
  }
  return lines;
}
