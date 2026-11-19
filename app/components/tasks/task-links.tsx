import { CheckCircle2, Circle, Link as LinkIcon, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { isWorkItemLinkType, WORK_ITEM_LINK_TYPE } from "@/definition/Task";

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

type LinkTypeLabelKey =
  | "tasks.links.type.blockedBy"
  | "tasks.links.type.blocks"
  | "tasks.links.type.duplicatedBy"
  | "tasks.links.type.duplicates"
  | "tasks.links.type.relatesTo";

interface TaskLinkActions {
  readonly linkType: WorkItemLinkType;
  readonly targetKey: string;
  readonly setTargetKey: (targetKey: string) => void;
  readonly changeLinkType: (linkType: string) => void;
  readonly addLink: () => void;
  readonly cancelAdd: () => void;
  readonly removeLink: (link: WorkItemLink) => void;
}

interface LinkRowProps {
  readonly link: WorkItemLink;
  readonly isArchived: boolean;
  readonly onSelectTask: (key: string) => void;
  readonly onRemove: (link: WorkItemLink) => void;
}

interface LinkAddFormProps {
  readonly linkType: WorkItemLinkType;
  readonly targetKey: string;
  readonly targetOptions: readonly WorkItemDetail[];
  readonly isSubmitting: boolean;
  readonly canCancel: boolean;
  readonly onLinkTypeChange: (linkType: string) => void;
  readonly onTargetKeyChange: (targetKey: string) => void;
  readonly onAdd: () => void;
  readonly onCancel: () => void;
}

function getLinkTypeLabelKey(link: WorkItemLink): LinkTypeLabelKey {
  if (link.linkType === WORK_ITEM_LINK_TYPE.RELATES_TO) {
    return "tasks.links.type.relatesTo";
  }

  const isOutgoing = link.direction === "outgoing";

  if (link.linkType === WORK_ITEM_LINK_TYPE.BLOCKS) {
    return isOutgoing
      ? "tasks.links.type.blocks"
      : "tasks.links.type.blockedBy";
  }

  return isOutgoing
    ? "tasks.links.type.duplicates"
    : "tasks.links.type.duplicatedBy";
}

function parseLinkType(value: string): WorkItemLinkType {
  return isWorkItemLinkType(value) ? value : WORK_ITEM_LINK_TYPE.RELATES_TO;
}

function useTaskLinkActions(
  workItemId: string,
  onAddFormOpenChange: ((isOpen: boolean) => void) | undefined,
): TaskLinkActions {
  const submit = useSubmit();
  const [linkType, setLinkType] = useState<WorkItemLinkType>(
    WORK_ITEM_LINK_TYPE.RELATES_TO,
  );
  const [targetKey, setTargetKey] = useState("");

  function addLink(): void {
    void submit(
      { intent: "link-add", linkType, targetKey, workItemId },
      { method: "post" },
    );
    setTargetKey("");
    onAddFormOpenChange?.(false);
  }

  function cancelAdd(): void {
    setTargetKey("");
    onAddFormOpenChange?.(false);
  }

  function changeLinkType(nextLinkType: string): void {
    setLinkType(parseLinkType(nextLinkType));
  }

  function removeLink(link: WorkItemLink): void {
    void submit(
      { intent: "link-remove", linkId: link.id, workItemId },
      { method: "post" },
    );
  }

  return {
    addLink,
    cancelAdd,
    changeLinkType,
    linkType,
    removeLink,
    setTargetKey,
    targetKey,
  };
}

function LinkEmptyState(): React.ReactElement {
  const { t } = useTranslation();

  return (
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
  );
}

function LinkRow({
  link,
  isArchived,
  onSelectTask,
  onRemove,
}: LinkRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <li className="group flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
      <span className="shrink-0 rounded-md bg-surface px-2 py-1 font-medium text-muted-foreground">
        {t(getLinkTypeLabelKey(link))}
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
          onClick={() => onRemove(link)}
          type="button"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function LinkAddForm({
  linkType,
  targetKey,
  targetOptions,
  isSubmitting,
  canCancel,
  onLinkTypeChange,
  onTargetKeyChange,
  onAdd,
  onCancel,
}: LinkAddFormProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <Select
        ariaLabel={t("tasks.links.selectType")}
        className="w-full"
        onValueChange={onLinkTypeChange}
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
        onValueChange={onTargetKeyChange}
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
        {canCancel ? (
          <Button
            className="h-9 shrink-0 px-3 text-xs"
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            {t("tasks.actions.cancel")}
          </Button>
        ) : null}
        <Button
          className="h-9 shrink-0 gap-1.5 px-3 text-xs"
          disabled={isSubmitting || !targetKey}
          onClick={onAdd}
          type="button"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("tasks.links.add")}
        </Button>
      </div>
    </div>
  );
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
  const actions = useTaskLinkActions(workItemId, onAddFormOpenChange);

  const targetOptions = workItems.filter(
    (item) => item.key !== currentWorkItemKey && item.archivedAt === null,
  );
  const canAddLinks = !isArchived && targetOptions.length > 0;
  const showAddForm = canAddLinks && (isAddFormOpen ?? true);

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? (
        <LinkEmptyState />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              isArchived={isArchived}
              link={link}
              onRemove={actions.removeLink}
              onSelectTask={onSelectTask}
            />
          ))}
        </ul>
      )}

      {showAddForm ? (
        <LinkAddForm
          canCancel={onAddFormOpenChange !== undefined}
          isSubmitting={isSubmitting}
          linkType={actions.linkType}
          onAdd={actions.addLink}
          onCancel={actions.cancelAdd}
          onLinkTypeChange={actions.changeLinkType}
          onTargetKeyChange={actions.setTargetKey}
          targetKey={actions.targetKey}
          targetOptions={targetOptions}
        />
      ) : null}
    </div>
  );
}
