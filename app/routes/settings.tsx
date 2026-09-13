import {
  AtSign,
  BarChart,
  Bell,
  CalendarDays,
  CheckSquare,
  Globe,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  Monitor,
  MoreHorizontal,
  Pencil,
  Server,
  Smartphone,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { cn } from "@/app/lib/cn";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { getSessionToken } from "@/app/lib/session.server";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/database/repositories/UserRepository";
import {
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
} from "@/backend/service/UserService";
import { ROLE, isRole } from "@/definition/Role";
import {
  USER_DATE_FORMATS,
  USER_NOTIFICATION_KEYS,
  USER_TIMEZONES,
  isUserDateFormat,
  isUserTimezone,
  isUserWeekStart,
} from "@/definition/Settings";
import { USER_AVATAR_TYPE } from "@/definition/User";
import { isLanguage, LANGUAGE } from "@/language/Language";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { ChangeEvent, ReactNode } from "react";
import type { TFunction } from "i18next";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";
import type { SessionSummary } from "@/definition/Session";
import type { UserNotificationKey, UserSettings } from "@/definition/Settings";

const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 1000;
const MAXIMUM_AVATAR_SIZE = 5 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Outcome of a password change attempt reported to the visitor. */
type PasswordChangeOutcome =
  | "success"
  | "invalidInput"
  | "invalidCurrent"
  | "mismatch"
  | "tooShort"
  | "unchanged";

/** Error codes when updating the personal profile. */
type ProfileUpdateErrorCode =
  | "invalidInput"
  | "invalidAvatar"
  | "usernameTaken"
  | "emailTaken"
  | "forbidden"
  | "lastAdministrator"
  | "general";

/** Error codes when a user replaces only their own avatar image. */
type AvatarUpdateErrorCode = "invalidInput" | "invalidAvatar" | "general";

type SettingsActionData =
  | {
      readonly intent: "change-password";
      readonly outcome: PasswordChangeOutcome;
    }
  | {
      readonly intent: "update-profile";
      readonly ok: true;
    }
  | {
      readonly intent: "update-profile";
      readonly ok: false;
      readonly error: ProfileUpdateErrorCode;
    }
  | {
      readonly intent: "update-avatar";
      readonly ok: true;
    }
  | {
      readonly intent: "update-avatar";
      readonly ok: false;
      readonly error: AvatarUpdateErrorCode;
    }
  | { readonly intent: "revoke-other-sessions" }
  | { readonly intent: "revoke-session" };

type SettingsActionResult = ReturnType<typeof data<SettingsActionData>> | null;

interface SettingsLoaderData {
  readonly user: User;
  readonly email: string | null;
  readonly settings: UserSettings;
  readonly sessions: readonly SessionSummary[];
  readonly canEditProfile: boolean;
  readonly assignableRoles: readonly Role[];
}

/** An uploaded avatar image validated in memory, before persistence. */
interface AvatarUpload {
  readonly mimeType: string;
  readonly filename: string;
  readonly data: Buffer;
}

type AvatarUploadResult =
  | { readonly status: "ready"; readonly avatar: AvatarUpload }
  | { readonly status: "missing" | "invalid" };

const NOTIFICATION_ITEMS: readonly {
  readonly key: UserNotificationKey;
  readonly icon: ReactNode;
}[] = [
  {
    key: "email",
    icon: <Mail className="size-4" aria-hidden="true" />,
  },
  {
    key: "desktop",
    icon: <Monitor className="size-4" aria-hidden="true" />,
  },
  {
    key: "mentions",
    icon: <AtSign className="size-4" aria-hidden="true" />,
  },
  {
    key: "assignments",
    icon: <CheckSquare className="size-4" aria-hidden="true" />,
  },
  {
    key: "dueDates",
    icon: <CalendarDays className="size-4" aria-hidden="true" />,
  },
  {
    key: "weeklySummary",
    icon: <BarChart className="size-4" aria-hidden="true" />,
  },
];

interface SettingsCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly className?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

interface ProfileRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

interface ControlRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

interface ToggleRowProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}

/** Loads the personal settings and profile context of the authenticated visitor. */
export async function loader({
  context,
  request,
}: LoaderFunctionArgs): Promise<SettingsLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const [settings, email, sessions] = await Promise.all([
    services.settingsService.getUserSettings(user.id),
    services.userService.findProfileEmail(user.id),
    services.sessionService.getSessionSummaries(
      user.id,
      await getSessionToken(request),
    ),
  ]);
  const canEditProfile = user.role === ROLE.ADMIN;

  return {
    assignableRoles: canEditProfile
      ? [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE]
      : [],
    canEditProfile,
    email,
    sessions,
    settings,
    user,
  };
}

