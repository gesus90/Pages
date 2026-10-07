import { cn } from "@/app/lib/cn";

import type { InstanceBranding } from "@/definition/Instance";

interface InstanceBrandProps {
  readonly branding: InstanceBranding;
  readonly className?: string;
  /** Stacks logo above name and centers both, as the login page shows them. */
  readonly isCentered?: boolean;
}

/** Shows the company logo and name; renders nothing while the instance has neither. */
export function InstanceBrand({
  branding,
  className,
  isCentered = false,
}: InstanceBrandProps): React.ReactElement | null {
  const { companyName, logoUrl } = branding;

  if (companyName === null && logoUrl === null) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        isCentered && "flex-col text-center",
        className,
      )}
    >
      {logoUrl ? (
        <img
          // The company name next to the logo already tells what it stands for.
          alt=""
          className={cn(
            "w-auto shrink-0 object-contain",
            isCentered ? "max-h-14 max-w-48" : "max-h-8 max-w-10",
          )}
          draggable={false}
          src={logoUrl}
        />
      ) : null}
      {companyName === null ? null : (
        <span
          className={cn(
            "min-w-0 font-semibold text-foreground",
            isCentered ? "text-lg" : "truncate text-sm",
          )}
          title={companyName}
        >
          {companyName}
        </span>
      )}
    </div>
  );
}
