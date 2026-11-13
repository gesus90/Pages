/** The tabs of the popup "Agent-Einstellungen" (PAGE-376). */
export type AgentSettingsTab = "sessions" | "logbook" | "dreaming" | "lessons";

/** One tab of the popup and whether the function behind it exists yet. */
export interface AgentSettingsTabInfo {
  readonly value: AgentSettingsTab;
  readonly isAvailable: boolean;
}

/**
 * The tabs in their order.
 *
 * @remarks
 * Only "Sitzungen" works so far. The others stay visible but off until their
 * functions arrive; switching one on is a change of its flag here.
 */
export const AGENT_SETTINGS_TABS: readonly AgentSettingsTabInfo[] = [
  { value: "sessions", isAvailable: true },
  { value: "logbook", isAvailable: false },
  { value: "dreaming", isAvailable: false },
  { value: "lessons", isAvailable: false },
];

/**
 * Whether the function behind a tab exists.
 *
 * @param tab - The tab to check.
 */
export function isAgentSettingsTabAvailable(tab: AgentSettingsTab): boolean {
  return AGENT_SETTINGS_TABS.some(
    (entry) => entry.value === tab && entry.isAvailable,
  );
}

/**
 * The tab the popup opens in: the requested one when it works, else "Sitzungen".
 *
 * @param tab - The tab a caller asked for; none asks for the first one.
 */
export function resolveAgentSettingsTab(
  tab: AgentSettingsTab | undefined,
): AgentSettingsTab {
  return tab !== undefined && isAgentSettingsTabAvailable(tab)
    ? tab
    : "sessions";
}

/**
 * The tab a Radix value names, when its function exists.
 *
 * @param value - The value a tab control reports.
 * @returns The tab, or `null` for an unknown or switched-off one.
 */
export function readAvailableAgentSettingsTab(
  value: string,
): AgentSettingsTab | null {
  const entry = AGENT_SETTINGS_TABS.find((tab) => tab.value === value);
  return entry?.isAvailable === true ? entry.value : null;
}
