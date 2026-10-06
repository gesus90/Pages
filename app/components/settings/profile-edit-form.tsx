import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import type { Role } from "@/definition/Role";

/** The values the administrator is editing. */
export interface ProfileDraft {
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
  readonly role: Role;
}

interface ProfileEditFormProps {
  readonly draft: ProfileDraft;
  readonly error: string | null;
  readonly canSave: boolean;
  readonly isSubmitting: boolean;
  readonly onChange: (changes: Partial<ProfileDraft>) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

/** Renders the editable profile fields with their save and cancel buttons. */
export function ProfileEditForm({
  draft,
  error,
  canSave,
  isSubmitting,
  onChange,
  onCancel,
  onSave,
}: ProfileEditFormProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-foreground"
          htmlFor="settings-profile-display-name"
        >
          {t("settings.profile.displayName")}
        </label>
        <Input
          id="settings-profile-display-name"
          value={draft.displayName}
          onChange={(event) => onChange({ displayName: event.target.value })}
          maxLength={200}
        />
      </div>

      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-foreground"
          htmlFor="settings-profile-username"
        >
          {t("settings.profile.username")}
        </label>
        <Input
          id="settings-profile-username"
          value={draft.username}
          onChange={(event) => onChange({ username: event.target.value })}
          maxLength={200}
        />
      </div>

      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-foreground"
          htmlFor="settings-profile-email"
        >
          {t("settings.profile.email")}
        </label>
        <Input
          id="settings-profile-email"
          type="email"
          value={draft.email}
          onChange={(event) => onChange({ email: event.target.value })}
          placeholder={t("settings.profile.emailPlaceholder")}
          maxLength={320}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("settings.profile.cancelAction")}
        </Button>
        <Button
          type="button"
          disabled={!canSave || isSubmitting}
          onClick={onSave}
        >
          {isSubmitting
            ? t("settings.profile.savingAction")
            : t("settings.profile.saveAction")}
        </Button>
      </div>
    </div>
  );
}
