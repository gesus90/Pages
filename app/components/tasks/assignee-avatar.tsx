import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { cn } from "@/app/lib/cn";

import type { WorkItemDetail } from "@/definition/Task";

interface AssigneeAvatarProps {
  readonly item: Pick<WorkItemDetail, "assigneeGroupName" | "assigneeName">;
  /** Colors of the surrounding card; the shape stays the same. */
  readonly className?: string;
}

/** Shows who a ticket is assigned to: a person's avatar, a group chip, or a question mark. */
export function AssigneeAvatar({
  item,
  className = "bg-muted text-muted-foreground",
}: AssigneeAvatarProps): React.ReactElement {
  const { t } = useTranslation();

  if (item.assigneeName) {
    return (
      <UserAvatar
        name={item.assigneeName}
        size="xs"
        className={className}
        title={item.assigneeName}
      />
    );
  }

  const label = item.assigneeGroupName
    ? t("tasks.assignee.group", { name: item.assigneeGroupName })
    : t("tasks.unassigned");

  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold select-none",
        className,
      )}
      title={label}
    >
      {item.assigneeGroupName ? (
        <Users className="size-3.5" aria-label={label} role="img" />
      ) : (
        "?"
      )}
    </span>
  );
}
