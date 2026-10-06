import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { CatalogDeleteDialog } from "@/app/components/users/catalog-delete-dialog";
import { ManagementTable } from "@/app/components/users/management-table";
import { DepartmentEditor } from "@/app/components/users/department-editor";
import type {
  AdministrationPageData,
  Department,
} from "@/definition/Authorization";

/** Department labels and explicit management scope, without project-side A3 changes. */
export function DepartmentCatalog({
  directory,
}: {
  readonly directory: AdministrationPageData;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  function create(): void {
    setSelected(null);
    setOpen(true);
  }
  function edit(department: Department): void {
    setSelected(department);
    setOpen(true);
  }
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-6 flex justify-end">
        <Button onClick={create}>
          <Plus className="size-4" aria-hidden="true" />
          {t("users.catalog.addDepartment")}
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
                {t("users.catalog.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {directory.departments.map((department) => (
              <tr key={department.id} className="hover:bg-muted/40">
                <td className="pages-selectable px-4 py-3">
                  {department.name}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        !directory.manageableDepartmentIds.includes(
                          department.id,
                        )
                      }
                      onClick={() => edit(department)}
                      aria-label={t("users.catalog.editNamed", {
                        name: department.name,
                      })}
                    >
                      {t("users.menu.edit")}
                    </Button>
                    <CatalogDeleteDialog
                      kind="department"
                      id={department.id}
                      name={department.name}
                      disabled={
                        !directory.manageableDepartmentIds.includes(
                          department.id,
                        )
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ManagementTable>
        {directory.departments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("users.noDepartments")}
          </p>
        ) : null}
      </VerticalScrollArea>
      <DepartmentEditor
        selected={selected}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  );
}
