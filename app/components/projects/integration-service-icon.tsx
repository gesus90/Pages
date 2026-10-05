import {
  Braces,
  Calendar,
  GitBranch,
  Mail,
  MessageCircle,
  Webhook,
} from "lucide-react";

/** Every interface Pages lists on the project interfaces tab. */
export type IntegrationId =
  "github" | "google-calendar" | "discord" | "webhooks" | "email" | "rest-api";

interface ServiceIconProps {
  readonly id: IntegrationId;
}

/**
 * Renders the large service tile shown on the left of every card and panel.
 *
 * @remarks
 * Branding note: GitHub (Invertocat), Google Calendar, and Discord marks are
 * proprietary trademarks with restrictive brand programs (no recoloring, no
 * redrawing, partly approval required). This repository bundles no licensed
 * copies from official sources, so the tiles deliberately use neutral,
 * unmodified Lucide icons instead of rebuilt brand approximations. All tiles
 * share the same container size, corner radius, and Lucide stroke width.
 */
export function ServiceIcon({ id }: ServiceIconProps): React.ReactElement {
  if (id === "github") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#171717] text-white"
      >
        <GitBranch className="size-7" />
      </span>
    );
  }

  if (id === "google-calendar") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-surface text-[#1a73e8] shadow-xs"
      >
        <Calendar className="size-7" />
      </span>
    );
  }

  if (id === "discord") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#5865f2] text-white"
      >
        <MessageCircle className="size-7" />
      </span>
    );
  }

  if (id === "webhooks") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-surface text-[#e11d48] shadow-xs"
      >
        <Webhook className="size-7" />
      </span>
    );
  }

  if (id === "email") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#f97316] text-white"
      >
        <Mail className="size-7" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white"
    >
      <Braces className="size-7" />
    </span>
  );
}
