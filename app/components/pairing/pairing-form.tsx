import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  useActionData,
  useNavigation,
  useRevalidator,
} from "react-router";

import { PairingRequestSummary } from "./pairing-request-summary";
import {
  PairingApprovalFields,
  PairingApprovalActions,
} from "./pairing-approval";

import type { KeyboardEvent, MouseEvent } from "react";
import type { McpPairingView } from "@/definition/McpPairing";

/** Renders an explicit, deliberate approval; Enter in a text field never grants access. */
export function PairingForm({
  view,
}: {
  readonly view: McpPairingView;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const result = useActionData<{ error?: string }>();
  const revalidator = useRevalidator();
  const [name, setName] = useState(
    t("mcpPairing.form.nameDefault", {
      client: view.clientName,
      device: view.device,
    }).slice(0, 100),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [expired, setExpired] = useState(false);
  const pending = navigation.state === "submitting";
  useEffect(() => {
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, (view.expiresAt ?? 0) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [view.expiresAt]);
  useEffect(() => {
    if (expired) return;
    const timer = window.setInterval(() => {
      if (revalidator.state === "idle" && navigation.state === "idle")
        void revalidator.revalidate();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [expired, revalidator, navigation.state]);
  function preventEnter(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement)
      event.preventDefault();
  }
  function approve(event: MouseEvent<HTMLButtonElement>): void {
    setAttempted(true);
    if (!confirmed || !name.trim()) event.preventDefault();
  }
  if (expired)
    return (
      <p role="status" className="mt-6 text-sm">
        {t("mcpPairing.expired.description")}
      </p>
    );
  return (
    <div className="mt-6 space-y-5">
      <PairingRequestSummary view={view} />
      <Form
        method="post"
        onKeyDown={preventEnter}
        className="space-y-4"
        noValidate
      >
        <input type="hidden" name="code" value={view.code} />
        <input type="hidden" name="csrf" value={view.csrf} />
        <PairingApprovalFields
          name={name}
          confirmed={confirmed}
          attempted={attempted}
          validityDays={view.validityDays}
          onName={setName}
          onConfirmed={setConfirmed}
        />
        <PairingApprovalActions
          isAdmin={view.account.isAdmin}
          pending={pending}
          hasError={Boolean(result?.error)}
          onApprove={approve}
        />
      </Form>
    </div>
  );
}
