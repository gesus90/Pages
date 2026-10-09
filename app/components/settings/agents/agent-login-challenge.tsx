import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import { AgentCopyButton } from "./agent-copy-button";

import type {
  AgentConnectionSummary,
  CliLoginView,
} from "@/definition/AgentConnection";
import type { AgentActions } from "./use-agent-actions";
import type { FormEvent } from "react";

/** Renders the protected polling response; entered codes never leave this form except via POST. */
export function AgentLoginChallenge({
  connection,
  login,
  actions,
}: {
  readonly connection: AgentConnectionSummary;
  readonly login: CliLoginView;
  readonly actions: AgentActions;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const [code, setCode] = useState("");
  useEffect(() => {
    if (actions.result?.ok && actions.result.intent === "submit-login-code")
      setCode("");
  }, [actions.result]);
  function submitCode(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    actions.submit("submit-login-code", connection.id, { code });
  }
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {t(`settings.agents.loginState.${login.state}`)}
      </p>
      {login.verificationUrl ? (
        <a
          href={login.verificationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("settings.agents.openLogin")}
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      ) : null}
      {login.userCode ? (
        <>
          <p className="pages-selectable text-2xl font-semibold tracking-widest">
            {login.userCode}
          </p>
          <AgentCopyButton
            text={login.userCode}
            label={t("settings.agents.copyCode")}
          />
        </>
      ) : null}
      {login.expiresAt ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.validUntil", {
            time: formatDateTime(login.expiresAt),
          })}
        </p>
      ) : null}
      {connection.provider === "claude_code" &&
      login.state === "awaiting_user" ? (
        <form onSubmit={submitCode} className="space-y-2">
          <label className="text-sm font-medium" htmlFor="agent-login-code">
            {t("settings.agents.anthropicCode")}
          </label>
          <Input
            id="agent-login-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            maxLength={512}
            required
            aria-invalid={
              actions.error === "login_code_invalid" ||
              actions.error === "login_code_rejected"
            }
            aria-describedby={actions.error ? "agent-action-error" : undefined}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!code.trim() || actions.isPending}
            isPending={actions.pendingIntent === "submit-login-code"}
          >
            {t("settings.agents.finishLogin")}
          </Button>
        </form>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={actions.isPending}
        onClick={() => actions.submit("cancel-login", connection.id)}
      >
        {t("settings.agents.cancel")}
      </Button>
    </div>
  );
}
