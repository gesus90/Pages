import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  formatAreaChoice,
  parseAreaChoice,
  WIKI_BUILTIN_TEMPLATES,
} from "@/app/lib/wiki-templates";
import { WIKI_LIMITS } from "@/definition/Wiki";

import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiProjectArea } from "@/definition/Wiki";

/** A template page of the instance, named for the choice. */
export interface WikiTemplateChoice {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

interface WikiNewPageFormProps {
  readonly projects: readonly WikiProjectArea[];
  readonly templates: readonly WikiTemplateChoice[];
  /** Create below this page instead of in an area. */
  readonly parentId?: string;
}

const BUILTIN_PREFIX = "builtin:";
const USER_PREFIX = "page:";

function useNewPageOptions(
  projects: readonly WikiProjectArea[],
  templates: readonly WikiTemplateChoice[],
): {
  readonly areaOptions: readonly { label: string; value: string }[];
  readonly templateOptions: readonly { label: string; value: string }[];
} {
  const { t } = useTranslation();

  const templateOptions = [
    { label: t("wiki.dialog.create.blank"), value: "" },
    ...WIKI_BUILTIN_TEMPLATES.map((key) => ({
      label: t(`wiki.templates.${key}.name`),
      value: `${BUILTIN_PREFIX}${key}`,
    })),
    ...templates.map((entry) => ({
      label: entry.title,
      value: `${USER_PREFIX}${entry.id}`,
    })),
  ];
  const areaOptions = [
    { label: t("wiki.nav.privateArea"), value: "private" },
    { label: t("wiki.nav.generalArea"), value: "instance" },
    ...projects.map((project) => ({
      label: project.name,
      value: formatAreaChoice({ projectId: project.id, scope: "project" }),
    })),
  ];

  return { areaOptions, templateOptions };
}

/** The fields of the new-page dialog and the button that sends them. */
export function WikiNewPageForm({
  projects,
  templates,
  parentId,
}: WikiNewPageFormProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<WikiActionResult>();
  const [area, setArea] = useState("instance");
  const [template, setTemplate] = useState("");
  const place = parseAreaChoice(area);
  const builtin = template.startsWith(BUILTIN_PREFIX)
    ? template.slice(BUILTIN_PREFIX.length)
    : null;
  const { areaOptions, templateOptions } = useNewPageOptions(
    projects,
    templates,
  );

  return (
    <fetcher.Form action="/wiki" className="mt-4 space-y-4" method="post">
      <input name="intent" type="hidden" value="create-page" />
      <input name="parentId" type="hidden" value={parentId ?? ""} />
      <input name="scope" type="hidden" value={place.scope} />
      <input name="projectId" type="hidden" value={place.projectId ?? ""} />
      <input
        name="templateId"
        type="hidden"
        value={
          template.startsWith(USER_PREFIX)
            ? template.slice(USER_PREFIX.length)
            : ""
        }
      />
      <input
        name="content"
        type="hidden"
        value={builtin === null ? "" : t(`wiki.templates.${builtin}.content`)}
      />
      <label className="block text-sm font-medium" htmlFor="wiki-new-title">
        {t("wiki.dialog.create.titleLabel")}
        <Input
          autoFocus
          className="mt-1"
          id="wiki-new-title"
          maxLength={WIKI_LIMITS.titleLength}
          name="title"
          required
        />
      </label>
      {parentId ? null : (
        <div className="space-y-1">
          <span className="text-sm font-medium">
            {t("wiki.dialog.create.areaLabel")}
          </span>
          <Select
            ariaLabel={t("wiki.dialog.create.areaLabel")}
            className="w-full"
            options={areaOptions}
            value={area}
            onValueChange={setArea}
          />
        </div>
      )}
      <div className="space-y-1">
        <span className="text-sm font-medium">
          {t("wiki.dialog.create.templateLabel")}
        </span>
        <Select
          ariaLabel={t("wiki.dialog.create.templateLabel")}
          className="w-full"
          options={templateOptions}
          value={template}
          onValueChange={setTemplate}
        />
      </div>
      {fetcher.data?.ok === false ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`wiki.errors.${fetcher.data.error}`)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button isPending={fetcher.state !== "idle"} type="submit">
          {t("wiki.dialog.create.submit")}
        </Button>
      </div>
    </fetcher.Form>
  );
}
