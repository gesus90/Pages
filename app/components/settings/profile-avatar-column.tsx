import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { User } from "@/definition/User";
import type { ChangeEvent } from "react";

interface ProfileAvatarColumnProps {
  readonly user: User;
  readonly canEditProfile: boolean;
  readonly isEditingProfile: boolean;
  readonly isAvatarSubmitting: boolean;
  readonly error: string | null;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onAvatarClick: () => void;
  readonly onCancelAvatar: () => void;
  /** Saves the picked avatar; `undefined` while no avatar is picked. */
  readonly onSaveAvatar: (() => void) | undefined;
}

/** Renders the avatar with its change button and the avatar-only actions. */
export function ProfileAvatarColumn({
  user,
  canEditProfile,
  isEditingProfile,
  isAvatarSubmitting,
  error,
  inputRef,
  onFileChange,
  onAvatarClick,
  onCancelAvatar,
  onSaveAvatar,
}: ProfileAvatarColumnProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFileChange}
      />
      <div className="group relative">
        <UserAvatar size="xl" user={user} />
        <button
          type="button"
          aria-label={t("settings.profile.changeAvatar")}
          className={cn(
            "absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-surface text-foreground shadow-md ring-1 ring-border/80 transition-all hover:scale-105 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary cursor-pointer",
            isEditingProfile
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100",
          )}
          onClick={onAvatarClick}
        >
          <Pencil className="size-3.5 text-foreground" aria-hidden="true" />
        </button>
      </div>

      {isEditingProfile || !canEditProfile ? (
        <div className="mt-3 text-center select-none">
          {!canEditProfile && error ? (
            <p className="mb-2 text-xs text-destructive">{error}</p>
          ) : null}
          {onSaveAvatar && !canEditProfile ? (
            <div className="flex justify-center gap-2">
              <Button
                className="h-8 min-h-0 px-3 text-xs"
                onClick={onCancelAvatar}
                type="button"
                variant="outline"
              >
                {t("settings.profile.cancelAction")}
              </Button>
              <Button
                className="h-8 min-h-0 px-3 text-xs"
                disabled={isAvatarSubmitting}
                onClick={onSaveAvatar}
                type="button"
              >
                {isAvatarSubmitting
                  ? t("settings.profile.savingAction")
                  : t("settings.profile.saveAction")}
              </Button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="cursor-pointer text-xs font-semibold text-foreground hover:text-primary"
                onClick={onAvatarClick}
              >
                {t("settings.profile.changeAvatar")}
              </button>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("settings.profile.avatarFormatHint")}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
