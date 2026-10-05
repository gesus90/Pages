import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { WORK_ITEM_LINK_TYPE } from "@/definition/Task";

import type { WorkItemDetail, WorkItemLinkType } from "@/definition/Task";

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

/** Renders the selects and buttons that add a link to another ticket. */
export function LinkAddForm({
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
