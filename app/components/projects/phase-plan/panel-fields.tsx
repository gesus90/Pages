import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import type { PanelDraftState } from "@/app/components/projects/phase-plan/use-panel-draft";
import { focusOnMount } from "@/app/lib/focus-on-mount";

interface PanelFieldsProps {
  readonly state: PanelDraftState;
}

/** Renders the name, dates, description and status fields of the panel. */
export function PanelFields({ state }: PanelFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const { draft, setField } = state;

  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="select-none">
          {t("projectDetail.planning.phasePlan.name")}
        </span>
        <Input
          name="name"
          value={draft.name}
          maxLength={200}
          ref={focusOnMount}
          onChange={(event) => setField("name", event.currentTarget.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="select-none">
            {t("projectDetail.planning.phasePlan.startDate")}
          </span>
          <Input
            name="startAt"
            type="date"
            value={draft.start}
            onChange={(event) => setField("start", event.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="select-none">
            {t("projectDetail.planning.phasePlan.endDate")}
          </span>
          <Input
            name="endAt"
            type="date"
            value={draft.end}
            min={draft.start || undefined}
            onChange={(event) => setField("end", event.currentTarget.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="select-none">
          {t("projectDetail.planning.phasePlan.description")}
        </span>
        <Textarea
          name="description"
          className="min-h-24 resize-y"
          value={draft.description}
          maxLength={2000}
          onChange={(event) =>
            setField("description", event.currentTarget.value)
          }
        />
      </label>
      <div className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="select-none">
          {t("projectDetail.planning.phasePlan.status")}
        </span>
        <Select
          id="milestone-panel-status"
          ariaLabel={t("projectDetail.planning.phasePlan.status")}
          value={draft.status}
          onValueChange={(status) => setField("status", status)}
          className="w-full"
          options={[
            {
              label: t("projectDetail.planning.phasePlan.statusOpen"),
              value: "open",
            },
            {
              label: t("projectDetail.planning.phasePlan.statusCompleted"),
              value: "completed",
            },
            {
              label: t("projectDetail.planning.phasePlan.statusArchived"),
              value: "archived",
            },
          ]}
        />
      </div>
    </>
  );
}
