import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { FormEvent } from "react";

/** Saves whole-day personal validity with native and server-side validation. */
export function TokenDurationForm({
  days,
  pending,
  onValidity,
}: {
  readonly days: number;
  readonly pending: boolean;
  readonly onValidity: (days: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function submitDuration(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onValidity(String(new FormData(event.currentTarget).get("days")));
  }
  return (
    <form onSubmit={submitDuration} className="mb-5 space-y-2">
      <label htmlFor="token-days" className="block text-sm font-medium">
        {t("mcpDuration.label")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          key={days}
          id="token-days"
          name="days"
          type="number"
          min={0}
          max={365}
          step={1}
          required
          defaultValue={days}
          disabled={pending}
          aria-describedby="token-days-hint"
          className="max-w-32"
        />
        <Button type="submit" variant="outline" isPending={pending}>
          {t("settings.connections.save")}
        </Button>
      </div>
      <p id="token-days-hint" className="text-xs text-muted-foreground">
        {t("mcpDuration.hint")}
      </p>
    </form>
  );
}
