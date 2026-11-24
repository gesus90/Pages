import { Check, CircleAlert, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { cn } from "@/app/lib/cn";
import { isZaiCodingPlanModel } from "@/definition/AgentConnection";

import type {
  AgentCheckDetail,
  AgentCheckKind,
  AgentCheckSummary,
} from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";

function DetailValue({
  value,
}: {
  readonly value: unknown;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (typeof value === "boolean")
    return <>{t(value ? "settings.agents.yes" : "settings.agents.no")}</>;
  if (typeof value === "number")
    return (
      <>
        {new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 6,
        }).format(value)}
      </>
    );
  return <>{String(value)}</>;
}

function CheckDetails({
  detail,
}: {
  readonly detail: AgentCheckDetail;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {Object.entries(detail).map(([key, value]: [string, unknown]) => (
        <div key={key} className="contents">
          <dt>{t(`settings.agents.detail.${key}`)}</dt>
          <dd className="pages-selectable break-words">
            <DetailValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ZaiOutcome = "passed" | "rejected" | "quota" | "timeout" | "failed";

// Only the stated causes are named; HTTP 429 alone is a rate limit, not an exhausted plan.
function zaiOutcomeOf(check: AgentCheckSummary): ZaiOutcome {
  if (check.status === "passed") return "passed";
  if (check.errorCode === "provider_auth_failed") return "rejected";
  if (check.errorCode === "provider_quota_exhausted") return "quota";
  if (check.errorCode === "check_timeout") return "timeout";
  return "failed";
}

const ZAI_TONES: Readonly<Record<ZaiOutcome, string>> = {
  passed: "bg-success-subtle text-success",
  rejected: "bg-destructive-subtle text-destructive",
  quota: "bg-warning-subtle text-warning",
  timeout: "bg-warning-subtle text-warning",
  failed: "bg-destructive-subtle text-destructive",
};

/** The outcome of a Z.AI Coding Plan check with its cause and next step. */
function ZaiCheckOutcome({
  check,
  modelCount,
}: {
  readonly check: AgentCheckSummary;
  readonly modelCount: number | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const outcome = zaiOutcomeOf(check);
  const hasModels =
    outcome === "passed" && modelCount !== null && modelCount > 0;
  const textKey = hasModels ? "passed.textWithModels" : `${outcome}.text`;
  return (
    <div
      role={outcome === "passed" ? "status" : "alert"}
      data-zai-check={outcome}
      className={`space-y-0.5 rounded-lg px-3 py-2 text-xs ${ZAI_TONES[outcome]}`}
    >
      <p className="font-semibold">
        {t(`settings.agents.zaiCheck.${outcome}.title`)}
      </p>
      <p>
        {t(`settings.agents.zaiCheck.${textKey}`, {
          count: modelCount ?? 0,
          code: check.errorCode,
        })}
      </p>
    </div>
  );
}

// CLI checks read the local login status and run the CLI, so they are named like their buttons.
const HEADINGS = {
  api: { auth: "auth", model: "model" },
  cli: { auth: "cliAuth", model: "cliModel" },
} as const;

/** Shows separate, timestamped access and model evidence with sanitized details only. */
export function AgentCheckResults({
  kind,
  check,
  isCli,
  zaiCodingPlan = null,
}: {
  readonly kind: AgentCheckKind;
  readonly check: AgentCheckSummary | null;
  readonly isCli: boolean;
  /**
   * Set for a Z.AI Coding Plan connection: the outcome is named by its cause,
   * with the number of listed models, or `null` while the catalog is unknown.
   */
  readonly zaiCodingPlan?: { readonly modelCount: number | null } | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm">
      <h4 className="font-medium">
        {t(
          `settings.agents.checkKind.${HEADINGS[isCli ? "cli" : "api"][kind]}`,
        )}
      </h4>
      {!check ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.neverChecked")}
        </p>
      ) : (
        <>
          <p
            className={
              check.status === "passed" ? "text-success" : "text-destructive"
            }
          >
            {t(`settings.agents.result.${check.status}`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(check.checkedAt)} ·{" "}
            {t("settings.agents.duration", { duration: check.durationMs })}
          </p>
          {zaiCodingPlan ? (
            <ZaiCheckOutcome
              check={check}
              modelCount={zaiCodingPlan.modelCount}
            />
          ) : null}
          {check.errorCode && !zaiCodingPlan ? (
            <p role="alert" className="text-xs text-destructive">
              {t(`settings.agents.error.${check.errorCode}`)}
            </p>
          ) : null}
          <CheckDetails detail={check.detail} />
          {isCli ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.agents.cliCheckSnapshot")}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The four results of a Coding Plan check with a cause of their own, and the general failure. */
type CodingPlanOutcome = "passed" | "rejected" | "quota" | "timeout" | "failed";

const CODING_PLAN_LOOKS: Readonly<
  Record<
    CodingPlanOutcome,
    {
      readonly icon: LucideIcon;
      readonly boxClass: string;
      readonly titleClass: string;
    }
  >
> = {
  passed: {
    icon: Check,
    boxClass: "bg-success-subtle",
    titleClass: "text-success",
  },
  rejected: {
    icon: CircleAlert,
    boxClass: "bg-destructive-subtle",
    titleClass: "text-destructive",
  },
  quota: {
    icon: CircleAlert,
    boxClass: "bg-warning-subtle",
    titleClass: "text-warning",
  },
  timeout: {
    icon: Wifi,
    boxClass: "bg-warning-subtle",
    titleClass: "text-warning",
  },
  failed: {
    icon: CircleAlert,
    boxClass: "bg-destructive-subtle",
    titleClass: "text-destructive",
  },
};

/**
 * The cause a Coding Plan check names.
 * @remarks
 * Only a key Z.AI rejected, a quota Z.AI named as exhausted and a missing
 * answer within 20 seconds have a cause of their own; every other code is a
 * failed check with its code, never a guessed cause.
 */
function codingPlanOutcome(check: AgentCheckSummary): CodingPlanOutcome {
  if (check.status === "passed") return "passed";
  if (
    check.errorCode === "provider_auth_failed" ||
    check.errorCode === "cli_auth_failed"
  )
    return "rejected";
  if (check.errorCode === "provider_quota_exhausted") return "quota";
  if (check.errorCode === "check_timeout") return "timeout";
  return "failed";
}

/** The names of the Coding Plan models in the connection's catalog, as the chips of a passed check. */
function CodingPlanModels({
  catalog,
}: {
  readonly catalog: AgentModelCatalog | undefined;
}): React.ReactElement | null {
  const models = (catalog?.models ?? []).filter((model) =>
    isZaiCodingPlanModel(model.id),
  );
  if (models.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {models.map((model) => (
        <li
          key={model.id}
          title={model.id}
          className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-foreground"
        >
          {model.name}
        </li>
      ))}
    </ul>
  );
}

/** The text below the title: the model count, the cause or the code of the failed check. */
function codingPlanBody(
  outcome: CodingPlanOutcome,
  check: AgentCheckSummary,
  t: TFunction,
): string {
  const prefix = "settings.agents.zaiCodingPlan.check";
  if (outcome === "passed")
    return t(`${prefix}.passedBody`, { count: check.detail.modelCount ?? 0 });
  if (outcome !== "failed") return t(`${prefix}.${outcome}Body`);
  const code = check.errorCode ?? "cli_check_failed";
  return `${t(`settings.agents.error.${code}`)} ${t(`${prefix}.failedCode`, { code })}`;
}

/**
 * The result of the access check of a Z.AI Coding Plan connection, with its cause and next step.
 * @remarks
 * Shows the available models, a rejected key, an exhausted quota, no answer
 * after 20 seconds, or "Prüfung fehlgeschlagen" with the error code, in the
 * tone of the result.
 */
export function CodingPlanCheckResult({
  check,
  catalog,
}: {
  readonly check: AgentCheckSummary | null;
  readonly catalog: AgentModelCatalog | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const prefix = "settings.agents.zaiCodingPlan.check";
  if (!check)
    return (
      <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-sm">
        <h4 className="font-medium">{t(`${prefix}.title`)}</h4>
        <p className="text-xs text-muted-foreground">
          {t(`${prefix}.description`)}
        </p>
      </div>
    );
  const outcome = codingPlanOutcome(check);
  const look = CODING_PLAN_LOOKS[outcome];
  const Icon = look.icon;
  return (
    <div
      role={outcome === "passed" ? "status" : "alert"}
      data-coding-plan-check={outcome}
      className={cn("flex gap-2.5 rounded-xl p-3 text-sm", look.boxClass)}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", look.titleClass)}
      />
      <div className="min-w-0">
        <h4 className={cn("font-semibold", look.titleClass)}>
          {t(`${prefix}.${outcome}`)}
        </h4>
        <p className="text-xs text-foreground">
          {codingPlanBody(outcome, check, t)}
        </p>
        {outcome === "passed" ? <CodingPlanModels catalog={catalog} /> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(check.checkedAt)} ·{" "}
          {t("settings.agents.duration", { duration: check.durationMs })}
        </p>
      </div>
    </div>
  );
}
