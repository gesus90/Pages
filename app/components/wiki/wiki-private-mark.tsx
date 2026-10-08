import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The small lock that marks private pages in lists. */
export function WikiPrivateMark(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Lock
      aria-label={t("wiki.page.private")}
      className="size-3.5 shrink-0"
      role="img"
    />
  );
}
