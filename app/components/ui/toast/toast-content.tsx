import { CheckCircle2, CircleX, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { USER_AVATAR_TYPE } from "@/definition/User";

import type { ToastMessage } from "./toast-types";

const SYMBOLS = {
  success: { icon: CheckCircle2, color: "text-success" },
  info: { icon: Info, color: "text-info" },
  warning: { icon: TriangleAlert, color: "text-warning" },
  error: { icon: CircleX, color: "text-destructive" },
} as const;

/** The shared decorative symbol or name-derived 32 px chat avatar. */
export function ToastSymbol({
  toast,
}: {
  readonly toast: ToastMessage;
}): React.ReactElement {
  if (toast.type === "chat")
    return (
      <UserAvatar
        name={toast.message}
        avatarType={
          toast.avatarImageUrl
            ? USER_AVATAR_TYPE.IMAGE
            : USER_AVATAR_TYPE.INITIALS
        }
        avatarImageUrl={toast.avatarImageUrl}
        className="size-8 text-foreground"
      />
    );
  const { icon: Icon, color } = SYMBOLS[toast.type];
  return (
    <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden="true" />
  );
}

/** Title, unread count and single-line preview shared with the bell. */
export function ToastContent({
  toast,
}: {
  readonly toast: ToastMessage;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5 text-sm leading-5 font-medium">
        <span className="min-w-0 truncate">{toast.message}</span>
        {toast.type === "chat" ? (
          <span className="shrink-0 rounded-full bg-primary-subtle px-1.5 text-[13px] leading-4.5 text-toast-action">
            {t("toast.newMessages", { count: toast.count })}
          </span>
        ) : null}
      </div>
      {toast.description ? (
        <p className="mt-0.5 truncate text-[13px] leading-4.5 text-muted-foreground">
          {toast.description}
        </p>
      ) : null}
    </div>
  );
}
