import { Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { openRouterBalanceDisplaySchema } from "@/definition/OpenRouterQuota";

import type { FormEvent } from "react";
import type { OpenRouterBalanceDisplay } from "@/definition/OpenRouterQuota";
import type {
  OpenRouterBalanceSaveResult,
  SaveOpenRouterBalance,
} from "./quota-requests";

const BALANCE_ERRORS = {
  invalidAmount: "agentsPage.openRouter.invalidStartAmount",
  baselineUnavailable: "agentsPage.openRouter.baselineUnavailable",
  connectionChanged: "agentsPage.openRouter.balanceConnectionChanged",
  failed: "agentsPage.openRouter.balanceSaveFailed",
} as const;

type BalanceMode = OpenRouterBalanceDisplay["mode"];
type BalanceError =
  Exclude<OpenRouterBalanceSaveResult, "saved"> | "invalidAmount";

interface OpenRouterBalanceDialogProps {
  readonly connectionId: string;
  readonly name: string;
  readonly display: OpenRouterBalanceDisplay;
  readonly onSave: SaveOpenRouterBalance;
}

function BalanceFields({
  mode,
  initialAmount,
  onModeChange,
}: {
  readonly mode: BalanceMode;
  readonly initialAmount: number | undefined;
  readonly onModeChange: (mode: BalanceMode) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isManual = mode === "manual";
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="balanceMode"
          checked={!isManual}
          onChange={() => onModeChange("account")}
          className="accent-primary"
        />
        {t("agentsPage.openRouter.accountBalanceMode")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="balanceMode"
          checked={isManual}
          onChange={() => onModeChange("manual")}
          className="accent-primary"
        />
        {t("agentsPage.openRouter.manualBalanceMode")}
      </label>
      <label hidden={!isManual} className="space-y-1 text-sm">
        <span className="block">
          {t("agentsPage.openRouter.manualStartAmount")}
        </span>
        <Input
          name="startAmount"
          type="number"
          min="0"
          step="any"
          required={isManual}
          disabled={!isManual}
          defaultValue={initialAmount}
        />
      </label>
    </>
  );
}

/** Edits the balance display from a connection's quota card. */
export function OpenRouterBalanceDialog({
  connectionId,
  name,
  display,
  onSave,
}: OpenRouterBalanceDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<BalanceMode>(display.mode);
  const [initialAmount, setInitialAmount] = useState<number>();
  const [error, setError] = useState<BalanceError | null>(null);
  const title = t("agentsPage.openRouter.balanceSettings");

  function handleOpenChange(open: boolean): void {
    if (isSaving) return;
    if (open) {
      setMode(display.mode);
      setInitialAmount(
        display.mode === "manual" ? display.startAmount : undefined,
      );
      setError(null);
    }
    setIsOpen(open);
  }

  async function save(requested: OpenRouterBalanceDisplay): Promise<void> {
    setIsSaving(true);
    setError(null);
    const result = await onSave(connectionId, requested);
    setIsSaving(false);
    if (result === "saved") setIsOpen(false);
    else setError(result);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSaving) return;
    const amount = event.currentTarget.elements.namedItem("startAmount");
    const parsed = openRouterBalanceDisplaySchema.safeParse({
      mode,
      startAmount:
        amount instanceof HTMLInputElement ? amount.valueAsNumber : undefined,
    });
    if (!parsed.success) {
      setError("invalidAmount");
      return;
    }
    void save(parsed.data);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          title={title}
          aria-label={title}
          className="shrink-0 rounded-[9px] border-border-strong text-muted-foreground"
        >
          <Settings2 aria-hidden="true" className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("agentsPage.openRouter.balanceSettingsHint", { name })}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-5">
          <fieldset
            aria-label={title}
            disabled={isSaving}
            className="space-y-3"
          >
            <BalanceFields
              mode={mode}
              initialAmount={initialAmount}
              onModeChange={setMode}
            />
          </fieldset>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t(BALANCE_ERRORS[error])}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" disabled={isSaving}>
                {t("settings.agents.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" isPending={isSaving}>
              {t("settings.agents.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
