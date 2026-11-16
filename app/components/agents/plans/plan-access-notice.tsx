import { useTranslation } from "react-i18next";

import { storedAgentAccessMode } from "@/definition/AgentAccessMode";

import type { AgentRunAccess } from "@/definition/AgentConfiguration";

/**
 * Says what the mode of an agent node means on the host.
 * @remarks
 * YOLO runs natively with every right of the executing Linux account, also
 * for nodes saved before this meaning; an earlier write mode runs no more
 * until "Lesend" or "YOLO" is chosen. "Lesend" needs no notice.
 */
export function PlanAccessNotice({
  access,
}: {
  readonly access: AgentRunAccess | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (access === undefined) return null;
  const mode = storedAgentAccessMode(access);
  if (mode === "read_only") return null;
  return (
    <p role="note" className="text-xs font-medium text-warning">
      {t(mode === "yolo" ? "plans.modeNotice.yolo" : "plans.modeNotice.legacy")}
    </p>
  );
}
