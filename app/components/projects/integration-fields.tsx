import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ServiceIcon } from "@/app/components/projects/integration-service-icon";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

import type { IntegrationId } from "@/app/components/projects/integration-service-icon";

interface StatusPillProps {
  readonly connected: boolean;
}

/** Renders the green connected or gray disconnected status pill. */
export function StatusPill({ connected }: StatusPillProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap select-none",
        connected
          ? "bg-emerald-50 text-emerald-700"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected ? "bg-emerald-500" : "bg-muted-foreground/60",
        )}
      />
      {connected
        ? t("projectDetail.integrations.connected")
        : t("projectDetail.integrations.notConnected")}
    </span>
  );
}

interface ToggleSwitchProps {
  readonly checked: boolean;
  readonly onChange: (nextChecked: boolean) => void;
  readonly label: string;
}

/** Renders an orange Pages toggle switch with an accessible label. */
function ToggleSwitch({
  checked,
  onChange,
  label,
}: ToggleSwitchProps): React.ReactElement {
  function handleClick(): void {
    onChange(!checked);
  }

  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "cursor-pointer",
        checked ? "justify-end bg-orange-500" : "justify-start bg-muted",
      )}
      onClick={handleClick}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className="mx-0.5 size-5 rounded-full bg-white shadow"
      />
    </button>
  );
}

interface ToggleRowProps {
  readonly title: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onChange: (nextChecked: boolean) => void;
}

/** Renders a labeled setting row with a trailing toggle switch. */
export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
}: ToggleRowProps): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      </div>
      <ToggleSwitch checked={checked} label={title} onChange={onChange} />
    </div>
  );
}

interface CopyFieldProps {
  readonly id: string;
  readonly value: string;
}

/** Renders a readonly value with a copy button, used for webhook URLs and tokens. */
export function CopyField({ id, value }: CopyFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy(): void {
    const clipboard = navigator.clipboard;

    if (!clipboard) {
      return;
    }

    clipboard
      .writeText(value)
      .then(() => {
        setIsCopied(true);
      })
      .catch(() => {
        setIsCopied(false);
      });
  }

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isCopied]);

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        className="h-10 min-w-0 flex-1 truncate text-xs xl:h-10 xl:text-xs"
        readOnly
        type="text"
        value={value}
      />
      <Button
        aria-label={t("projectDetail.interfaces.webhookCopy")}
        className="size-10 shrink-0 px-0"
        onClick={handleCopy}
        title={t("projectDetail.interfaces.webhookCopy")}
        variant="outline"
      >
        {isCopied ? (
          <Check className="size-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

interface FieldLabelProps {
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}

/** Renders a small semibold label used above every panel input. */
export function FieldLabel({
  htmlFor,
  children,
}: FieldLabelProps): React.ReactElement {
  return (
    <label
      className="select-none text-xs font-semibold text-foreground"
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}

interface ServiceIdentityProps {
  readonly id: IntegrationId;
  readonly name: string;
  readonly description: string;
  readonly connected: boolean;
}

/** Renders the service header block at the top of every settings panel. */
export function ServiceIdentity({
  id,
  name,
  description,
  connected,
}: ServiceIdentityProps): React.ReactElement {
  return (
    <div className="flex items-start gap-4">
      <ServiceIcon id={id} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <StatusPill connected={connected} />
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
