import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { Button } from "@/app/components/ui/button";

import { McpPairingOutcome } from "./mcp-pairing-outcome";
import { usePairingCountdown } from "./use-pairing-countdown";

import type { KeyboardEvent } from "react";
import type { McpPairingServer } from "@/definition/McpDevice";

interface McpPairingOpenProps {
  readonly code: string;
  readonly deviceName: string;
  readonly remainingMs: number;
  readonly server: McpPairingServer;
  readonly accountName: string;
}

/** One labelled fact of the request. */
function PairingFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: string;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="pages-selectable min-w-0 text-right text-sm font-semibold break-words text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** Pressing Enter on the page decides nothing; only a click on a button does. */
function ignoreEnterOutsideButtons(
  event: KeyboardEvent<HTMLFormElement>,
): void {
  if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
  }
}

/** Shows an open code with its rest time, the machine, the server and the account, and asks to pair or reject. */
export function McpPairingOpen({
  code,
  deviceName,
  remainingMs,
  server,
  accountName,
}: McpPairingOpenProps): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const countdown = usePairingCountdown(remainingMs);
  const decision = navigation.formData?.get("decision");
  const isSubmitting = navigation.state === "submitting";

  if (countdown.hasExpired) {
    return <McpPairingOutcome state="expired" deviceName={null} />;
  }

  return (
    <>
      <AuthHeading
        title={t("mcpPairing.title")}
        subtitle={t("mcpPairing.subtitle")}
      />
      <p
        className="pages-selectable mt-8 text-center font-mono text-4xl font-bold tracking-widest text-foreground sm:text-5xl"
        translate="no"
      >
        {code}
      </p>
      <p
        className="mt-2 text-center text-sm text-muted-foreground"
        role="timer"
      >
        {t("mcpPairing.remaining", { time: countdown.text })}
      </p>
      <dl className="mt-6 divide-y divide-border border-y border-border">
        <PairingFact label={t("mcpPairing.device")}>{deviceName}</PairingFact>
        <PairingFact label={t("mcpPairing.server")}>
          {`${server.host} · ${server.isSecure ? "HTTPS" : "HTTP"}`}
        </PairingFact>
        <PairingFact label={t("mcpPairing.account")}>{accountName}</PairingFact>
      </dl>
      <Form
        className="mt-8 grid grid-cols-2 gap-3"
        method="post"
        noValidate
        onKeyDown={ignoreEnterOutsideButtons}
      >
        <input name="code" type="hidden" value={code} />
        <Button
          className="h-12 w-full rounded-xl text-base sm:h-14"
          disabled={isSubmitting}
          isPending={isSubmitting && decision === "deny"}
          name="decision"
          type="submit"
          value="deny"
          variant="outline"
        >
          {t("mcpPairing.deny")}
        </Button>
        <Button
          disabled={isSubmitting}
          isPending={isSubmitting && decision === "approve"}
          name="decision"
          type="submit"
          value="approve"
          variant="auth"
        >
          {t("mcpPairing.approve")}
        </Button>
      </Form>
    </>
  );
}
