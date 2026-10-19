/**
 * The key that keeps the plan names of one team unique.
 *
 * @remarks
 * Surrounding spaces and letter case do not count, so `Release` and
 * ` release ` name the same plan. The plan page, the plan service and the
 * unique index of the database all compare this key and nothing else.
 */
export function agentPlanNameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}
