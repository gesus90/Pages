import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentActions } from "./use-agent-actions";
import type { FormEvent } from "react";

/**
 * Completes a Google sign-in from a browser that cannot reach the server's loopback.
 *
 * @remarks
 * After consent Google redirects to `127.0.0.1` on the user's own device. The
 * copied address leaves this form only through the protected POST action, which
 * accepts it once and only for the login this administrator started.
 */
export function AgentLoginRedirect({
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
