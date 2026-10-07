import { KeyRound, Lock, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SessionRow } from "@/app/components/settings/session-row";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { WHITE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";

import type { SessionSummary } from "@/definition/Session";

interface SecurityCardProps {
  readonly sessions: readonly SessionSummary[];
  readonly onChangePassword: () => void;
  readonly onRevokeSession: (sessionId: string) => void;
  readonly onRevokeOtherSessions: () => void;
}

/** Renders the password entry and the list of active sessions. */
export function SecurityCard({
  sessions,
  onChangePassword,
  onRevokeSession,
  onRevokeOtherSessions,
}: SecurityCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SettingsCard
      description={t("settings.security.description")}
      icon={<Lock className="size-4" aria-hidden="true" />}
      title={t("settings.security.title")}
    >
      <div className="flex flex-col">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <KeyRound className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("settings.security.password.title")}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.security.password.description")}
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 px-3 text-xs"
            onClick={onChangePassword}
            variant="outline"
          >
            {t("settings.security.password.action")}
          </Button>
        </div>

        <div className="mt-6 pt-1">
          <div className="flex items-center gap-3">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <Monitor className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("settings.security.sessions.title")}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.security.sessions.description")}
              </p>
            </div>
          </div>

          <VerticalScrollArea
            className="mt-3 max-h-80"
            contentClassName="space-y-2 pr-1.5"
            style={WHITE_SCROLL_FADE_STYLE}
          >
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                onRevoke={() => onRevokeSession(session.id)}
                session={session}
              />
            ))}
          </VerticalScrollArea>

          {sessions.length > 1 ? (
            <Button
              className="mt-3 w-full border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onRevokeOtherSessions}
              variant="outline"
            >
              {t("settings.security.sessions.endOthers")}
            </Button>
          ) : null}
        </div>
      </div>
    </SettingsCard>
  );
}
