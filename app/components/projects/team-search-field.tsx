import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

import type { ChangeEvent } from "react";

interface TeamSearchFieldProps {
  readonly value: string;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** Renders the search field above the team table. */
export function TeamSearchField({
  value,
  onChange,
}: TeamSearchFieldProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="relative mt-6 h-9 w-full sm:max-w-80">
      <Search
        className="pointer-events-none absolute top-1/2 left-4 size-4 shrink-0 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        className="h-9 rounded-lg bg-card pr-3 pl-11 text-xs xl:pr-3 xl:pl-11"
        value={value}
        onChange={onChange}
        placeholder={t("projectDetail.team.searchMembers")}
        aria-label={t("projectDetail.team.searchMembers")}
      />
    </div>
  );
}
