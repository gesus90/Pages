import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { CatalogDeleteDialog } from "@/app/components/users/catalog-delete-dialog";
import { GroupEditor } from "@/app/components/users/group-editor";
import { ManagementTable } from "@/app/components/users/management-table";
import type { AdministrationPageData } from "@/definition/Authorization";
import type { ManagedGroup } from "@/definition/UserGroup";

/** Groups that tickets can be assigned to, managed together with the users. */
export function GroupCatalog({
  directory,
}: {
  readonly directory: AdministrationPageData;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ManagedGroup | null>(null);
  const [open, setOpen] = useState(false);
  const candidates = directory.users.filter((user) => user.account.isActive);
  function create(): void {
    setSelected(null);
    setOpen(true);
  }
  function edit(group: ManagedGroup): void {
    setSelected(group);
    setOpen(true);
  }
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-6 flex justify-end">
        <Button onClick={create}>
          <Plus className="size-4" aria-hidden="true" />
          {t("users.groups.add")}
        </Button>
      </div>
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-1 pt-1 pb-10"
      >
        <ManagementTable>
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">
                {t("users.catalog.name")}
              </th>
              <th className="px-4 py-3 font-medium">
                {t("users.groups.members")}
              </th>
              <th className="px-4 py-3 font-medium">
                {t("users.catalog.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {directory.groups.groups.map((group) => (
              <tr key={group.id} className="hover:bg-muted/40">
                <td className="pages-selectable px-4 py-3">{group.name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {group.memberCount === 0
                    ? t("users.groups.empty")
                    : t("users.groups.memberCount", {
                        total: group.memberCount,
                      })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!group.canEdit}
                      onClick={() => edit(group)}
                      aria-label={t("users.catalog.editNamed", {
                        name: group.name,
                      })}
                    >
                      {t("users.menu.edit")}
                    </Button>
                    <CatalogDeleteDialog
                      kind="group"
                      id={group.id}
                      name={group.name}
                      disabled={!group.canEdit}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ManagementTable>
        {directory.groups.groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("users.groups.none")}
          </p>
        ) : null}
      </VerticalScrollArea>
      <GroupEditor
        selected={selected}
        open={open}
        onOpenChange={setOpen}
        candidates={candidates}
      />
    </section>
  );
}
