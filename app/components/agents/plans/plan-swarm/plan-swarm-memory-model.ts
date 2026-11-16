import { PLAN_SWARM_MEMORY_REDACTED } from "@/definition/AgentPlanSwarmMemory";

import type {
  AgentPlanSwarmMemoryEntry,
  AgentPlanSwarmMemoryRejection,
  AgentPlanSwarmMemoryView,
} from "@/definition/AgentPlanSwarmMemory";

/** The sections the snapshot of the memory tab is divided into. */
export type PlanSwarmMemorySection =
  "decisions" | "interfaces" | "blockers" | "findings";

const SECTION_KINDS: Readonly<
  Record<PlanSwarmMemorySection, readonly string[]>
> = {
  decisions: ["decision"],
  interfaces: ["interface"],
  blockers: ["blocker"],
  findings: ["finding", "proposal", "handoff", "status"],
};

/** The sections in the order the tab shows them. */
export const PLAN_SWARM_MEMORY_SECTIONS: readonly PlanSwarmMemorySection[] = [
  "decisions",
  "interfaces",
  "blockers",
  "findings",
];

/**
 * The badge colors of each kind; the kind name always stands in the badge,
 * so the color never carries the meaning alone.
 */
const KIND_TONES: Readonly<Record<string, string>> = {
  decision: "bg-plan-swarm-subtle text-plan-swarm",
  interface: "bg-info-subtle text-info",
  blocker: "bg-warning-subtle text-warning",
};

const NEUTRAL_TONE = "bg-muted text-muted-foreground";

/** The badge classes of an entry kind. */
export function planSwarmKindTone(kind: string): string {
  return KIND_TONES[kind] ?? NEUTRAL_TONE;
}

/** The current entries of one section, oldest first; superseded entries are left out. */
export function planSwarmSectionEntries(
  memory: AgentPlanSwarmMemoryView,
  section: PlanSwarmMemorySection,
): readonly AgentPlanSwarmMemoryEntry[] {
  return memory.entries.filter(
    (entry) =>
      entry.supersededBy === null &&
      SECTION_KINDS[section].includes(entry.kind),
  );
}

/** How far an agent has read, and how many revisions it lags behind. */
export interface PlanSwarmReadLag {
  readonly agent: string;
  readonly revision: number;
  /** Revisions behind the newest; 0 when up to date. */
  readonly behind: number;
}

/** The read state of the main model and every helper, the main model first. */
export function planSwarmReadLags(
  memory: AgentPlanSwarmMemoryView,
): readonly PlanSwarmReadLag[] {
  return [...memory.reads]
    .sort((left, right) => agentOrder(left.agent) - agentOrder(right.agent))
    .map((read) => ({
      agent: read.agent,
      revision: read.revision,
      behind: Math.max(0, memory.revision - read.revision),
    }));
}

function agentOrder(agent: string): number {
  return agent === "main" ? 0 : Number(agent.slice(1));
}

/** One line of the activity tab: a stored entry or a refused one. */
export type PlanSwarmActivity =
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly at: string;
      readonly entry: AgentPlanSwarmMemoryEntry;
    }
  | {
      readonly kind: "rejection";
      readonly key: string;
      readonly at: string;
      readonly rejection: AgentPlanSwarmMemoryRejection;
    };

/** Every entry and refused entry, newest first. */
export function planSwarmActivities(
  memory: AgentPlanSwarmMemoryView,
): readonly PlanSwarmActivity[] {
  const activities: PlanSwarmActivity[] = [
    ...memory.entries.map((entry): PlanSwarmActivity => ({
      kind: "entry",
      key: `r${String(entry.revision)}`,
      at: entry.createdAt,
      entry,
    })),
    ...memory.rejections.map((rejection, index): PlanSwarmActivity => ({
      kind: "rejection",
      key: `x${String(index)}`,
      at: rejection.createdAt,
      rejection,
    })),
  ];
  return activities.sort((left, right) => right.at.localeCompare(left.at));
}

/** A part of an entry text: plain text or a blacked out secret. */
export interface PlanSwarmTextPart {
  readonly key: string;
  readonly isRedacted: boolean;
  readonly text: string;
}

/** Splits a text at the marks where Pages blacked out a secret. */
export function planSwarmTextParts(text: string): readonly PlanSwarmTextPart[] {
  return text
    .split(PLAN_SWARM_MEMORY_REDACTED)
    .flatMap((part, index) => [
      ...(index > 0
        ? [{ key: `m${String(index)}`, isRedacted: true, text: "" }]
        : []),
      ...(part
        ? [{ key: `t${String(index)}`, isRedacted: false, text: part }]
        : []),
    ]);
}

/** The clock time of an ISO timestamp, as the activity tab shows it. */
export function planSwarmTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** The download address of one export file of a swarm node's memory. */
export function planSwarmMemoryAddress(
  runId: string,
  stepId: string,
  file?: string,
): string {
  const base = `/agent-api/plan-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/swarm-memory`;
  return file ? `${base}/${encodeURIComponent(file)}` : base;
}
