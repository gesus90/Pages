import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AuthField } from "@/app/components/auth/auth-field";
import { AuthHeading } from "@/app/components/auth/auth-heading";

import { SetupStepActions } from "./setup-step-actions";

import type { FetcherWithComponents } from "react-router";
import type { SetupActionData } from "@/app/lib/setup/setup-action-data";
import type { SetupAccessNotice } from "./use-setup-access";

const NOTICE_MESSAGE_KEYS: Readonly<Record<SetupAccessNotice, string>> = {
  expired: "setup.token.expired",
  invalid: "setup.token.invalid",
  network: "setup.error.network",
};

interface SetupTokenFormProps {
  readonly tokenFetcher: FetcherWithComponents<SetupActionData>;
  readonly notice: SetupAccessNotice | null;
}

/**
 * Renders the form that asks for the setup token when the page was opened
 * without a valid setup link.
 */
export function SetupTokenForm({
  tokenFetcher,
  notice,
}: SetupTokenFormProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <tokenFetcher.Form method="post" action="/setup" noValidate>
      <input type="hidden" name="intent" value="verify-token" />
      <AuthHeading
        title={t("setup.token.title")}
        subtitle={t("setup.token.subtitle")}
      />
      <AuthField
        className="mt-8"
        name="token"
        label={t("setup.token.label")}
        placeholder={t("setup.token.placeholder")}
        icon={KeyRound}
        autoComplete="off"
        spellCheck={false}
        required
        error={notice === null ? null : t(NOTICE_MESSAGE_KEYS[notice])}
      />
      <SetupStepActions
        submitLabel={t("setup.token.submit")}
        pendingLabel={t("setup.token.submitting")}
        isPending={tokenFetcher.state !== "idle"}
      />
    </tokenFetcher.Form>
  );
}
