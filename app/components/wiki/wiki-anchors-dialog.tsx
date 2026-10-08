import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiAnchorChoices, WikiPage } from "@/definition/Wiki";

interface WikiAnchorsDialogProps {
  readonly page: WikiPage;
  readonly choices: WikiAnchorChoices;
  readonly onClose: () => void;
}

function Group({
  title,
  entries,
  selected,
}: {
  readonly title: string;
  readonly entries: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly selected: ReadonlySet<string>;
}): React.ReactElement | null {
  return entries.length === 0 ? null : (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {entries.map((entry) => (
          <label key={entry.value} className="flex items-center gap-2 text-sm">
            <Checkbox
              defaultChecked={selected.has(entry.value)}
              name="anchor"
              value={entry.value}
            />
            {entry.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Ties a page to departments, milestones and epics that restrict who sees it. */
export function WikiAnchorsDialog({
  page,
  choices,
  onClose,
}: WikiAnchorsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const selected = new Set(
    choices.selected.map((anchor) => `${anchor.kind}:${anchor.targetId}`),
  );
  const missing = page.anchors.filter((anchor) => anchor.label === null);

  return (
    <WikiActionDialog
      action={wikiPagePath(page.id)}
      description={t("wiki.dialog.anchors.description")}
      fields={{ intent: "set-anchors" }}
      size="md"
      submitLabel={t("wiki.dialog.save")}
      title={t("wiki.dialog.anchors.title")}
      onClose={onClose}
    >
      <Group
        entries={choices.departments.map((department) => ({
          label: department.name,
          value: `department:${department.id}`,
        }))}
        selected={selected}
        title={t("wiki.dialog.anchors.departments")}
      />
      <Group
        entries={choices.milestones.map((milestone) => ({
          label: `${milestone.projectName} / ${milestone.name}`,
          value: `milestone:${milestone.id}`,
        }))}
        selected={selected}
        title={t("wiki.dialog.anchors.milestones")}
      />
      <Group
        entries={choices.epics.map((epic) => ({
          label: `${epic.key} – ${epic.title}`,
          value: `epic:${epic.id}`,
        }))}
        selected={selected}
        title={t("wiki.dialog.anchors.epics")}
      />
      {missing.length > 0 ? (
        <p className="text-sm text-warning" role="status">
          {t("wiki.dialog.anchors.missing", { count: missing.length })}
        </p>
      ) : null}
    </WikiActionDialog>
  );
}
