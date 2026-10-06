import { useTranslation } from "react-i18next";

import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { useManagementPending } from "./use-management-pending";
import type { ReactNode } from "react";

/** Shared compact management table surface with horizontal overflow fades. */
export function ManagementTable({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const isPending = useManagementPending();
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-surface shadow-card"
      aria-busy={isPending}
    >
      {isPending ? (
        <div
          role="status"
          aria-label={t("users.loading")}
          className="absolute inset-0 z-10 flex flex-col gap-4 bg-surface p-4"
        >
          {[1, 2, 3].map((row) => (
            <div key={row} className="h-4 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : null}
      <HorizontalScrollArea>
        <table className="w-full border-collapse text-left text-sm">
          {children}
        </table>
      </HorizontalScrollArea>
    </div>
  );
}
