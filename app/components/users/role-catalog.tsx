import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { CatalogDeleteDialog } from "@/app/components/users/catalog-delete-dialog";
import { ManagementTable } from "@/app/components/users/management-table";
import { RoleEditor } from "@/app/components/users/role-editor";
import type {
  AdministrationPageData,
  UserRole,
} from "@/definition/Authorization";

/** Role catalog with server-computed editing restrictions and assignment-aware deletion. */
export function RoleCatalog({
  directory,
}: {
  readonly directory: AdministrationPageData;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [open, setOpen] = useState(false);
  function create(): void {
    setSelected(null);
    setOpen(true);
  }
  function edit(role: UserRole): void {
    setSelected(role);
    setOpen(true);
  }
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-6 flex justify-end">
        <Button onClick={create}>
          <Plus className="size-4" aria-hidden="true" />
          {t("users.catalog.addRole")}
        </Button>
      </div>
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-1 pt-1 pb-10"
      >
        <ManagementTable>
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {["name", "rank", "actions"].map((column) => (
                <th key={column} className="px-4 py-3 font-medium">
                  {t(`users.catalog.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {directory.assignableRoles.map((role) => (
              <tr key={role.id} className="hover:bg-muted/40">
                <td className="pages-selectable px-4 py-3">{role.name}</td>
                <td className="px-4 py-3 tabular-nums">{role.rank}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!directory.editableRoleIds.includes(role.id)}
                      onClick={() => edit(role)}
                      aria-label={t("users.catalog.editNamed", {
                        name: role.name,
                      })}
                    >
                      {t("users.menu.edit")}
                    </Button>
                    <CatalogDeleteDialog
                      kind="role"
                      id={role.id}
                      name={role.name}
                      disabled={
                        !directory.editableRoleIds.includes(role.id) ||
                        directory.users.some(
                          (user) => user.account.role?.id === role.id,
                        )
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ManagementTable>
        {directory.assignableRoles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("users.noRoles")}
          </p>
        ) : null}
      </VerticalScrollArea>
      <RoleEditor
        role={selected}
        actor={directory.actor}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  );
}
