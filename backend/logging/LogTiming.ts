/** Shares the slow-operation threshold between database statements and polling responses. */
export function readSlowOperationThresholdMs(): number {
  const configured = process.env.PAGES_SLOW_QUERY_MS?.trim();
  const parsed =
    configured === undefined || configured === ""
      ? Number.NaN
      : Number(configured);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
}
