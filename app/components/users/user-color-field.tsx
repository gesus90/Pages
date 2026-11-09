import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { PersonColorPicker } from "@/app/components/common/person-color-picker";

import type { PersonColor } from "@/definition/PersonColor";

/**
 * The person color of another account in the administration (PAGE-266),
 * saved at once; the server checks the right to change the account.
 */
export function UserColorField({
  userId,
  color,
}: {
  readonly userId: string;
  readonly color: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const pending = fetcher.formData?.get("color");
  const shown = typeof pending === "string" ? pending || null : color;

  function handleChange(next: PersonColor | null): void {
    const formData = new FormData();
    formData.set("intent", "set-user-color");
    formData.set("userId", userId);
    formData.set("color", next ?? "");
    void fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">
        {t("users.fields.color")}
      </span>
      <PersonColorPicker
        value={shown}
        onChange={handleChange}
        label={t("users.fields.color")}
        isDisabled={fetcher.state !== "idle"}
        canClear
      />
      {fetcher.state === "idle" && fetcher.data?.ok === false ? (
        <p className="text-sm text-destructive" role="alert">
          {t("users.error.forbidden")}
        </p>
      ) : null}
    </div>
  );
}
