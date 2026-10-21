import { CircleCheck, CircleMinus, CircleX, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { RemoteActionMessage } from "./remote-action-message";
import { hostKeyLabel } from "./remote-host-key";

import type {
  RemoteActionResult,
  RemoteHostKey,
  RemoteTestResult,
  RemoteTestStep,
} from "@/definition/RemoteConnection";

// A new result appears below the fields; it is scrolled into view so the
// outcome and a pending host key confirmation are seen without scrolling.
function revealResult(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}

const STEP_ICONS = {
  passed: { icon: CircleCheck, className: "text-success" },
  failed: { icon: CircleX, className: "text-destructive" },
  skipped: { icon: CircleMinus, className: "text-muted-foreground" },
} as const;

function TestStep(props: {
  readonly label: string;
  readonly step: RemoteTestStep;
}): React.ReactElement {
  const { t } = useTranslation();
  const { icon: Icon, className } = STEP_ICONS[props.step.state];
  const detail = props.step.code
    ? t(`remote.failure.${props.step.code}`)
    : t(`remote.test.${props.step.state}`);
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", className)}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="font-medium">{props.label}</span>
        <span className="text-muted-foreground"> – {detail}</span>
      </span>
    </li>
  );
}

/** Shows the presented key so a person compares it with the machine before trusting it. */
function HostKeyConfirmation(props: {
  readonly hostKey: RemoteHostKey;
  readonly isChanged: boolean;
  readonly disabled: boolean;
  readonly onConfirm: (hostKey: RemoteHostKey) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3 text-sm",
        props.isChanged
          ? "border-destructive/40 bg-destructive/5"
          : "border-warning/40 bg-warning-subtle",
      )}
    >
      <p className="flex items-start gap-2 font-medium">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t(
          props.isChanged
            ? "remote.test.changedWarning"
            : "remote.test.unconfirmed",
        )}
      </p>
      <p className="pages-selectable font-mono text-xs break-all">
        {hostKeyLabel(props.hostKey)} · {props.hostKey.fingerprint}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("remote.test.confirmHint")}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() => props.onConfirm(props.hostKey)}
      >
        {t(
          props.isChanged
            ? "remote.test.confirmChanged"
            : "remote.test.confirm",
        )}
      </Button>
    </div>
  );
}

/** The stages of the last test and, where needed, the host key confirmation. */
export function RemoteTestPanel(props: {
  readonly test: RemoteTestResult | null;
  readonly result: RemoteActionResult | undefined;
  readonly isTesting: boolean;
  readonly onConfirm: (hostKey: RemoteHostKey) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (props.isTesting)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("remote.dialog.testing")}
      </p>
    );
  if (props.result?.ok === false)
    return <RemoteActionMessage result={props.result} />;
  const { test } = props;
  if (!test) return null;
  const code = test.hostKey.code;
  const needsConfirmation =
    test.presentedHostKey !== null &&
    (code === "host_key_unconfirmed" || code === "host_key_changed");
  return (
    <section ref={revealResult} role="status" className="space-y-3">
      <ul className="space-y-1.5 text-sm">
        <TestStep
          label={t("remote.test.reachability")}
          step={test.reachability}
        />
        <TestStep label={t("remote.test.hostKey")} step={test.hostKey} />
        <TestStep
          label={t("remote.test.authentication")}
          step={test.authentication}
        />
      </ul>
      {needsConfirmation && test.presentedHostKey ? (
        <HostKeyConfirmation
          hostKey={test.presentedHostKey}
          isChanged={code === "host_key_changed"}
          disabled={props.isTesting}
          onConfirm={props.onConfirm}
        />
      ) : null}
    </section>
  );
}
