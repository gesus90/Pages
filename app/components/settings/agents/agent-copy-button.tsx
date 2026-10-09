import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

/** Copies only a displayed login challenge or isolated terminal command. */
export function AgentCopyButton({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(t("settings.agents.copied"));
    } catch {
      setMessage(t("settings.agents.copyFailed"));
    }
  }
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        type="button"
        onClick={() => {
          void copy();
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
        {label}
      </Button>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
