import { KeyRound } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  useActionData,
  useNavigation,
  useRevalidator,
} from "react-router";

import { AuthField } from "@/app/components/auth/auth-field";
import { AuthSubmitButton } from "@/app/components/auth/auth-submit-button";

/** Lets an authenticated user enter the same human code shown in a remote terminal. */
export function PairingEntry({
  retryAfter,
}: {
  readonly retryAfter?: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const result = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!retryAfter) return;
    const timer = window.setTimeout(() => {
      void revalidator.revalidate();
    }, retryAfter * 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter, revalidator]);
  const error = retryAfter
    ? t("mcpPairing.enter.errorLocked", { minutes: Math.ceil(retryAfter / 60) })
    : undefined;
  return (
    <Form method="post" className="mt-6 space-y-4">
      <input type="hidden" name="intent" value="enter-code" />
      <AuthField
        name="code"
        icon={KeyRound}
        label={t("mcpPairing.enter.label")}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={64}
        describedBy="pairing-entry-hint"
        error={
          error ??
          (result?.error ? t("mcpPairing.enter.errorFormat") : undefined)
        }
      />
      <p id="pairing-entry-hint" className="text-xs text-muted-foreground">
        {t("mcpPairing.enter.hint")}
      </p>
      <AuthSubmitButton
        label={t("mcpPairing.enter.submit")}
        pendingLabel={t("mcpPairing.enter.submit")}
        isPending={navigation.state === "submitting"}
        disabled={Boolean(retryAfter)}
        className="w-full text-foreground"
      />
    </Form>
  );
}
