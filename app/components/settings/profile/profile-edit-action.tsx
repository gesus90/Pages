import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface ProfileEditActionProps {
  readonly isEditing: boolean;
  readonly onEdit: () => void;
}

/** Renders the button that switches the profile card into edit mode. */
export function ProfileEditAction({
  isEditing,
  onEdit,
}: ProfileEditActionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Button
      className="h-8 gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-primary shadow-xs hover:bg-surface-hover hover:text-primary-hover disabled:opacity-50"
      disabled={isEditing}
      onClick={onEdit}
      type="button"
      variant="outline"
    >
      <Pencil className="size-3.5 text-primary" aria-hidden="true" />
      {t("settings.profile.editAction")}
    </Button>
  );
}
