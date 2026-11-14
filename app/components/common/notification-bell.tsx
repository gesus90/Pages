import { Bell, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
  ToastContent,
  ToastSymbol,
} from "@/app/components/ui/toast/toast-content";
import { useToastCenter } from "@/app/components/ui/toast/toast-provider";

/** The bell retains chat and error notices after their pop-ups have gone. */
export function NotificationBell(): React.ReactElement {
  const { t } = useTranslation();
  const { inbox, dispatch } = useToastCenter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t("toast.notifications", { count: inbox.length })}
        >
          <Bell className="size-5" aria-hidden="true" />
          {inbox.length > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-0 right-0 rounded-full bg-primary-subtle px-1 text-xs font-semibold text-toast-action"
            >
              {inbox.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-70 w-88 max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuLabel>{t("toast.history")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {inbox.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {t("toast.empty")}
          </p>
        ) : null}
        {inbox.map((notice) => (
          <div key={notice.id} className="flex items-start gap-1">
            <DropdownMenuItem
              className="min-w-0 flex-1 items-start gap-3"
              onSelect={(event) => {
                if (!notice.action) {
                  event.preventDefault();
                  return;
                }
                dispatch({ type: "dismiss", id: notice.id });
                dispatch({ type: "forget", id: notice.id });
                notice.action?.onClick();
              }}
            >
              <ToastSymbol toast={notice} />
              <ToastContent toast={notice} />
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-label={t("toast.close")}
              onSelect={() => dispatch({ type: "forget", id: notice.id })}
            >
              <X className="size-4" aria-hidden="true" />
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
