import { useEffect, useRef, useState } from "react";

import { sessionAddress } from "./console-target";
import { readSessionPage } from "./session-client";

import type {
  AgentSessionEvent,
  AgentSessionKey,
} from "@/definition/AgentSessionJournal";

/** How often a running session reads its miniature again, in milliseconds. */
export const PREVIEW_INTERVAL_MS = 30_000;

/** How long after its end a session may still receive history from the runner, in milliseconds. */
const IMPORT_GRACE_MS = 10_000;

/** A session whose miniature the swarm console keeps. */
export interface SwarmPreviewTarget {
  readonly stepId: string;
  /** The session to read; `null` for one that did not start. */
  readonly key: AgentSessionKey | null;
  /** Whether the session can still produce output. */
  readonly isActive: boolean;
  /** When the session ended, in milliseconds since the epoch; `null` while it runs or when unknown. */
  readonly endedAt: number | null;
}

/** The newest events of a session and when they were read. */
export interface SwarmPreview {
  readonly events: readonly AgentSessionEvent[];
  /** Milliseconds since the epoch. */
  readonly readAt: number;
}

type PreviewMap = ReadonlyMap<string, SwarmPreview>;

function useIsDocumentVisible(): boolean {
  const [isVisible, setVisible] = useState(true);
  useEffect(() => {
    function update(): void {
      setVisible(document.visibilityState === "visible");
    }
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return isVisible;
}

/** Everything that decides whether a session has to be read again. */
function targetsSignature(targets: readonly SwarmPreviewTarget[]): string {
  return targets
    .map(
      (target) =>
        `${target.stepId}:${target.key?.attemptId ?? ""}:${String(target.isActive)}`,
    )
    .join("|");
}

function isBehindEnd(target: SwarmPreviewTarget, readAt: number): boolean {
  return target.endedAt === null || readAt - target.endedAt > IMPORT_GRACE_MS;
}

async function readPreview(
  target: SwarmPreviewTarget,
  signal: AbortSignal,
): Promise<SwarmPreview | null> {
  if (!target.key) return null;
  const result = await readSessionPage(sessionAddress(target.key), 0, signal, {
    tail: true,
  });
  if (!result.ok || signal.aborted) return null;
  return { events: result.page.events, readAt: Date.now() };
}

/**
 * Reads the miniatures of the given sessions and hands each one over once read.
 * @param targets - The sessions to read.
 * @param finished - The attempts whose last state is stored already; they are not read again.
 * @param signal - Aborts the reads when the console changes or closes.
 * @param apply - Receives a miniature.
 */
async function readPreviews(
  targets: readonly SwarmPreviewTarget[],
  finished: Set<string>,
  signal: AbortSignal,
  apply: (stepId: string, preview: SwarmPreview) => void,
): Promise<void> {
  await Promise.all(
    targets.map(async (target) => {
      const attemptId = target.key?.attemptId;
      if (!attemptId || finished.has(attemptId)) return;
      const preview = await readPreview(target, signal);
      if (!preview) return;
      apply(target.stepId, preview);
      // The history of an ended session arrives a moment after its end; the
      // first read behind that moment is its last state, which stays.
      if (!target.isActive && isBehindEnd(target, preview.readAt))
        finished.add(attemptId);
    }),
  );
}

/**
 * The miniatures of the sessions of a swarm, read from their stored history.
 * @param targets - Every session of the swarm with its attempt.
 * @param selectedId - The session shown in the terminal; a change of it reads at once.
 * @returns The newest read of each session by its step.
 * @remarks
 * Reading happens when the console opens, when the selection changes, when a
 * session starts or ends and when the tab becomes visible again; a running
 * session reads again every 30 seconds. A hidden tab reads nothing, and a
 * session that ended is read until its last state is known and then never.
 */
export function useSwarmPreviews(
  targets: readonly SwarmPreviewTarget[],
  selectedId: string,
): PreviewMap {
  const [previews, setPreviews] = useState<PreviewMap>(() => new Map());
  const isVisible = useIsDocumentVisible();
  const latest = useRef(targets);
  const finished = useRef(new Set<string>());
  const signature = targetsSignature(targets);
  useEffect(() => {
    latest.current = targets;
  });
  useEffect(() => {
    if (!isVisible) return undefined;
    const controller = new AbortController();
    function apply(stepId: string, preview: SwarmPreview): void {
      setPreviews((current) => new Map(current).set(stepId, preview));
    }
    function read(): void {
      void readPreviews(
        latest.current,
        finished.current,
        controller.signal,
        apply,
      );
    }
    read();
    const timer = setInterval(read, PREVIEW_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [isVisible, selectedId, signature]);
  return previews;
}
