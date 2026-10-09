import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Select } from "@/app/components/ui/select";
import { WORK_ITEM_PARENT_TYPE, WORK_ITEM_TYPE } from "@/definition/Task";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketParentFieldProps {
  readonly ticket: WorkItemDetail;
  /** Tickets the parent may be chosen from; filtered here by type and project. */
  readonly workItems: readonly WorkItemDetail[];
  readonly isDisabled: boolean;
  readonly onOpenTicket: (key: string) => void;
}

/** The outcome of a ticket action as the action route answers it. */
function readFailure(answer: unknown): string | null {
  return typeof answer === "object" &&
    answer !== null &&
    "ok" in answer &&
    answer.ok === false &&
    "error" in answer &&
    typeof answer.error === "string"
    ? answer.error
    : null;
}

/**
 * Lists the tickets a ticket may hang below: active tickets of the level right
 * above in the same project, never the ticket itself.
 *
 * @param ticket - The ticket that gets a parent.
 * @param workItems - Candidates as loaded.
 * @returns The possible parents.
 */
export function findParentCandidates(
  ticket: WorkItemDetail,
  workItems: readonly WorkItemDetail[],
): WorkItemDetail[] {
  const parentType = WORK_ITEM_PARENT_TYPE[ticket.type];

  return workItems.filter(
    (item) =>
      item.type === parentType &&
      item.projectId === ticket.projectId &&
      item.id !== ticket.id &&
      item.archivedAt === null,
  );
}

/**
 * Chooses the parent of a ticket on every level (A8.2-E03): epics below
 * initiatives, tasks below epics, subtasks below tasks. Without the right to
 * write it only shows the parent. The server checks the choice again; a
 * refusal shows next to the field.
 */
export function TicketParentField({
  ticket,
  workItems,
  isDisabled,
  onOpenTicket,
}: TicketParentFieldProps): React.ReactElement | null {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const { canWrite } = useTicketAccess();
  const parentType = WORK_ITEM_PARENT_TYPE[ticket.type];
  const failure = fetcher.state === "idle" ? readFailure(fetcher.data) : null;

  if (parentType === null) {
    return null;
  }

  const label = t(`tasks.type.${parentType}`);
  const parentKey = ticket.parentKey;
  const isRequired = ticket.type === WORK_ITEM_TYPE.SUBTASK;

  function handleChange(parentId: string): void {
    void fetcher.submit(
      { id: ticket.id, intent: "change-parent", parentId },
      { action: "/aufgaben", method: "post" },
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground">{label}</span>
        <Select
          ariaLabel={label}
          disabled={isDisabled || !canWrite || fetcher.state !== "idle"}
          onValueChange={handleChange}
          options={[
            ...(isRequired
              ? []
              : [{ label: t("tasks.parent.none"), value: "" }]),
            ...findParentCandidates(ticket, workItems).map((item) => ({
              label: `${item.key}: ${item.title}`,
              value: item.id,
            })),
          ]}
          value={ticket.parentId ?? ""}
        />
      </div>
      {parentKey ? (
        <button
          className="inline-flex items-center gap-1 self-end text-xs font-semibold text-primary hover:underline"
          type="button"
          onClick={() => onOpenTicket(parentKey)}
        >
          {t("tasks.parent.open", { key: parentKey })}
          <ExternalLink aria-hidden="true" className="size-3" />
        </button>
      ) : null}
      {fetcher.state !== "idle" ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("tasks.parent.saving")}
        </p>
      ) : null}
      {failure ? (
        <p className="text-xs text-destructive" role="alert">
          {t(`tasks.error.${failure}`, { defaultValue: failure })}
        </p>
      ) : null}
    </div>
  );
}
