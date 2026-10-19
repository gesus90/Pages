import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

/**
 * Loads the stored plan again after another person saved a newer revision.
 *
 * @remarks
 * Nothing is overwritten or copied. Unsaved edits are only dropped after the
 * discard question of the leave guard, and the plan opens at the revision
 * that is stored now.
 */
export function PlanReloadButton(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() => void navigate(`${location.pathname}${location.search}`)}
    >
      {t("plans.flow.storage.reload")}
    </Button>
  );
}
