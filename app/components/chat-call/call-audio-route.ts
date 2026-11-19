/** Whether the audio of a call runs directly between the browsers or over a TURN relay. */
export type CallAudioRoute = "direct" | "relay";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function candidateType(
  reports: ReadonlyMap<string, unknown>,
  id: unknown,
): unknown {
  const report = typeof id === "string" ? reports.get(id) : undefined;
  return isRecord(report) ? report.candidateType : undefined;
}

/** The ID of the candidate pair the connection carries its media on. */
function selectedPairId(reports: ReadonlyMap<string, unknown>): string | null {
  for (const report of reports.values()) {
    if (isRecord(report) && report.type === "transport") {
      const id = report.selectedCandidatePairId;
      if (typeof id === "string") return id;
    }
  }
  for (const [id, report] of reports) {
    if (
      isRecord(report) &&
      report.type === "candidate-pair" &&
      report.state === "succeeded" &&
      report.nominated === true
    )
      return id;
  }
  return null;
}

/**
 * Reads from the connection statistics which path the audio takes.
 * @param stats - The statistics of the peer connection.
 * @returns `relay` when either end of the selected candidate pair is a TURN
 * relay, `direct` for any other pair, `null` while no pair is selected.
 */
export function selectedAudioRoute(
  stats: RTCStatsReport,
): CallAudioRoute | null {
  const reports = new Map<string, unknown>();
  stats.forEach((report: unknown, id: string) => reports.set(id, report));
  const pairId = selectedPairId(reports);
  const pair = pairId === null ? undefined : reports.get(pairId);
  if (!isRecord(pair)) return null;
  const kinds = [
    candidateType(reports, pair.localCandidateId),
    candidateType(reports, pair.remoteCandidateId),
  ];
  return kinds.includes("relay") ? "relay" : "direct";
}
