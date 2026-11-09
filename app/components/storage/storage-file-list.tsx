import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Checkbox } from "@/app/components/ui/checkbox";
import { cn } from "@/app/lib/cn";

import {
  formatBytes,
  formatModified,
  storageFolderHref,
} from "./storage-format";
import { StorageItemIcon } from "./storage-item-icon";
import { storageItemKind } from "./storage-item-kind";

import type { StorageItem } from "@/definition/GoogleDriveStorage";
import type { ReactNode } from "react";

import type { StorageMenuPoint } from "./storage-context-menu";
import type { StorageSelection } from "./use-storage-selection";

interface StorageFileListProps {
  readonly items: readonly StorageItem[];
  /** The menu of one entry; without it the list has no action column. */
  readonly renderActions?: (item: StorageItem) => ReactNode;
  /** The selection of the entries; without it rows cannot be selected. */
  readonly selection?: StorageSelection;
  /** Opens the context menu at a point after a right click on a row. */
  readonly onOpenMenu?: (point: StorageMenuPoint) => void;
}

/** Clicks on these elements keep their own meaning and never select the row. */
const INTERACTIVE_SELECTOR = "a, button, input, label, [role='menuitem']";

function isInteractiveTarget(event: React.SyntheticEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest(INTERACTIVE_SELECTOR) !== null
  );
}

/** The pointer position, or the row's corner when the keyboard opened the menu. */
function menuPoint(event: React.MouseEvent<HTMLElement>): StorageMenuPoint {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY };
  }

  const box = event.currentTarget.getBoundingClientRect();

  return { x: box.left + 24, y: box.top + box.height / 2 };
}

function ItemName({
  item,
}: {
  readonly item: StorageItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const name = item.name === "" ? t("storage.untitled") : item.name;
  const icon = <StorageItemIcon kind={storageItemKind(item)} />;
  const linkClass =
    "inline-flex max-w-full min-w-0 items-center gap-3 rounded-md py-0.5 align-middle text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary";

  if (item.isFolder) {
    return (
      <Link className={linkClass} to={storageFolderHref(item.id)}>
        {icon}
        <span className="truncate font-medium">{name}</span>
      </Link>
    );
  }

  if (item.webViewLink === null) {
    return (
      <span className="flex min-w-0 items-center gap-3 py-0.5">
        {icon}
        <span className="truncate">{name}</span>
      </span>
    );
  }

  return (
    <a
      className={linkClass}
      href={item.webViewLink}
      referrerPolicy="no-referrer"
      rel="noopener noreferrer"
      target="_blank"
      title={t("storage.list.openInDrive")}
    >
      {icon}
      <span className="truncate">{name}</span>
      <ExternalLink
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </a>
  );
}

function SizeText({
  item,
}: {
  readonly item: StorageItem;
}): React.ReactElement {
  const { t, i18n } = useTranslation();

  if (item.isFolder) return <>{t("storage.list.folder")}</>;

  return (
    <>
      {item.sizeBytes === null
        ? "—"
        : formatBytes(item.sizeBytes, i18n.language)}
    </>
  );
}

function ItemRow({
  item,
  renderActions,
  selection,
  onOpenMenu,
}: Omit<StorageFileListProps, "items"> & {
  readonly item: StorageItem;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const isSelected = selection?.isSelected(item.id) === true;
  const name = item.name === "" ? t("storage.untitled") : item.name;

  function handleClick(event: React.MouseEvent<HTMLTableRowElement>): void {
    if (!selection || isInteractiveTarget(event)) return;

    selection.click(item.id, event.ctrlKey || event.metaKey);
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
  ): void {
    if (!selection || event.key !== " " || event.target !== event.currentTarget)
      return;

    event.preventDefault();
    selection.click(item.id, event.ctrlKey || event.metaKey);
  }

  function handleContextMenu(
    event: React.MouseEvent<HTMLTableRowElement>,
  ): void {
    if (!selection || !onOpenMenu) return;

    event.preventDefault();
    event.stopPropagation();
    selection.prepareContextMenu(item.id);
    onOpenMenu(menuPoint(event));
  }

  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        isSelected ? "bg-primary-subtle" : "hover:bg-surface-hover",
        selection ? "cursor-default select-none" : null,
      )}
      data-selected={isSelected ? "true" : undefined}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      tabIndex={selection ? 0 : undefined}
    >
      {selection?.isMultiSelect ? (
        <td className="w-11 py-2 pr-0 pl-4">
          <Checkbox
            aria-label={t("storage.list.select", { name })}
            checked={isSelected}
            onChange={() => selection.toggle(item.id)}
          />
        </td>
      ) : null}
      <td className="max-w-0 px-4 py-1.5">
        <ItemName item={item} />
        {isSelected && !selection?.isMultiSelect ? (
          <span className="sr-only">{t("storage.list.selected")}</span>
        ) : null}
      </td>
      <td className="hidden px-4 py-2 text-sm whitespace-nowrap text-muted-foreground md:table-cell">
        {item.modifiedAt === null
          ? "—"
          : formatModified(item.modifiedAt, i18n.language)}
      </td>
      <td className="hidden px-4 py-2 text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
        <SizeText item={item} />
      </td>
      {renderActions ? (
        <td className="w-12 px-2 py-1 text-right">{renderActions(item)}</td>
      ) : null}
    </tr>
  );
}

function SelectAllCell({
  items,
  selection,
}: {
  readonly items: readonly StorageItem[];
  readonly selection: StorageSelection;
}): React.ReactElement {
  const { t } = useTranslation();
  const isAllSelected =
    items.length > 0 && selection.items.length === items.length;

  return (
    <th className="w-11 py-2.5 pr-0 pl-4" scope="col">
      <Checkbox
        aria-label={t("storage.menu.selectAll")}
        checked={isAllSelected}
        onChange={isAllSelected ? selection.clear : selection.selectAll}
      />
    </th>
  );
}

/**
 * The content of a folder: folders first, then files, as Drive sorts them.
 *
 * @remarks
 * With a selection (PAGE-272) a click on a row selects it, Ctrl/Cmd-click
 * adds or removes it, Space does the same from the keyboard, and the
 * multi-select mode shows checkboxes. Names keep opening folders and files.
 * A right click selects only an unselected row and opens the own menu.
 */
export function StorageFileList({
  items,
  renderActions,
  selection,
  onOpenMenu,
}: StorageFileListProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b border-border text-xs font-medium text-muted-foreground uppercase">
          {selection?.isMultiSelect ? (
            <SelectAllCell items={items} selection={selection} />
          ) : null}
          <th className="px-4 py-2.5 font-medium" scope="col">
            {t("storage.list.name")}
          </th>
          <th
            className="hidden w-48 px-4 py-2.5 font-medium md:table-cell"
            scope="col"
          >
            {t("storage.list.modified")}
          </th>
          <th
            className="hidden w-28 px-4 py-2.5 text-right font-medium sm:table-cell"
            scope="col"
          >
            {t("storage.list.size")}
          </th>
          {renderActions ? (
            <th className="w-12 px-2 py-2.5" scope="col">
              <span className="sr-only">{t("storage.list.actions")}</span>
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <ItemRow
            item={item}
            key={item.id}
            onOpenMenu={onOpenMenu}
            renderActions={renderActions}
            selection={selection}
          />
        ))}
      </tbody>
    </table>
  );
}
