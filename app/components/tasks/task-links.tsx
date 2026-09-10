import { CheckCircle2, Circle, Link as LinkIcon, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { WORK_ITEM_LINK_TYPE } from "@/definition/Task";

import type {
  WorkItemDetail,
  WorkItemLink,
  WorkItemLinkType,
} from "@/definition/Task";

interface TaskLinksProps {
  readonly workItemId: string;
  readonly currentWorkItemKey: string;
  readonly links: readonly WorkItemLink[];
  readonly workItems: readonly WorkItemDetail[];
  readonly isArchived?: boolean;
  readonly isSubmitting?: boolean;
  /** Shows the add form; omit to keep it permanently visible. */
  readonly isAddFormOpen?: boolean;
  readonly onAddFormOpenChange?: (isOpen: boolean) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders and edits Jira-style ticket relations (blocks/relates/duplicates). */
export function TaskLinks({
  workItemId,
  currentWorkItemKey,
  links,
  workItems,
  isArchived = false,
  isSubmitting = false,
  isAddFormOpen,
  onAddFormOpenChange,
  onSelectTask,
}: TaskLinksProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [linkType, setLinkType] = useState<WorkItemLinkType>(
    WORK_ITEM_LINK_TYPE.RELATES_TO,
  );
  const [targetKey, setTargetKey] = useState("");

  const targetOptions = workItems.filter(
    (item) => item.key !== currentWorkItemKey && item.archivedAt === null,
  );
  const canAddLinks = !isArchived && targetOptions.length > 0;
  const showAddForm = canAddLinks && (isAddFormOpen ?? true);

  function getLinkTypeLabel(link: WorkItemLink): string {
    if (link.linkType === WORK_ITEM_LINK_TYPE.RELATES_TO) {
      return t("tasks.links.type.relatesTo");
    }

    if (link.linkType === WORK_ITEM_LINK_TYPE.BLOCKS) {
      return link.direction === "outgoing"
        ? t("tasks.links.type.blocks")
        : t("tasks.links.type.blockedBy");
    }

    return link.direction === "outgoing"
      ? t("tasks.links.type.duplicates")
      : t("tasks.links.type.duplicatedBy");
  }

  function handleAdd(): void {
    submit(
      { intent: "link-add", linkType, targetKey, workItemId },
      { method: "post" },
    );
    setTargetKey("");
    onAddFormOpenChange?.(false);
  }

  function handleCancelAdd(): void {
    setTargetKey("");
    onAddFormOpenChange?.(false);
  }

  function handleLinkTypeChange(nextLinkType: string): void {
    setLinkType(nextLinkType as WorkItemLinkType);
  }

  function handleRemove(link: WorkItemLink): void {
    submit(
      { intent: "link-remove", linkId: link.id, workItemId },
      { method: "post" },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl bg-muted/40 px-4 py-5 text-center">
          <LinkIcon
            className="size-4 text-muted-foreground/70"
            aria-hidden="true"
          />
          <p className="text-xs font-medium text-foreground">
            {t("tasks.links.none")}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("tasks.links.emptyHint")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((link) => (
            <li
              key={link.id}
              className="group flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs"
            >
              <span className="shrink-0 rounded-md bg-surface px-2 py-1 font-medium text-muted-foreground">
                {getLinkTypeLabel(link)}
              </span>
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => onSelectTask(link.linkedWorkItemKey)}
                type="button"
              >
                {link.linkedWorkItemIsDone ? (
                  <CheckCircle2
                    className="size-3.5 shrink-0 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="shrink-0 font-semibold text-muted-foreground">
                  {link.linkedWorkItemKey}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {link.linkedWorkItemTitle}
                </span>
              </button>
              {!isArchived ? (
                <button
                  aria-label={t("tasks.links.remove")}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  onClick={() => handleRemove(link)}
                  type="button"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {showAddForm ? (
        <div className="flex flex-col gap-2">
          <Select
            ariaLabel={t("tasks.links.selectType")}
            className="w-full"
            onValueChange={handleLinkTypeChange}
            options={[
              {
                label: t("tasks.links.type.blocks"),
                value: WORK_ITEM_LINK_TYPE.BLOCKS,
              },
              {
                label: t("tasks.links.type.relatesTo"),
                value: WORK_ITEM_LINK_TYPE.RELATES_TO,
              },
              {
                label: t("tasks.links.type.duplicates"),
                value: WORK_ITEM_LINK_TYPE.DUPLICATES,
              },
            ]}
            value={linkType}
          />
          <Select
            ariaLabel={t("tasks.links.selectTicket")}
            className="min-w-0 flex-1"
            onValueChange={setTargetKey}
            options={[
              { label: t("tasks.links.selectTicketPlaceholder"), value: "" },
              ...targetOptions.map((item) => ({
                label: `${item.key} ${item.title}`,
                value: item.key,
              })),
            ]}
            value={targetKey}
          />
          <div className="flex justify-end gap-2">
            {onAddFormOpenChange ? (
              <Button
                className="h-9 shrink-0 px-3 text-xs"
                onClick={handleCancelAdd}
                type="button"
                variant="ghost"
              >
                {t("tasks.actions.cancel")}
              </Button>
            ) : null}
            <Button
              className="h-9 shrink-0 gap-1.5 px-3 text-xs"
              disabled={isSubmitting || !targetKey}
              onClick={handleAdd}
              type="button"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("tasks.links.add")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
