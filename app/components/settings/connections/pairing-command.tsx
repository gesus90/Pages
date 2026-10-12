import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

/** Shows a selectable command and reports clipboard success or failure without losing it. */
export function PairingCommand({
  command,
}: {
  readonly command: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [result, setResult] = useState<"copied" | "copyError" | null>(null);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setResult("copied");
    } catch {
      setResult("copyError");
    }
  }
  return (
    <>
      <pre
        tabIndex={0}
        role="region"
        aria-label={t("settings.connections.guide.step1")}
        className="pages-selectable mt-2 overflow-x-auto rounded-xl bg-muted/40 p-4 text-xs"
      >
        <code>{command}</code>
      </pre>
      <Button
        variant="outline"
        className="mt-2"
        onClick={() => {
          void copy();
        }}
      >
        {t("settings.connections.guide.copy")}
      </Button>
      {result ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t(`settings.connections.guide.${result}`)}
        </p>
      ) : null}
    </>
  );
}
