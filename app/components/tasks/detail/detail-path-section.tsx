import { ExternalLink, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { DetailSection } from "@/app/components/tasks/detail-section";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { WorkItemDetail } from "@/definition/Task";

const MAXIMUM_PATH_DEPTH = 10;

const PARENT_TYPE: Readonly<
  Partial<Record<WorkItemDetail["type"], WorkItemDetail["type"]>>
> = {
  [WORK_ITEM_TYPE.EPIC]: WORK_ITEM_TYPE.INITIATIVE,
  [WORK_ITEM_TYPE.TASK]: WORK_ITEM_TYPE.EPIC,
};

const PARENT_LABEL_KEYS: Readonly<
  Partial<Record<WorkItemDetail["type"], string>>
> = {
  [WORK_ITEM_TYPE.EPIC]: "tasks.fields.parentInitiative",
  [WORK_ITEM_TYPE.TASK]: "tasks.fields.parentEpic",
};

const PATH_DOT_CLASSES: Readonly<Record<WorkItemDetail["type"], string>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: "border-violet-500",
  [WORK_ITEM_TYPE.EPIC]: "border-blue-500",
  [WORK_ITEM_TYPE.TASK]: "border-emerald-500",
  [WORK_ITEM_TYPE.SUBTASK]: "border-emerald-500",
};

/**
 * Resolves the ancestor chain of a ticket, top-down.
 *
 * @param task - The ticket whose ancestors are wanted.
 * @param workItems - Every ticket the chain may run through.
 * @returns Ancestors from the root down to the direct parent.
 */
function getAncestorChain(
  task: WorkItemDetail,
  workItems: readonly WorkItemDetail[],
): WorkItemDetail[] {
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const chain: WorkItemDetail[] = [];
  const visited = new Set<string>([task.id]);
  let parentId = task.parentId;

  while (parentId && chain.length < MAXIMUM_PATH_DEPTH) {
    const parent = byId.get(parentId);

    if (visited.has(parentId) || !parent) {
      break;
    }

    visited.add(parentId);
    chain.unshift(parent);
    parentId = parent.parentId;
  }

  return chain;
}

interface PathChainProps {
  readonly task: WorkItemDetail;
  readonly chain: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
}

/** Renders the ancestors of a ticket and the ticket itself as a vertical path. */
function PathChain({
  task,
  chain,
  onSelectTask,
}: PathChainProps): React.ReactElement {
  return (
    <ol className="flex flex-col">
      {[...chain, task].map((entry, index, all) => {
        const isCurrent = entry.id === task.id;
        const hasConnector = index < all.length - 1;

        return (
          <li
            key={entry.id}
            className="relative flex items-center gap-2.5 pb-3 last:pb-0"
          >
            {hasConnector ? (
              <span
                aria-hidden="true"
                className="absolute top-6 bottom-0 left-[5px] w-px bg-border"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 rounded-full border-2 bg-surface",
                PATH_DOT_CLASSES[entry.type],
              )}
            />
            {isCurrent ? (
              <span
                aria-current="true"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5"
              >
                <TaskTypeBadge type={entry.type} />
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                  {entry.key}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {entry.title}
                </span>
              </span>
            ) : (
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                onClick={() => onSelectTask(entry.key)}
                type="button"
              >
                <TaskTypeBadge type={entry.type} />
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                  {entry.key}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {entry.title}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface ParentFieldsProps {
  readonly task: WorkItemDetail;
  readonly parentSelect: {
    readonly label: string;
    readonly options: readonly WorkItemDetail[];
  } | null;
  readonly parentKey: string | null;
  readonly isArchived: boolean;
  readonly onChangeParent: (parentId: string) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders the select for the parent and the link to a subtask's parent task. */
function ParentFields({
  task,
  parentSelect,
  parentKey,
  isArchived,
  onChangeParent,
  onSelectTask,
}: ParentFieldsProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (!parentSelect && !parentKey) {
    return null;
  }

  return (
    <dl className="flex flex-col gap-3">
      {parentSelect ? (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{parentSelect.label}</dt>
          <dd>
            <Select
              ariaLabel={parentSelect.label}
              disabled={isArchived}
              onValueChange={onChangeParent}
              options={[
                { label: t("tasks.none"), value: "" },
                ...parentSelect.options.map((option) => ({
                  label: `${option.key}: ${option.title}`,
                  value: option.id,
                })),
              ]}
              value={task.parentId ?? ""}
            />
          </dd>
        </div>
      ) : null}
      {parentKey ? (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">
            {t("tasks.fields.parentTask")}
          </dt>
          <dd>
            <button
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              onClick={() => onSelectTask(parentKey)}
              type="button"
            >
              {task.parentKey}
              <ExternalLink className="size-3" aria-hidden="true" />
            </button>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

interface DetailPathSectionProps {
  readonly task: WorkItemDetail;
  readonly workItems: readonly WorkItemDetail[];
  readonly isArchived: boolean;
  readonly onChangeParent: (parentId: string) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders the ancestor chain of a ticket and the select for its parent. */
export function DetailPathSection({
  task,
  workItems,
  isArchived,
  onChangeParent,
  onSelectTask,
}: DetailPathSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const parentType = PARENT_TYPE[task.type];
  const parentLabelKey = PARENT_LABEL_KEYS[task.type];
  const parentSelect =
    parentType && parentLabelKey
      ? {
          label: t(parentLabelKey),
          options: workItems.filter(
            (item) =>
              item.projectId === task.projectId &&
              item.type === parentType &&
              item.id !== task.id,
          ),
        }
      : null;

  return (
    <DetailSection
      icon={
        <MapPin
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      }
      title={t("tasks.path.title")}
    >
      <div className="flex flex-col gap-3">
        <PathChain
          chain={getAncestorChain(task, workItems)}
          onSelectTask={onSelectTask}
          task={task}
        />
        <ParentFields
          isArchived={isArchived}
          onChangeParent={onChangeParent}
          onSelectTask={onSelectTask}
          parentKey={
            task.type === WORK_ITEM_TYPE.SUBTASK ? task.parentKey : null
          }
          parentSelect={parentSelect}
          task={task}
        />
      </div>
    </DetailSection>
  );
}
