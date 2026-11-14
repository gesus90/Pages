import { useTranslation } from "react-i18next";

import { groupDreamLog } from "./agent-dreaming-display";
import { DreamCard } from "./agent-dreaming-widgets";

import type { DreamLogGroup } from "./agent-dreaming-display";
import type { AgentDreamRunView } from "@/definition/AgentDreaming";

/** One kind of the log with its lines. */
function LogGroup({
  group,
}: {
  readonly group: DreamLogGroup;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground">
        {t(`agentDreaming.kind.${group.kind}`)}{" "}
        <span className="font-normal tabular-nums">
          ({group.entries.length})
        </span>
      </h4>
      <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground">
        {group.entries.map((entry, index) => (
          <li
            key={`${group.kind}:${String(index)}`}
            className="text-sm break-words text-foreground"
          >
            {entry.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The card "Protokoll des letzten Laufs": what the run took into the memory,
 * learned, created or dropped, grouped by kind.
 */
export function AgentDreamingLog({
  run,
}: {
  readonly run: AgentDreamRunView | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const groups = groupDreamLog(run?.log ?? []);
  return (
    <DreamCard title={t("agentDreaming.cards.log")}>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {run === null
            ? t("agentDreaming.log.noRun")
            : t("agentDreaming.log.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <LogGroup key={group.kind} group={group} />
          ))}
        </div>
      )}
    </DreamCard>
  );
}
