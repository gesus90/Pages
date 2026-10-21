import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigation, useRevalidator, useSubmit } from "react-router";

import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { showSuccessToast } from "@/app/components/ui/toast";

/** Why a design theme could not be stored. */
type DesignThemeError = "unknownTheme" | "general";

/** The design theme shown as chosen and the way to choose another one. */
export interface DesignThemeSelectionState {
  readonly selectedId: string;
  /** Why the last attempt to store a choice failed, until the next attempt. */
  readonly error: DesignThemeError | null;
  readonly selectDesignTheme: (designThemeId: string) => void;
}

/**
 * Keeps the chosen design theme of the screen in step with the stored one.
 *
 * @param savedId - The design theme the loader returned.
 *
 * @remarks
 * A choice shows at once and is submitted on its own, apart from the other
 * settings. As soon as the navigation is idle again the stored choice
 * replaces the shown one, which also reverts a rejected choice. A stored
 * choice is announced once with the usual saved message. A theme that is
 * gone makes the page load the list again, because a rejected submission
 * does not reload it on its own. That reload drops the answer of the action,
 * so the error is kept here until the next choice.
 */
export function useDesignThemeSelection(
  savedId: string,
): DesignThemeSelectionState {
  const submit = useSubmit();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-design-theme");
  const { revalidate } = useRevalidator();
  const [selectedId, setSelectedId] = useState(savedId);
  const [error, setError] = useState<DesignThemeError | null>(null);
  const [seenOutcome, setSeenOutcome] = useState(outcome);
  const wasSaving = useRef(false);
  const isSaving = navigation.formData?.get("intent") === "update-design-theme";

  if (outcome !== seenOutcome) {
    setSeenOutcome(outcome);

    if (outcome) {
      setError(outcome.ok ? null : outcome.error);
    }
  }

  useEffect(() => {
    if (isSaving) {
      wasSaving.current = true;
    } else if (wasSaving.current && navigation.state === "idle") {
      wasSaving.current = false;

      if (outcome?.ok) {
        showSuccessToast(t("settings.saved"));
      }
    }
  }, [isSaving, navigation.state, outcome, t]);

  useEffect(() => {
    if (navigation.state === "idle") {
      setSelectedId(savedId);
    }
  }, [navigation.state, savedId]);

  useEffect(() => {
    if (outcome && !outcome.ok && outcome.error === "unknownTheme") {
      void revalidate();
    }
  }, [outcome, revalidate]);

  function selectDesignTheme(designThemeId: string): void {
    if (designThemeId === selectedId) {
      return;
    }

    const formData = new FormData();

    formData.set("intent", "update-design-theme");
    formData.set("designTheme", designThemeId);
    setError(null);
    setSelectedId(designThemeId);
    void submit(formData, { method: "post" });
  }

  return { error, selectDesignTheme, selectedId };
}
