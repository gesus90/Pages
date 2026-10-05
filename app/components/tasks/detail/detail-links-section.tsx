import { Link as LinkIcon, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DetailSection } from "@/app/components/tasks/detail-section";
import { TaskLinks } from "@/app/components/tasks/task-links";
import { Button } from "@/app/components/ui/button";

import type { WorkItemDetail, WorkItemLink } from "@/definition/Task";

interface DetailLinksSectionProps {
  readonly task: WorkItemDetail;
  readonly links: readonly WorkItemLink[];
  readonly workItems: readonly WorkItemDetail[];
  readonly isArchived: boolean;
  readonly isSyncing: boolean;
  readonly onSelectTask: (key: string) => void;
}

/** Renders the links of a ticket with a form to add new ones. */
export function DetailLinksSection({
  task,
  links,
  workItems,
  isArchived,
  isSyncing,
  onSelectTask,
}: DetailLinksSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [isAddingLink, setIsAddingLink] = useState(false);

  function handleToggleAddLink(): void {
    setIsAddingLink((previous) => !previous);
  }

  return (
    <DetailSection
      icon={
        <LinkIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      }
      title={t("tasks.links.section")}
      trailing={
        !isArchived ? (
          <Button
            aria-label="link-section-add"
            className="h-8 shrink-0 gap-1.5 px-3 text-xs"
            onClick={handleToggleAddLink}
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("tasks.links.add")}
          </Button>
        ) : undefined
      }
    >
      <TaskLinks
        currentWorkItemKey={task.key}
        isAddFormOpen={isAddingLink}
        isArchived={isArchived}
        isSubmitting={isSyncing}
        links={links}
        onAddFormOpenChange={setIsAddingLink}
        onSelectTask={onSelectTask}
        workItemId={task.id}
        workItems={workItems}
      />
    </DetailSection>
  );
}
