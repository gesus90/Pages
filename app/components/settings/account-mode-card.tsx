import { Shield } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";
import { Button } from "@/app/components/ui/button";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { showSuccessToast } from "@/app/components/ui/toast";

import type { AccountAccess } from "@/definition/Authorization";

/** Displays personal admin eligibility separately from the reusable role and active mode. */
export function AccountModeCard({
  account,
}: {
  readonly account: AccountAccess;
}): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("set-mode");
  const previous = useRef(outcome);
  const navigation = useNavigation();
  useEffect(() => {
    if (outcome === previous.current) return;
    previous.current = outcome;
    if (outcome?.ok) showSuccessToast(t("users.saved"));
  }, [outcome, t]);
  return (
    <SettingsCard
      title={t("users.mode.title")}
      description={t("users.mode.description")}
      icon={<Shield className="size-4" aria-hidden="true" />}
    >
      <p className="text-sm">
        {t(`users.mode.${account.mode}`)} ·{" "}
        <span className="pages-selectable">{account.role?.name ?? "—"}</span>
      </p>
      {account.isAdmin ? (
        <Form method="post" className="mt-4">
          <input name="intent" type="hidden" value="set-mode" />
          <input
            name="mode"
            type="hidden"
            value={account.mode === "admin" ? "role" : "admin"}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={account.role === null}
            isPending={
              navigation.state === "submitting" &&
              navigation.formData?.get("intent") === "set-mode"
            }
          >
            {t(
              account.mode === "admin"
                ? "users.mode.toRole"
                : "users.mode.toAdmin",
            )}
          </Button>
          {account.role === null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("users.mode.needsRole")}
            </p>
          ) : null}
        </Form>
      ) : null}
      {outcome?.ok === false ? (
        <p
          role="alert"
          className="pages-selectable mt-3 text-sm text-destructive"
        >
          {t("users.error.forbidden")}
        </p>
      ) : null}
    </SettingsCard>
  );
}
