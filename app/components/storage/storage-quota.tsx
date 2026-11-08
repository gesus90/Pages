import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "./storage-format";
import { requestStorageQuota } from "./storage-requests";

import type { StorageQuota } from "@/definition/GoogleDriveStorage";
import type { TFunction } from "i18next";

/** What the view knows about the quota. */
type QuotaReading =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "loaded"; readonly quota: StorageQuota };

/** The numbers of a quota with a known, positive individual limit. */
interface QuotaShare {
  readonly percent: number;
  readonly barPercent: number;
  readonly remainingBytes: number;
}

function useQuotaReading(): QuotaReading {
  const [reading, setReading] = useState<QuotaReading>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const reply = await requestStorageQuota(controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setReading(
        reply.ok && reply.value.kind === "quota"
          ? { kind: "loaded", quota: reply.value.quota }
          : { kind: "unavailable" },
      );
    }

    void load();

    return () => controller.abort();
  }, []);

  return reading;
}

/**
 * Computes share and remaining storage, only where they mean something.
 *
 * @remarks
 * Without a limit (unlimited), with a limit of zero, or with a possible
 * Workspace pool, whose limit belongs to the whole organization, no share is
 * invented. The bar stops at 100 %; the text keeps an exceeded limit.
 */
function shareOf(quota: StorageQuota): QuotaShare | null {
  const limit = quota.limitBytes;

  if (limit === null || limit <= 0 || quota.isPossiblyPooled) {
    return null;
  }

  const percent = (quota.usageBytes / limit) * 100;

  return {
    barPercent: Math.min(100, Math.max(0, percent)),
    percent,
    remainingBytes: limit - quota.usageBytes,
  };
}

function quotaSummary(
  quota: StorageQuota,
  t: TFunction,
  language: string,
): string {
  const used = formatBytes(quota.usageBytes, language);

  if (quota.limitBytes === null) {
    return t("storage.quota.unlimited", { used });
  }

  return t("storage.quota.usedOfLimit", {
    limit: formatBytes(quota.limitBytes, language),
    used,
  });
}

function shareDetail(
  share: QuotaShare,
  t: TFunction,
  language: string,
): string {
  const percent = new Intl.NumberFormat(language, {
    maximumFractionDigits: share.percent < 10 ? 1 : 0,
  }).format(share.percent);

  return share.remainingBytes >= 0
    ? t("storage.quota.percentFree", {
        free: formatBytes(share.remainingBytes, language),
        percent,
      })
    : t("storage.quota.percentOver", {
        over: formatBytes(-share.remainingBytes, language),
        percent,
      });
}

function QuotaBar({
  share,
}: {
  readonly share: QuotaShare;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("storage.quota.barLabel")}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(share.barPercent)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
    >
      <div
        className={
          share.percent >= 100
            ? "h-full rounded-full bg-destructive"
            : "h-full rounded-full bg-primary"
        }
        style={{ width: `${share.barPercent}%` }}
      />
    </div>
  );
}

function LoadedQuota({
  quota,
}: {
  readonly quota: StorageQuota;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const share = shareOf(quota);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {t(
          quota.isPossiblyPooled
            ? "storage.quota.poolLabel"
            : "storage.quota.accountLabel",
        )}
      </p>
      {share ? <QuotaBar share={share} /> : null}
      <p className="text-sm font-semibold text-foreground tabular-nums">
        {quotaSummary(quota, t, i18n.language)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {share
          ? shareDetail(share, t, i18n.language)
          : t(
              quota.isPossiblyPooled
                ? "storage.quota.poolHint"
                : "storage.quota.noShare",
            )}
      </p>
    </div>
  );
}

/**
 * The storage quota of the connected Google account, from Drive `about.get`.
 *
 * @remarks
 * It is the use across all Google services of the account, not the size of
 * the start folder. Loading errors and unknown values stay visible as such.
 */
export function StorageQuotaPanel(): React.ReactElement {
  const { t } = useTranslation();
  const reading = useQuotaReading();

  return (
    <section
      aria-label={t("storage.quota.title")}
      aria-live="polite"
      className="w-full min-w-0 sm:w-72"
    >
      {reading.kind === "loaded" ? <LoadedQuota quota={reading.quota} /> : null}
      {reading.kind === "loading" ? (
        <p className="text-xs text-muted-foreground">
          {t("storage.quota.loading")}
        </p>
      ) : null}
      {reading.kind === "unavailable" ? (
        <p className="text-xs text-muted-foreground">
          {t("storage.quota.unavailable")}
        </p>
      ) : null}
    </section>
  );
}
