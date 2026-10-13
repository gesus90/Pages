import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { PageAgent } from "@/definition/PageAgent";

function sharingLabel(agent: PageAgent): string {
  const { sharing } = agent.configuration;
  if (sharing.isGlobal) return "pageAgents.global";
  return sharing.targets.length > 0
    ? "pageAgents.restricted"
    : "pageAgents.private";
}

/** One agent of the list; the owner edits it, everyone else with access only reads it. */
export function PageAgentRow(props: {
  readonly agent: PageAgent;
  readonly onOpen: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { agent } = props;
  const { reason } = agent.availability;
  // The reason is a stable error code of the agent or of the model access.
  const status =
    reason === null
      ? t("pageAgents.ready")
      : t(`settings.agents.error.${reason}`, {
          defaultValue: t(`assistant.error.${reason}`),
        });
  return (
    <tr>
      <th scope="row" className="pages-selectable px-4 py-3 font-medium">
        {agent.name}
      </th>
      <td className="pages-selectable px-4 py-3">{agent.model}</td>
      <td className="pages-selectable px-4 py-3">
        {agent.reasoningEffort ?? t("pageAgents.defaultReasoning")}
      </td>
      <td className="px-4 py-3">{t(sharingLabel(agent))}</td>
      <td className="px-4 py-3">
        <span
          className={
            agent.availability.isUsable ? "text-success" : "text-warning"
          }
        >
          {status}
        </span>
      </td>
      <td className="px-4 py-3">
        <Button size="sm" variant="outline" onClick={props.onOpen}>
          {t(agent.canEdit ? "pageAgents.edit" : "pageAgents.view")}
        </Button>
      </td>
    </tr>
  );
}
