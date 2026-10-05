import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { LucideIcon } from "lucide-react";
import type { DatabaseLocationStatus } from "@/definition/Setup";

/** Element id the database field refers to for its description. */
export const DATABASE_PATH_FEEDBACK_ID = "databasePath-feedback";

interface FeedbackAppearance {
  readonly icon: LucideIcon;
  readonly className: string;
}

const APPEARANCE_BY_STATUS: Readonly<
  Record<DatabaseLocationStatus, FeedbackAppearance>
> = {
  available: { className: "text-success", icon: CheckCircle2 },
  empty: { className: "text-muted-foreground", icon: Info },
  existing: { className: "text-warning", icon: TriangleAlert },
  foreign: { className: "text-destructive", icon: AlertCircle },
  invalid: { className: "text-destructive", icon: AlertCircle },
  notWritable: { className: "text-destructive", icon: AlertCircle },
};

interface DatabasePathFeedbackProps {
  /** Result for the current value, or `null` while it is unknown. */
  readonly status: DatabaseLocationStatus | null;
  readonly hasFailed: boolean;
}

/**
 * Renders the outcome of the database path check below the field.
 *
 * @remarks
 * Every outcome has an icon and a sentence, so the color is never the only
 * information. Changes are announced politely to assistive technology.
 */
export function DatabasePathFeedback({
  status,
  hasFailed,
}: DatabasePathFeedbackProps): React.ReactElement {
  const { t } = useTranslation();
  let appearance: FeedbackAppearance = {
    className: "text-muted-foreground",
    icon: Loader2,
  };
  let message = t("setup.database.checking");

  if (status !== null) {
    appearance = APPEARANCE_BY_STATUS[status];
    message = t(`setup.database.status.${status}`);
  } else if (hasFailed) {
    appearance = APPEARANCE_BY_STATUS.notWritable;
    message = t("setup.database.checkFailed");
  }

  const Icon = appearance.icon;

  return (
    <p
      className={cn(
        "mt-2 flex items-start gap-2 text-sm",
        appearance.className,
      )}
      id={DATABASE_PATH_FEEDBACK_ID}
      aria-live="polite"
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          Icon === Loader2 && "animate-spin",
        )}
        aria-hidden="true"
      />
      <span className="leading-relaxed">{message}</span>
    </p>
  );
}
