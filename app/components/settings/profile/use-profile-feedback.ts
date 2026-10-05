import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useActionOutcome } from "@/app/components/settings/use-action-outcome";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

/** What the profile card does with the answers of the server. */
export interface ProfileFeedback {
  readonly onSaved: () => void;
  readonly onAvatarSaved: () => void;
  readonly onFailed: (message: string) => void;
}

/**
 * Reacts to the server's answer to a profile or avatar submission.
 *
 * @param feedback - What the card does with the answer.
 *
 * @remarks
 * Each answer is handled once, even though the card renders again afterwards.
 */
export function useProfileFeedback(feedback: ProfileFeedback): void {
  const { t } = useTranslation();
  const profileOutcome = useActionOutcome("update-profile");
  const avatarOutcome = useActionOutcome("update-avatar");
  const lastProfileOutcome = useRef<SettingsActionData | null>(null);
  const lastAvatarOutcome = useRef<SettingsActionData | null>(null);

  useEffect(() => {
    if (!profileOutcome || profileOutcome === lastProfileOutcome.current) {
      return;
    }

    lastProfileOutcome.current = profileOutcome;

    if (profileOutcome.ok) {
      feedback.onSaved();
    } else {
      feedback.onFailed(t(`settings.profile.errors.${profileOutcome.error}`));
    }
  }, [profileOutcome, feedback, t]);

  useEffect(() => {
    if (!avatarOutcome || avatarOutcome === lastAvatarOutcome.current) {
      return;
    }

    lastAvatarOutcome.current = avatarOutcome;

    if (avatarOutcome.ok) {
      feedback.onAvatarSaved();
    } else {
      feedback.onFailed(t(`settings.profile.errors.${avatarOutcome.error}`));
    }
  }, [avatarOutcome, feedback, t]);
}
