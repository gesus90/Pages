import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";

import type { LoaderFunctionArgs } from "react-router";

function getGreetingKey(hour: number): string {
  if (hour < 12) {
    return "dashboard.greeting.morning";
  }

  if (hour < 18) {
    return "dashboard.greeting.day";
  }

  return "dashboard.greeting.evening";
}

/** Returns the current time and user for the personalized dashboard greeting. */
export function loader({ context }: LoaderFunctionArgs): {
  readonly displayName: string;
  readonly hour: number;
} {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  return { displayName: user.displayName, hour: new Date().getHours() };
}

/** Renders the intentionally minimal authenticated dashboard. */
export default function DashboardRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { displayName, hour } = useLoaderData<typeof loader>();

  return (
    <section className="px-6 pt-16 sm:px-10 md:px-16 md:pt-24">
      <p className="m-0 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
        {t("dashboard.eyebrow")}
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        {t(getGreetingKey(hour), { name: displayName })}
      </h1>
    </section>
  );
}
