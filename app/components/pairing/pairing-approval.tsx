import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AuthField } from "@/app/components/auth/auth-field";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import type { MouseEvent } from "react";

/** Keeps labels, hints and errors associated with the explicit approval fields. */
export function PairingApprovalFields({
  name,
  confirmed,
  attempted,
  validityDays,
  onName,
  onConfirmed,
}: {
  readonly name: string;
  readonly confirmed: boolean;
  readonly attempted: boolean;
  readonly validityDays?: number;
  readonly onName: (name: string) => void;
  readonly onConfirmed: (confirmed: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <AuthField
        name="name"
        icon={KeyRound}
        label={t("mcpPairing.form.name")}
        maxLength={100}
        value={name}
        onChange={(event) => onName(event.target.value)}
        describedBy="pairing-name-hint"
        error={
          attempted && !name.trim()
            ? t("mcpPairing.form.error.name")
            : undefined
        }
      />
      <p id="pairing-name-hint" className="text-xs text-muted-foreground">
        {t("mcpPairing.form.nameHint")}
      </p>
      <label htmlFor="validityDays" className="block text-sm font-medium">
        {t("mcpDuration.label")}
      </label>
      <Input
        id="validityDays"
        name="validityDays"
        type="number"
        min={0}
        max={365}
        step={1}
        defaultValue={validityDays ?? 30}
        aria-describedby="pairing-validity-hint"
      />
      <p id="pairing-validity-hint" className="text-xs text-muted-foreground">
        {t("mcpDuration.hint")} {t("mcpPairing.form.validityHint")}
      </p>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox
          name="confirmMatch"
          checked={confirmed}
          onChange={(event) => onConfirmed(event.target.checked)}
          aria-invalid={attempted && !confirmed}
          aria-describedby={
            attempted && !confirmed ? "pairing-match-error" : undefined
          }
        />
        {t("mcpPairing.form.confirmMatch")}
      </label>
      {attempted && !confirmed ? (
        <p
          id="pairing-match-error"
          role="alert"
          className="pages-selectable text-xs text-destructive"
        >
          {t("mcpPairing.form.error.confirmMatch")}
        </p>
      ) : null}
    </>
  );
}

/** Explains the exact account rights and displays deliberate deny/approve actions. */
export function PairingApprovalActions({
  isAdmin,
  pending,
  hasError,
  onApprove,
}: {
  readonly isAdmin: boolean;
  readonly pending: boolean;
  readonly hasError: boolean;
  readonly onApprove: (event: MouseEvent<HTMLButtonElement>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex gap-2 rounded-xl bg-muted/40 p-4 text-sm">
        <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
        <div>
          {t("mcpPairing.rights")}
          {isAdmin ? (
            <p className="mt-2">{t("mcpPairing.rightsAdmin")}</p>
          ) : null}
        </div>
      </div>
      {hasError ? (
        <p role="alert" className="pages-selectable text-sm text-destructive">
          {t("mcpPairing.error.decision")}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          name="decision"
          value="deny"
          type="submit"
          disabled={pending}
        >
          {t("mcpPairing.deny")}
        </Button>
        <Button
          variant="auth"
          className="text-foreground"
          name="decision"
          value="approve"
          type="submit"
          disabled={pending}
          onClick={onApprove}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t("mcpPairing.approve")}
        </Button>
      </div>
    </>
  );
}
