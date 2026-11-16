import { Lock, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { DocumentState } from "./use-document";

/**
 * What a document card or panel shows while the document loads or when it
 * cannot be read: an encrypted file, a damaged one, or one whose
 * parts are too large. The file stays downloadable in every case.
 */
export function DocumentStateMessage({
  state,
  className,
}: {
  readonly state: Exclude<DocumentState, { readonly status: "ready" }>;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  if (state.status === "loading")
    return (
      <p
        className={cn("p-4 text-sm text-muted-foreground", className)}
        role="status"
      >
        {t("chatPage.cards.document.loading")}
      </p>
    );
  const Icon = state.reason === "encrypted" ? Lock : TriangleAlert;
  return (
    <p
      className={cn(
        "flex items-start gap-2 p-4 text-sm text-muted-foreground",
        className,
      )}
      role="alert"
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-primary"
      />
      {t(`chatPage.cards.document.failed.${state.reason}`)}
    </p>
  );
}
