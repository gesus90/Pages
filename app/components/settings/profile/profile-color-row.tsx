import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { PersonColorPicker } from "@/app/components/common/person-color-picker";

import type { PersonColor } from "@/definition/PersonColor";

interface ProfileColorRowProps {
  /** The color stored for the account, or `null`. */
  readonly color: string | null;
}

/**
 * The person color of the own account (PAGE-266): chosen from the fixed
 * palette and saved at once; it draws the ring around the avatar everywhere.
 *
 * @remarks
 * Open to every signed-in account, like the avatar image. While the change
 * is on its way, the picked color is shown already.
 */
export function ProfileColorRow({
  color,
}: ProfileColorRowProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("color");
  const shown = typeof pending === "string" ? pending || null : color;

  function handleChange(next: PersonColor | null): void {
    const formData = new FormData();
    formData.set("intent", "update-color");
    formData.set("color", next ?? "");
    void fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-sm text-muted-foreground">
        {t("settings.profile.color")}
      </span>
      <PersonColorPicker
        value={shown}
        onChange={handleChange}
        label={t("settings.profile.color")}
        isDisabled={fetcher.state !== "idle"}
        canClear
      />
    </div>
  );
}
