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
import type { FormEvent } from "react";
import type { AgentActions } from "./use-agent-actions";

// After consent Google redirects to `127.0.0.1` on the user's own device.
// The copied address leaves this form only through the protected POST action,
// which accepts it once and only for the login this administrator started.
function AgentLoginRedirect({
  connection,
  actions,
}: {
  readonly connection: AgentConnectionSummary;
  readonly actions: AgentActions;
}): React.ReactElement {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  useEffect(() => {
    if (actions.result?.ok && actions.result.intent === "submit-login-redirect")
      setAddress("");
  }, [actions.result]);
  function submitAddress(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    actions.submit("submit-login-redirect", connection.id, { address });
  }
  const isRejected =
    actions.error === "login_callback_invalid" ||
    actions.error === "login_callback_unreachable";
  return (
    <form onSubmit={submitAddress} className="space-y-2">
      <label className="text-sm font-medium" htmlFor="agent-login-redirect">
        {t("settings.agents.antigravityRedirectLabel")}
      </label>
      <p
        id="agent-login-redirect-hint"
        className="text-xs text-muted-foreground"
      >
        {t("settings.agents.antigravityRedirectHint")}
      </p>
      <Input
        id="agent-login-redirect"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={4096}
        placeholder="http://127.0.0.1:…/?state=…&code=…"
        required
        aria-invalid={isRejected}
        aria-describedby={
          actions.error
            ? "agent-login-redirect-hint agent-action-error"
            : "agent-login-redirect-hint"
        }
      />
      <Button
        type="submit"
        size="sm"
        disabled={!address.trim() || actions.isPending}
        isPending={actions.pendingIntent === "submit-login-redirect"}
      >
        {t("settings.agents.finishLogin")}
      </Button>
    </form>
  );
}

function LoginCodeForm({
  connection,
  actions,
}: {
  readonly connection: AgentConnectionSummary;
  readonly actions: AgentActions;
}): React.ReactElement {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const isAntigravity = connection.provider === "antigravity";
  useEffect(() => {
    if (actions.result?.ok && actions.result.intent === "submit-login-code")
      setCode("");
  }, [actions.result]);
  function submitCode(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    actions.submit("submit-login-code", connection.id, { code });
  }
  return (
    <form onSubmit={submitCode} className="space-y-2">
      <label className="text-sm font-medium" htmlFor="agent-login-code">
        {t(
          isAntigravity
            ? "settings.agents.antigravityCode"
            : "settings.agents.anthropicCode",
        )}
      </label>
      <Input
        id="agent-login-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        maxLength={isAntigravity ? 4096 : 512}
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
  );
}

function LoginCompletion({
  connection,
  login,
  actions,
}: {
  readonly connection: AgentConnectionSummary;
  readonly login: CliLoginView;
  readonly actions: AgentActions;
}): React.ReactElement | null {
  if (login.state !== "awaiting_user" || login.isOwnLogin === false)
    return null;
  if (connection.provider === "antigravity" && login.canSubmitRedirect)
    return <AgentLoginRedirect connection={connection} actions={actions} />;
  // `agy acp --login` and Claude Code both wait for a code pasted from the provider's page.
  if (
    connection.provider === "claude_code" ||
    connection.provider === "antigravity"
  )
    return <LoginCodeForm connection={connection} actions={actions} />;
  return null;
}

function GoogleCallbackHint({
  provider,
  state,
}: {
  readonly provider: AgentConnectionSummary["provider"];
  readonly state: CliLoginView["state"];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (provider !== "antigravity" || state !== "awaiting_user") return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t("settings.agents.antigravityLoginHint")}
    </p>
  );
}

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
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {t(`settings.agents.loginState.${login.state}`)}
      </p>
      {login.isOwnLogin === false ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.loginStartedByOther")}
        </p>
      ) : (
        <GoogleCallbackHint
          provider={connection.provider}
          state={login.state}
        />
      )}
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
      <LoginCompletion
        connection={connection}
        login={login}
        actions={actions}
      />
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
