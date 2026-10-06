import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface TemporaryPasswordResultProps {
  readonly password: string;
  readonly onClose: () => void;
}

/** Shows a generated password until dismissal; only the hash is stored server-side. */
export function TemporaryPasswordResult({
  password,
  onClose,
}: TemporaryPasswordResultProps): React.ReactElement {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy(): void {
    void copyPassword();
  }

  async function copyPassword(): Promise<void> {
    if (!navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(password);
      setIsCopied(true);
    } catch {
      setIsCopied(false);
    }
  }

  useEffect(() => {
    if (!isCopied) {
      return;
    }
    const timeout = window.setTimeout(() => setIsCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [isCopied]);

  return (
    <div className="mt-5 flex flex-col gap-3">
      <span className="text-sm font-medium">
        {t("users.reset.temporaryPassword")}
      </span>
      <div className="flex items-center gap-2">
        <p className="pages-selectable min-w-0 flex-1 rounded-xl bg-muted px-4 py-3 font-mono text-sm">
          {password}
        </p>
        <Button type="button" variant="outline" onClick={handleCopy}>
          {isCopied ? (
            <Check className="size-4 text-success" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {t(isCopied ? "users.reset.copied" : "users.reset.copy")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("users.reset.deliveryHint")}
      </p>
      <div className="mt-6 flex justify-end">
        <Button type="button" onClick={onClose}>
          {t("users.reset.close")}
        </Button>
      </div>
    </div>
  );
}
