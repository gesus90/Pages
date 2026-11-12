import { useTranslation } from "react-i18next";

import type {
  AgentDeletionCounts,
  AgentDeletionKeeps,
  AgentDeletionPreview,
} from "@/definition/AgentDeletion";

const DELETE_KEYS: readonly (keyof AgentDeletionCounts)[] = [
  "directChats",
  "sessions",
  "memoryEntries",
  "ownedPlans",
  "runs",
  "files",
  "credentials",
  "groupMemberships",
  "assignedTickets",
];
const KEEP_KEYS: readonly (keyof AgentDeletionKeeps)[] = [
  "groupChatMessages",
  "ticketChanges",
  "wikiChanges",
  "commits",
];

/** Counts, owned plans and blockers of a deletion preview. */
export function AgentDeletePreview({
  preview,
}: {
  readonly preview: AgentDeletionPreview;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto text-sm">
      <p className="text-muted-foreground">
        {t("agentEmployees.deletion.explanation")}
      </p>
      <section>
        <h3 className="font-semibold text-foreground">
          {t("agentEmployees.deletion.deletesTitle")}
        </h3>
        <ul className="mt-1 space-y-1 text-muted-foreground">
          {DELETE_KEYS.map((key) => (
            <li key={key}>
              {t(`agentEmployees.deletion.deletes.${key}`)}:{" "}
              {preview.deletes[key]}
            </li>
          ))}
        </ul>
        {preview.ownedPlans.length > 0 ? (
          <ul className="mt-2 list-inside list-disc text-muted-foreground">
            {preview.ownedPlans.map((plan) => (
              <li key={plan.id}>{plan.name}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <section>
        <h3 className="font-semibold text-foreground">
          {t("agentEmployees.deletion.keepsTitle")}
        </h3>
        <ul className="mt-1 space-y-1 text-muted-foreground">
          {KEEP_KEYS.map((key) => (
            <li key={key}>
              {t(`agentEmployees.deletion.keeps.${key}`)}: {preview.keeps[key]}
            </li>
          ))}
        </ul>
      </section>
      {preview.blockers.length > 0 ? (
        <section role="alert">
          <h3 className="font-semibold text-destructive">
            {t("agentEmployees.deletion.blocked")}
          </h3>
          <ul className="mt-1 space-y-1">
            {preview.blockers.map((blocker) => (
              <li key={blocker.detail}>
                <a className="text-primary underline" href={blocker.link}>
                  {blocker.detail}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
