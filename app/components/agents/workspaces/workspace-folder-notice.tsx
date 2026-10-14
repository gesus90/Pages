import { CircleAlert, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

const TONES = {
  neutral: { icon: Info, className: "text-muted-foreground", role: "status" },
  warning: { icon: TriangleAlert, className: "text-warning", role: "status" },
  error: { icon: CircleAlert, className: "text-destructive", role: "alert" },
} as const;

/** A sentence with an icon, so the tone is never the only information. */
export function WorkspaceFolderNotice(props: {
  readonly tone: keyof typeof TONES;
  readonly children: ReactNode;
}): React.ReactElement {
  const { icon: Icon, className, role } = TONES[props.tone];
  return (
    <p role={role} className={cn("flex items-start gap-2 text-sm", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="leading-relaxed">{props.children}</span>
    </p>
  );
}