/** Validates that an image buffer begins with the magic bytes for its MIME type. */
function isValidImageBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) {
    return false;
  }

  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  if (mimeType === "image/webp") {
    return (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
}

/** Strips dangerous characters from an uploaded image filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, "");
}

/**
 * Validates an uploaded avatar file without persisting it.
 *
 * @param value - Raw form value submitted as the avatar.
 * @returns The validated image, or an error when it is missing or invalid.
 */
async function parseAvatarUpload(value: unknown): Promise<AvatarUploadResult> {
  if (!(value instanceof File) || value.size === 0) {
    return { status: "missing" };
  }

  if (
    value.size > MAXIMUM_AVATAR_SIZE ||
    !SUPPORTED_AVATAR_TYPES.has(value.type)
  ) {
    return { status: "invalid" };
  }

  const buffer = Buffer.from(await value.arrayBuffer());

  if (!isValidImageBytes(buffer, value.type)) {
    return { status: "invalid" };
  }

  const sanitized = sanitizeFilename(value.name);

  return {
    avatar: {
      data: buffer,
      filename: sanitized || "avatar",
      mimeType: value.type,
    },
    status: "ready",
  };
}

/** Parses a complete user settings payload sent by the settings form. */
function parseSettingsForm(formData: FormData): UserSettings | null {
  const language = formData.get("language");
  const timezone = formData.get("timezone");
  const dateFormat = formData.get("dateFormat");
  const weekStart = formData.get("weekStart");

  if (!isLanguage(language)) {
    return null;
  }

  if (
    typeof timezone !== "string" ||
    (timezone !== "" && !isUserTimezone(timezone))
  ) {
    return null;
  }

  if (!isUserDateFormat(dateFormat) || !isUserWeekStart(weekStart)) {
    return null;
  }

  const notifications = {} as Record<UserNotificationKey, boolean>;

  for (const key of USER_NOTIFICATION_KEYS) {
    const raw = formData.get(`notification.${key}`);

    if (raw === "on") {
      notifications[key] = true;
    } else if (raw === "off") {
      notifications[key] = false;
    } else {
      return null;
    }
  }

  return {
    language,
    timezone: timezone === "" ? null : timezone,
    dateFormat,
    weekStart,
    notifications,
  };
}

/** Persists settings and manages sessions, profile edits, and passwords. */
export async function action({
  request,
  context,
}: ActionFunctionArgs): Promise<SettingsActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Response("Forbidden", { status: 403 });
  }

  const services = await getApplicationServices();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update-settings") {
    const parsedSettings = parseSettingsForm(formData);

    if (!parsedSettings) {
      throw new Response("Bad Request", { status: 400 });
    }

    await services.settingsService.updateSettings(user.id, parsedSettings);

    return null;
  }

  if (intent === "update-profile") {
    // Text and role changes are an administrative operation, even when an
    // administrator edits their own profile. Ordinary users are rejected
    // here instead of trusting the hidden client-side edit button.
    if (user.role !== ROLE.ADMIN) {
      throw new Response("Forbidden", { status: 403 });
    }

    const displayName = formData.get("displayName");
    const rawUsername = formData.get("username");
    const rawEmail = formData.get("email");
    const rawRole = formData.get("role");

    if (
      typeof displayName !== "string" ||
      typeof rawUsername !== "string" ||
      !isRole(rawRole)
    ) {
      return data<SettingsActionData>(
        { intent: "update-profile", ok: false, error: "invalidInput" },
        { status: 400 },
      );
    }

    const trimmedDisplayName = displayName.trim();
    const username = (
      rawUsername.startsWith("@") ? rawUsername.slice(1) : rawUsername
    ).trim();
    const email =
      typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim() : null;

    if (
      !trimmedDisplayName ||
      trimmedDisplayName.length > 200 ||
      !username ||
      username.length > 200
    ) {
      return data<SettingsActionData>(
        { intent: "update-profile", ok: false, error: "invalidInput" },
        { status: 400 },
      );
    }

    if (email && (email.length > 320 || !EMAIL_PATTERN.test(email))) {
      return data<SettingsActionData>(
        { intent: "update-profile", ok: false, error: "invalidInput" },
        { status: 400 },
      );
    }

    const avatarUpload = await parseAvatarUpload(formData.get("avatar"));

    if (avatarUpload.status === "invalid") {
      return data<SettingsActionData>(
        { intent: "update-profile", ok: false, error: "invalidAvatar" },
        { status: 400 },
      );
    }

    if (avatarUpload.status === "ready") {
      await services.userService.updateOwnAvatar(user.id, {
        ...avatarUpload.avatar,
        avatarImageUrl: `/users/${user.id}/avatar?v=${Date.now()}`,
        avatarType: USER_AVATAR_TYPE.IMAGE,
      });
    }

    try {
      await services.userService.updateOwnProfile(user, {
        displayName: trimmedDisplayName,
        email,
        role: rawRole,
        username,
      });

      return data<SettingsActionData>({ intent: "update-profile", ok: true });
    } catch (error: unknown) {
      if (error instanceof UsernameTakenError) {
        return data<SettingsActionData>(
          { intent: "update-profile", ok: false, error: "usernameTaken" },
          { status: 400 },
        );
      }

      if (error instanceof EmailTakenError) {
        return data<SettingsActionData>(
          { intent: "update-profile", ok: false, error: "emailTaken" },
          { status: 400 },
        );
      }

      if (error instanceof LastAdministratorError) {
        return data<SettingsActionData>(
          { intent: "update-profile", ok: false, error: "lastAdministrator" },
          { status: 409 },
        );
      }

      if (
        error instanceof UserManagementDeniedError ||
        error instanceof RoleAssignmentDeniedError
      ) {
        return data<SettingsActionData>(
          { intent: "update-profile", ok: false, error: "forbidden" },
          { status: 403 },
        );
      }

      return data<SettingsActionData>(
        { intent: "update-profile", ok: false, error: "general" },
        { status: 400 },
      );
    }
  }

  if (intent === "update-avatar") {
    // The avatar is the only personal value an ordinary user may change
    // about themselves, so this intent stays open to every authenticated user.
    const avatarUpload = await parseAvatarUpload(formData.get("avatar"));

    if (avatarUpload.status !== "ready") {
      return data<SettingsActionData>(
        {
          intent: "update-avatar",
          ok: false,
          error:
            avatarUpload.status === "missing"
              ? "invalidInput"
              : "invalidAvatar",
        },
        { status: 400 },
      );
    }

    try {
      await services.userService.updateOwnAvatar(user.id, {
        ...avatarUpload.avatar,
        avatarImageUrl: `/users/${user.id}/avatar?v=${Date.now()}`,
        avatarType: USER_AVATAR_TYPE.IMAGE,
      });

      return data<SettingsActionData>({ intent: "update-avatar", ok: true });
    } catch {
      return data<SettingsActionData>(
        { intent: "update-avatar", ok: false, error: "general" },
        { status: 400 },
      );
    }
  }

  if (intent === "change-password") {
    const currentPassword = formData.get("currentPassword");
    const newPassword = formData.get("newPassword");
    const passwordConfirmation = formData.get("passwordConfirmation");

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      typeof passwordConfirmation !== "string" ||
      newPassword.length >= MAXIMUM_PASSWORD_LENGTH
    ) {
      return data<SettingsActionData>(
        { intent: "change-password", outcome: "invalidInput" },
        { status: 400 },
      );
    }

    if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
      return data<SettingsActionData>(
        { intent: "change-password", outcome: "tooShort" },
        { status: 400 },
      );
    }

    if (newPassword !== passwordConfirmation) {
      return data<SettingsActionData>(
        { intent: "change-password", outcome: "mismatch" },
        { status: 400 },
      );
    }

    const result = await services.authService.changePassword(
      user.username,
      currentPassword,
      newPassword,
    );

    if (result !== "success") {
      return data<SettingsActionData>(
        { intent: "change-password", outcome: result },
        { status: 400 },
      );
    }

    return data<SettingsActionData>(
      { intent: "change-password", outcome: "success" },
      { status: 200 },
    );
  }

  if (intent === "revoke-session") {
    const sessionId = formData.get("sessionId");

    if (typeof sessionId !== "string" || sessionId === "") {
      throw new Response("Bad Request", { status: 400 });
    }

    const revoked = await services.sessionService.revokeSessionById(
      user.id,
      sessionId,
      await getSessionToken(request),
    );

    if (!revoked) {
      throw new Response("Bad Request", { status: 400 });
    }

    return data<SettingsActionData>({ intent: "revoke-session" });
  }

  if (intent === "revoke-other-sessions") {
    await services.sessionService.revokeOtherSessions(
      user.id,
      await getSessionToken(request),
    );

    return data<SettingsActionData>({ intent: "revoke-other-sessions" });
  }

  throw new Response("Bad Request", { status: 400 });
}

