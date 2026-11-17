import { useTranslation } from "react-i18next";

import { AccessBadge } from "@/app/components/agents/badges/access-badge";
import { Tooltip } from "@/app/components/ui/tooltip";
import { storedAgentAccessMode } from "@/definition/AgentAccessMode";

import type { AgentRunAccess } from "@/definition/AgentConfiguration";

/** The explanation of each mode in the badge's tooltip and accessible name. */
const MODE_HINT_KEY = {
  yolo: "plans.modeNotice.yolo",
  read_only: "agentEmployees.access.hint.read_only",
} as const;

/**
 * Shows the mode of an agent node as the shared access badge.
 * @remarks
 * YOLO runs natively with every right of the executing Linux account, also
 * for nodes saved before this meaning, and shows as the YOLO badge in the
 * warning color; "Lesend" shows as the READ badge. The sentence that
 * explains the mode is the badge's tooltip on hover and keyboard focus and
 * its name for screen readers, so it no longer fills the card. An earlier
 * write mode runs no more until "Lesend" or "YOLO" is chosen and keeps its
 * visible notice.
 */
export function PlanAccessNotice({
  access,
}: {
  readonly access: AgentRunAccess | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (access === undefined) return null;
  const mode = storedAgentAccessMode(access);
  if (mode === null)
    return (
      <p role="note" className="text-xs font-medium text-warning">
        {t("plans.modeNotice.legacy")}
      </p>
    );
  const hint = t(MODE_HINT_KEY[mode]);
  // The YOLO sentence starts with the mode's name; the READ hint does not.
  const name =
    mode === "yolo" ? hint : `${t("agentBadges.access.read_only")} – ${hint}`;
  return (
    <span className="flex">
      <Tooltip content={hint} align="start">
        {() => (
          <button
            type="button"
            aria-label={name}
            className="inline-flex rounded-[7px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <AccessBadge access={mode} />
          </button>
        )}
      </Tooltip>
    </span>
  );
}
