import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { AgentForm } from "./use-agent-form";

/** Keeps subscription and prepaid credentials on their explicitly selected routes. */
export function AgentZaiAccountField({
  form,
}: {
  readonly form: AgentForm;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (form.fields.provider !== "zai") return null;
  return (
    <div className="space-y-2">
      <label
        htmlFor="agent-zai-account-type"
        className="block text-sm font-medium"
      >
        {t("settings.agents.zaiAccountType")}
      </label>
      <Select
        id="agent-zai-account-type"
        value={form.fields.zaiAccountType}
        onValueChange={(choice) => form.setField("zaiAccountType", choice)}
        placeholder={t("settings.agents.zaiChooseAccount")}
        ariaLabel={t("settings.agents.zaiAccountType")}
        className="w-full border border-border [&>span]:truncate"
        options={[
          {
            value: "",
            label: t("settings.agents.zaiChooseAccount"),
            disabled: true,
          },
          { value: "coding-plan", label: t("settings.agents.zaiCodingPlan") },
          { value: "api", label: t("settings.agents.zaiStandardApi") },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.zaiAccountHint")}
      </p>
    </div>
  );
}