/** Resolves the kind of `actionData` that belongs to a submitted intent. */
function useActionOutcome<TIntent extends SettingsActionData["intent"]>(
  intent: TIntent,
): Extract<SettingsActionData, { intent: TIntent }> | null {
  const actionData = useActionData<typeof action>();

  if (actionData?.intent !== intent) {
    return null;
  }

  return actionData as Extract<SettingsActionData, { intent: TIntent }>;
}

function SettingsSectionHeader({
  icon,
  title,
  description,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
}): React.ReactElement {
  return (
    <div className="sticky top-0 z-10 -mx-2 mb-4 bg-gradient-to-b from-background from-55% via-background/90 via-78% to-transparent px-2 pt-3 pb-2 select-none">
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({
  icon,
  title,
  description,
  action,
  className,
  children,
}: SettingsCardProps): React.ReactElement {
  return (
    <section
      className={cn(
        "rounded-2xl bg-surface p-4 shadow-card ring-1 ring-border/70 sm:p-5 xl:p-6",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="select-none text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-0.5 select-none text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function ProfileRow({ label, children }: ProfileRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="select-none text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

function ControlRow({ label, children }: ControlRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="select-none text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 sm:w-64 sm:max-w-full">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: () => void;
}): React.ReactElement {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        checked ? "justify-end bg-primary" : "justify-start bg-muted",
      )}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className="mx-0.5 size-5 rounded-full bg-white shadow"
      />
    </button>
  );
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: ToggleRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-1 py-2.5 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="select-none text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="mt-0.5 select-none text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <ToggleSwitch checked={checked} label={title} onChange={onChange} />
    </div>
  );
}

/** Converts a database `CURRENT_TIMESTAMP` value into a JavaScript date. */
function parseDatabaseTimestamp(value: string): Date {
  return new Date(
    value.includes("T") ? `${value}Z` : `${value.replace(" ", "T")}Z`,
  );
}

/** Formats the last activity of a session in the visitor's language. */
function formatSessionActivity(
  value: string,
  translate: TFunction,
  locale: string,
  now: Date,
): string {
  const date = parseDatabaseTimestamp(value);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (!Number.isFinite(minutes) || minutes < 1) {
    return translate("settings.security.sessions.activity.now");
  }

  if (minutes < 60) {
    return translate("settings.security.sessions.activity.minutesAgo", {
      count: minutes,
    });
  }

  if (minutes < 60 * 24) {
    return translate("settings.security.sessions.activity.hoursAgo", {
      count: Math.floor(minutes / 60),
    });
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Returns the short GMT offset of a time zone, shown next to its name. */
function formatTimezoneOffset(timeZone: string): string {
  try {
    const offsetPart = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName");

    return offsetPart?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

function SessionRow({
  session,
  onRevoke,
}: {
  readonly session: SessionSummary;
  readonly onRevoke: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const deviceLabel = [session.browser, session.operatingSystem]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const isMobileDevice =
    session.operatingSystem === "iOS" || session.operatingSystem === "Android";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {isMobileDevice ? (
            <Smartphone className="size-4" aria-hidden="true" />
          ) : (
            <Laptop className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">
              {deviceLabel || t("settings.security.sessions.unknownDevice")}
            </span>
            {session.isCurrent ? (
              <span className="inline-flex select-none items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <span
                  className="size-1.5 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                {t("settings.security.sessions.current")}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {session.isCurrent
              ? t("settings.security.sessions.activity.now")
              : formatSessionActivity(
                  session.lastUsedAt,
                  t,
                  i18n.resolvedLanguage ?? "de",
                  new Date(),
                )}
          </p>
        </div>
      </div>

      {!session.isCurrent ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("settings.security.sessions.menu")}
              className="size-8 min-h-0 p-0"
              variant="ghost"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
              onSelect={onRevoke}
            >
              {t("settings.security.sessions.revoke")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const response = useActionOutcome("change-password");
  const [outcome, setOutcome] = useState<PasswordChangeOutcome | null>(null);
  const lastHandledResponse = useRef<typeof response>(null);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "change-password";

  useEffect(() => {
    if (!open) {
      setOutcome(null);
      return;
    }

    if (response === lastHandledResponse.current) {
      return;
    }

    lastHandledResponse.current = response;

    if (response?.outcome === "success") {
      setOutcome(null);
      onOpenChange(false);
      return;
    }

    if (response) {
      setOutcome(response.outcome);
    }
  }, [open, response, onOpenChange]);

  const errorMessage = outcome
    ? t(`settings.security.password.errors.${outcome}`)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("settings.security.password.dialogTitle")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post">
          <input name="intent" type="hidden" value="change-password" />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor="settings-current-password"
          >
            {t("settings.security.password.currentPassword")}
          </label>
          <Input
            autoComplete="current-password"
            id="settings-current-password"
            name="currentPassword"
            type="password"
          />

          <label
            className="mt-2 select-none text-sm font-medium text-foreground"
            htmlFor="settings-new-password"
          >
            {t("settings.security.password.newPassword")}
          </label>
          <Input
            autoComplete="new-password"
            id="settings-new-password"
            name="newPassword"
            type="password"
          />

          <label
            className="mt-2 select-none text-sm font-medium text-foreground"
            htmlFor="settings-password-confirmation"
          >
            {t("settings.security.password.confirmPassword")}
          </label>
          <Input
            autoComplete="new-password"
            id="settings-password-confirmation"
            name="passwordConfirmation"
            type="password"
          />

          {errorMessage ? (
            <p className="select-none text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("settings.security.password.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("settings.security.password.changing")
                : t("settings.security.password.action")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeOtherSessionsDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const response = useActionOutcome("revoke-other-sessions");
  const lastHandledResponse = useRef<typeof response>(null);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "revoke-other-sessions";

  useEffect(() => {
    if (!open || response === lastHandledResponse.current) {
      return;
    }

    lastHandledResponse.current = response;
    onOpenChange(false);
  }, [open, response, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("settings.security.sessions.endOthersTitle")}
        </DialogTitle>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("settings.security.sessions.endOthersText")}
        </p>

        <Form className="mt-5 flex justify-end gap-2" method="post">
          <input name="intent" type="hidden" value="revoke-other-sessions" />
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("settings.security.sessions.cancel")}
            </Button>
          </DialogClose>
          <Button
            className="border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isSubmitting}
            type="submit"
            variant="outline"
          >
            {isSubmitting
              ? t("settings.security.sessions.revoking")
              : t("settings.security.sessions.endOthersConfirm")}
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Renders the modular, scroll-aware Pages settings screen. */
export default function SettingsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    user,
    email,
    settings: loadedSettings,
    sessions,
    canEditProfile,
    assignableRoles,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [settings, setSettings] = useState<UserSettings>(loadedSettings);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isRevokeAllDialogOpen, setIsRevokeAllDialogOpen] = useState(false);

  // Profile Edit State (administrators only; ordinary users keep a read-only
  // profile and change just their avatar through the avatar-only flow below).
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(user.displayName);
  const [editUsername, setEditUsername] = useState(`@${user.username}`);
  const [editEmail, setEditEmail] = useState(email ?? "");
  const [editRole, setEditRole] = useState<Role>(user.role);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const lastProfileResponse = useRef<SettingsActionData | null>(null);
  const lastAvatarResponse = useRef<SettingsActionData | null>(null);

  const profileActionData = useActionOutcome("update-profile");
  const avatarActionData = useActionOutcome("update-avatar");
  const isProfileSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "update-profile";
  const isAvatarSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "update-avatar";

  useEffect(() => {
    if (navigation.state === "idle") {
      setSettings(loadedSettings);
    }
  }, [navigation.state, loadedSettings]);

  useEffect(() => {
    if (
      !profileActionData ||
      profileActionData === lastProfileResponse.current
    ) {
      return;
    }

    lastProfileResponse.current = profileActionData;

    if (profileActionData.ok) {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setProfileError(null);
      setIsEditingProfile(false);
    } else {
      setProfileError(t(`settings.profile.errors.${profileActionData.error}`));
    }
  }, [profileActionData, avatarPreviewUrl, t]);

  useEffect(() => {
    if (!avatarActionData || avatarActionData === lastAvatarResponse.current) {
      return;
    }

    lastAvatarResponse.current = avatarActionData;

    if (avatarActionData.ok) {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setProfileError(null);
    } else {
      setProfileError(t(`settings.profile.errors.${avatarActionData.error}`));
    }
  }, [avatarActionData, avatarPreviewUrl, t]);

  function handleStartEdit(): void {
    if (!canEditProfile) {
      return;
    }

    setEditDisplayName(user.displayName);
    setEditUsername(`@${user.username}`);
    setEditEmail(email ?? "");
    setEditRole(user.role);
    setAvatarFile(null);
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarPreviewUrl(null);
    setProfileError(null);
    setIsEditingProfile(true);
  }

  function handleCancelEdit(): void {
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    setProfileError(null);
    setIsEditingProfile(false);
  }

  function handleCancelAvatar(): void {
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    setProfileError(null);
  }

  function handleAvatarClick(): void {
    if (canEditProfile && !isEditingProfile) {
      handleStartEdit();
    }
    avatarFileInputRef.current?.click();
  }

  function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (
      !SUPPORTED_AVATAR_TYPES.has(file.type) ||
      file.size > MAXIMUM_AVATAR_SIZE
    ) {
      setProfileError(t("settings.profile.errors.invalidAvatar"));
      return;
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    if (canEditProfile && !isEditingProfile) {
      handleStartEdit();
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    const preview = URL.createObjectURL(file);
    setAvatarFile(file);
    setAvatarPreviewUrl(preview);
    setProfileError(null);
  }

  function handleRoleChange(nextRole: string): void {
    if (!isRole(nextRole)) {
      return;
    }

    setEditRole(nextRole);
  }

  const cleanedFormUsername = (
    editUsername.startsWith("@") ? editUsername.slice(1) : editUsername
  ).trim();

  const isProfileDirty =
    editDisplayName.trim() !== user.displayName.trim() ||
    cleanedFormUsername !== user.username.trim() ||
    editEmail.trim() !== (email ?? "").trim() ||
    editRole !== user.role ||
    avatarFile !== null;

  function handleSaveProfile(): void {
    if (!canEditProfile || !isProfileDirty) {
      return;
    }

    const trimmedName = editDisplayName.trim();
    const trimmedUser = cleanedFormUsername;
    const trimmedMail = editEmail.trim();

    if (!trimmedName || !trimmedUser) {
      setProfileError(t("settings.profile.errors.invalidInput"));
      return;
    }

    if (trimmedMail && !EMAIL_PATTERN.test(trimmedMail)) {
      setProfileError(t("settings.profile.errors.invalidInput"));
      return;
    }

    const formData = new FormData();
    formData.set("intent", "update-profile");
    formData.set("displayName", trimmedName);
    formData.set("username", trimmedUser);
    formData.set("email", trimmedMail);
    formData.set("role", editRole);

    if (avatarFile) {
      formData.set("avatar", avatarFile);
    }

    setProfileError(null);
    void submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  }

  function handleSaveAvatar(): void {
    if (canEditProfile || !avatarFile || isAvatarSubmitting) {
      return;
    }

    const formData = new FormData();
    formData.set("intent", "update-avatar");
    formData.set("avatar", avatarFile);

    setProfileError(null);
    void submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  }

  function persistSettings(patch: Partial<UserSettings>): void {
    const updated = { ...settings, ...patch };

    setSettings(updated);

    const formData = new FormData();
    formData.set("intent", "update-settings");
    formData.set("language", updated.language);
    formData.set("timezone", updated.timezone ?? "");
    formData.set("dateFormat", updated.dateFormat);
    formData.set("weekStart", updated.weekStart);

    for (const key of USER_NOTIFICATION_KEYS) {
      formData.set(
        `notification.${key}`,
        updated.notifications[key] ? "on" : "off",
      );
    }

    void submit(formData, { method: "post" });
  }

  function handleNotificationToggle(key: UserNotificationKey): void {
    persistSettings({
      notifications: {
        ...settings.notifications,
        [key]: !settings.notifications[key],
      },
    });
  }

  function handleLanguageChange(language: string): void {
    if (!isLanguage(language)) {
      return;
    }

    persistSettings({ language });
  }

  function handleTimezoneChange(timezone: string): void {
    persistSettings({ timezone: isUserTimezone(timezone) ? timezone : null });
  }

  function handleDateFormatChange(dateFormat: string): void {
    if (!isUserDateFormat(dateFormat)) {
      return;
    }

    persistSettings({ dateFormat });
  }

  function handleWeekStartChange(weekStart: string): void {
    if (!isUserWeekStart(weekStart)) {
      return;
    }

    persistSettings({ weekStart });
  }

  function handleRevokeSession(sessionId: string): void {
    const formData = new FormData();
    formData.set("intent", "revoke-session");
    formData.set("sessionId", sessionId);
    void submit(formData, { method: "post" });
  }

  const timezoneOptions = [
    {
      value: "",
      label: t("settings.region.timezoneNotSet"),
    },
    ...USER_TIMEZONES.map((timeZone) => ({
      value: timeZone,
      label: timeZone,
      description: formatTimezoneOffset(timeZone),
    })),
  ];

  const displayUser = avatarPreviewUrl
    ? {
        ...user,
        avatarType: USER_AVATAR_TYPE.IMAGE,
        avatarImageUrl: avatarPreviewUrl,
      }
    : user;

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-80 w-full flex-col">
      <h1 className="shrink-0 select-none text-2xl font-semibold tracking-tight text-foreground xl:text-xl">
        {t("settings.title")}
      </h1>

      <VerticalScrollArea
        className="mt-6 min-h-0 flex-1"
        contentClassName="pr-4 sm:pr-6 md:pr-8 xl:pr-12 pb-12"
        fadeClassName="z-20"
      >
        <div className="w-full max-w-6xl">
          <SettingsSectionHeader
            icon={<UserRound className="size-4" aria-hidden="true" />}
            title={t("settings.personal.title")}
          />

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <div className="flex flex-col gap-4">
              <SettingsCard
                action={
                  // Ordinary users never see an edit action here; their
                  // profile text is administratively managed.
                  canEditProfile ? (
                    <Button
                      className="h-8 gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-primary shadow-xs hover:bg-surface-hover hover:text-primary-hover disabled:opacity-50"
                      disabled={isEditingProfile}
                      onClick={handleStartEdit}
                      type="button"
                      variant="outline"
                    >
                      <Pencil
                        className="size-3.5 text-primary"
                        aria-hidden="true"
                      />
                      {t("settings.profile.editAction")}
                    </Button>
                  ) : undefined
                }
                description={t("settings.profile.description")}
                icon={<UserRound className="size-4" aria-hidden="true" />}
                title={t("settings.profile.title")}
              >
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8 xl:gap-10">
                  <div className="flex flex-col items-center">
                    <input
                      ref={avatarFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleAvatarFileChange}
                    />
                    <div className="group relative">
                      <UserAvatar size="xl" user={displayUser} />
                      <button
                        type="button"
                        aria-label={t("settings.profile.changeAvatar")}
                        className={cn(
                          "absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-surface text-foreground shadow-md ring-1 ring-border/80 transition-all hover:scale-105 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary cursor-pointer",
                          isEditingProfile
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100",
                        )}
                        onClick={handleAvatarClick}
                      >
                        <Pencil
                          className="size-3.5 text-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    </div>

                    {isEditingProfile || !canEditProfile ? (
                      <div className="mt-3 text-center select-none">
                        {!canEditProfile && profileError ? (
                          <p className="mb-2 text-xs text-destructive">
                            {profileError}
                          </p>
                        ) : null}
                        {avatarFile && !canEditProfile ? (
                          <div className="flex justify-center gap-2">
                            <Button
                              className="h-8 min-h-0 px-3 text-xs"
                              onClick={handleCancelAvatar}
                              type="button"
                              variant="outline"
                            >
                              {t("settings.profile.cancelAction")}
                            </Button>
                            <Button
                              className="h-8 min-h-0 px-3 text-xs"
                              disabled={isAvatarSubmitting}
                              onClick={handleSaveAvatar}
                              type="button"
                            >
                              {isAvatarSubmitting
                                ? t("settings.profile.savingAction")
                                : t("settings.profile.saveAction")}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="cursor-pointer text-xs font-semibold text-foreground hover:text-primary"
                              onClick={handleAvatarClick}
                            >
                              {t("settings.profile.changeAvatar")}
                            </button>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {t("settings.profile.avatarFormatHint")}
                            </p>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    {canEditProfile && isEditingProfile ? (
                      <div className="flex flex-col gap-4">
                        <div>
                          <label
                            className="mb-1.5 block select-none text-sm font-medium text-foreground"
                            htmlFor="settings-profile-display-name"
                          >
                            {t("settings.profile.displayName")}
                          </label>
                          <Input
                            id="settings-profile-display-name"
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            maxLength={200}
                          />
                        </div>

                        <div>
                          <label
                            className="mb-1.5 block select-none text-sm font-medium text-foreground"
                            htmlFor="settings-profile-username"
                          >
                            {t("settings.profile.username")}
                          </label>
                          <Input
                            id="settings-profile-username"
                            value={editUsername}
                            onChange={(e) => setEditUsername(e.target.value)}
                            maxLength={200}
                          />
                        </div>

                        <div>
                          <label
                            className="mb-1.5 block select-none text-sm font-medium text-foreground"
                            htmlFor="settings-profile-email"
                          >
                            {t("settings.profile.email")}
                          </label>
                          <Input
                            id="settings-profile-email"
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            placeholder={t("settings.profile.emailPlaceholder")}
                            maxLength={320}
                          />
                        </div>

                        <div>
                          <label
                            className="mb-1.5 block select-none text-sm font-medium text-foreground"
                            htmlFor="settings-profile-position"
                          >
                            {t("settings.profile.position")}
                          </label>
                          <Select
                            ariaLabel={t("settings.profile.position")}
                            className="w-full"
                            id="settings-profile-position"
                            onValueChange={handleRoleChange}
                            options={assignableRoles.map((role) => ({
                              value: role,
                              label: t(`role.${role}`),
                            }))}
                            value={editRole}
                          />
                        </div>

                        {profileError ? (
                          <p className="select-none text-sm text-destructive">
                            {profileError}
                          </p>
                        ) : null}

                        <div className="mt-2 flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancelEdit}
                          >
                            {t("settings.profile.cancelAction")}
                          </Button>
                          <Button
                            type="button"
                            disabled={!isProfileDirty || isProfileSubmitting}
                            onClick={handleSaveProfile}
                          >
                            {isProfileSubmitting
                              ? t("settings.profile.savingAction")
                              : t("settings.profile.saveAction")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <dl className="flex flex-col gap-4">
                        <ProfileRow label={t("settings.profile.displayName")}>
                          {user.displayName}
                        </ProfileRow>
                        <ProfileRow label={t("settings.profile.username")}>
                          @{user.username}
                        </ProfileRow>
                        <ProfileRow label={t("settings.profile.email")}>
                          {email ? (
                            email
                          ) : (
                            <span className="text-muted-foreground">
                              {t("settings.profile.notProvided")}
                            </span>
                          )}
                        </ProfileRow>
                        <ProfileRow label={t("settings.profile.position")}>
                          {t(`role.${user.role}`)}
                        </ProfileRow>
                      </dl>
                    )}
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard
                description={t("settings.notifications.description")}
                icon={<Bell className="size-4" aria-hidden="true" />}
                title={t("settings.notifications.title")}
              >
                <div className="flex flex-col gap-1">
                  {NOTIFICATION_ITEMS.map((item) => (
                    <ToggleRow
                      checked={settings.notifications[item.key]}
                      description={t(
                        `settings.notifications.${item.key}.description`,
                      )}
                      icon={item.icon}
                      key={item.key}
                      onChange={() => handleNotificationToggle(item.key)}
                      title={t(`settings.notifications.${item.key}.title`)}
                    />
                  ))}
                </div>
              </SettingsCard>
            </div>

            <div className="flex flex-col gap-4">
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
                        <p className="select-none text-sm font-medium text-foreground">
                          {t("settings.security.password.title")}
                        </p>
                        <p className="mt-0.5 select-none text-xs leading-relaxed text-muted-foreground">
                          {t("settings.security.password.description")}
                        </p>
                      </div>
                    </div>
                    <Button
                      className="h-9 shrink-0 px-3 text-xs"
                      onClick={() => setIsPasswordDialogOpen(true)}
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
                        <p className="select-none text-sm font-medium text-foreground">
                          {t("settings.security.sessions.title")}
                        </p>
                        <p className="mt-0.5 select-none text-xs leading-relaxed text-muted-foreground">
                          {t("settings.security.sessions.description")}
                        </p>
                      </div>
                    </div>

                    <VerticalScrollArea
                      className="mt-3 max-h-80"
                      contentClassName="space-y-2 pr-1.5"
                      style={
                        {
                          "--scroll-fade-channels": "255 255 255",
                        } as React.CSSProperties
                      }
                    >
                      {sessions.map((session) => (
                        <SessionRow
                          key={session.id}
                          onRevoke={() => handleRevokeSession(session.id)}
                          session={session}
                        />
                      ))}
                    </VerticalScrollArea>

                    {sessions.length > 1 ? (
                      <Button
                        className="mt-3 w-full border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setIsRevokeAllDialogOpen(true)}
                        variant="outline"
                      >
                        {t("settings.security.sessions.endOthers")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard
                description={t("settings.region.description")}
                icon={<Globe className="size-4" aria-hidden="true" />}
                title={t("settings.region.title")}
              >
                <div className="flex flex-col gap-4">
                  <ControlRow label={t("settings.region.language")}>
                    <Select
                      ariaLabel={t("settings.region.language")}
                      className="w-full"
                      onValueChange={handleLanguageChange}
                      options={[
                        {
                          value: LANGUAGE.GERMAN,
                          label: t("settings.language.de"),
                        },
                        {
                          value: LANGUAGE.ENGLISH,
                          label: t("settings.language.en"),
                        },
                      ]}
                      value={settings.language}
                    />
                  </ControlRow>
                  <ControlRow label={t("settings.region.timezone")}>
                    <Select
                      ariaLabel={t("settings.region.timezone")}
                      className="w-full"
                      onValueChange={handleTimezoneChange}
                      options={timezoneOptions}
                      value={settings.timezone ?? ""}
                    />
                  </ControlRow>
                  <ControlRow label={t("settings.region.dateFormat")}>
                    <Select
                      ariaLabel={t("settings.region.dateFormat")}
                      className="w-full"
                      onValueChange={handleDateFormatChange}
                      options={USER_DATE_FORMATS.map((dateFormat) => ({
                        value: dateFormat,
                        label: dateFormat,
                      }))}
                      value={settings.dateFormat}
                    />
                  </ControlRow>
                  <ControlRow label={t("settings.region.weekStart")}>
                    <Select
                      ariaLabel={t("settings.region.weekStart")}
                      className="w-full"
                      onValueChange={handleWeekStartChange}
                      options={[
                        {
                          value: "monday",
                          label: t("settings.region.weekStartMonday"),
                        },
                        {
                          value: "sunday",
                          label: t("settings.region.weekStartSunday"),
                        },
                      ]}
                      value={settings.weekStart}
                    />
                  </ControlRow>
                </div>
              </SettingsCard>
            </div>
          </div>

          {user.role === ROLE.ADMIN ? (
            <section className="mt-10">
              <SettingsSectionHeader
                description={t("settings.system.description")}
                icon={<Server className="size-4" aria-hidden="true" />}
                title={t("settings.system.title")}
              />
              <div className="rounded-2xl border border-dashed border-border bg-surface/60 p-6">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("settings.system.placeholder")}
                </p>
              </div>
            </section>
          ) : null}
        </div>
      </VerticalScrollArea>

      <ChangePasswordDialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      />
      <RevokeOtherSessionsDialog
        open={isRevokeAllDialogOpen}
        onOpenChange={setIsRevokeAllDialogOpen}
      />
    </section>
  );
}
