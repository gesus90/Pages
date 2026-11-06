import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { readServiceStatusLight } from "@/app/lib/service-status";

import type { ServiceStatusLight as Light } from "@/definition/ServiceStatus";

/** The public light is read again this often. */
const POLL_INTERVAL_MS = 10_000;

const LIGHT_STYLES: Readonly<
  Record<Light, { readonly box: string; readonly dot: string }>
> = {
  green: { box: "bg-success-subtle text-success", dot: "bg-success" },
  yellow: { box: "bg-warning-subtle text-warning", dot: "bg-warning" },
  red: { box: "bg-destructive-subtle text-destructive", dot: "bg-destructive" },
  unknown: {
    box: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

interface ServiceLightBadgeProps {
  readonly light: Light;
  readonly className?: string;
}

/**
 * Shows one light of the platform's services as a coloured dot with its meaning.
 *
 * @remarks
 * The text carries the meaning; the colour only repeats it.
 */
export function ServiceLightBadge({
  light,
  className,
}: ServiceLightBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const styles = LIGHT_STYLES[light];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
        styles.box,
        className,
      )}
      data-service-light={light}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", styles.dot)}
      />
      {t(`serviceStatus.light.${light}`)}
    </span>
  );
}

/** Polls the public light; `null` while none could be read. */
function usePublicServiceLight(): Light | null {
  const [light, setLight] = useState<Light | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function poll(): Promise<void> {
      const next = await readServiceStatusLight(controller.signal);
      if (!controller.signal.aborted) setLight(next);
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  return light;
}

/**
 * Shows at the bottom centre of every page when not all services of the platform run (PAGE-238).
 *
 * @remarks
 * Reads the public light of `pages-core` in the browser, without the API, a
 * route loader or server rendering. So it also appears on the sign-in and
 * error pages, and after a reload while the API is stopped. It names no
 * service: details are for admins in the system settings. Nothing shows
 * while every service runs or no status can be read.
 */
export function ServiceStatusLight(): React.ReactElement | null {
  const light = usePublicServiceLight();
  if (light === null || light === "green") return null;

  return (
    <p
      role="status"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full shadow-card"
    >
      <ServiceLightBadge light={light} />
    </p>
  );
}
