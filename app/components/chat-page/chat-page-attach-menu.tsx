import { useRef, useState } from "react";
import {
  Code,
  Diff,
  Globe,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";

/** An empty code block; the caret lands inside it. */
const CODE_TEMPLATE = "```\n\n```";

/** The smallest diff the chat shows as a diff card. */
const DIFF_TEMPLATE = "```diff\n- alt\n+ neu\n```";

const ITEM = "gap-3";
const ICON = "size-4 shrink-0 text-muted-foreground";

interface ChatPageAttachMenuProps {
  /** Whether files can be attached; an agent's chat session takes text only. */
  readonly canAttach: boolean;
  onFiles(files: File[]): void;
  /** Appends a template or an address to the message being written. */
  onInsert(text: string): void;
  /** Starts a voice recording; missing where voice messages are not offered. */
  readonly onVoice?: () => void;
}

/** The address as it is inserted, or `null` when it is no web address. */
function readWebAddress(text: string): string | null {
  const address = text.trim();
  if (!/^https?:\/\/\S+$/iu.test(address) || !URL.canParse(address))
    return null;
  return address;
}

/** The field that asks for the address of a web page, in place of the menu items. */
function WebAddressForm({
  onInsert,
}: {
  onInsert(address: string): void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [isRefused, setRefused] = useState(false);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const address = readWebAddress(text);
    if (address === null) return setRefused(true);
    return onInsert(address);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    // The menu would read typed letters as a search for an item.
    if (event.key !== "Escape") event.stopPropagation();
  }

  return (
    <form className="flex w-72 flex-col gap-2 p-2" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1.5 text-sm text-foreground">
        {t("chatPage.attach.webAddress")}
        <Input
          aria-invalid={isRefused}
          autoFocus
          inputMode="url"
          onChange={(event) => {
            setText(event.currentTarget.value);
            setRefused(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://"
          size="sm"
          type="text"
          value={text}
        />
      </label>
      {isRefused ? (
        <p className="text-xs text-destructive" role="alert">
          {t("chatPage.attach.webInvalid")}
        </p>
      ) : null}
      <Button className="self-end" size="sm" type="submit">
        {t("chatPage.attach.webInsert")}
      </Button>
    </form>
  );
}

/** A hidden file field the menu opens; it hands over what the person chose. */
function FilePicker({
  ref,
  accept,
  onFiles,
}: {
  readonly ref: React.RefObject<HTMLInputElement | null>;
  readonly accept?: string;
  onFiles(files: File[]): void;
}): React.ReactElement {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (files.length > 0) onFiles(files);
  }

  return (
    <input
      ref={ref}
      accept={accept}
      className="hidden"
      multiple
      onChange={handleChange}
      tabIndex={-1}
      type="file"
    />
  );
}

type PickerRef = React.RefObject<HTMLInputElement | null>;

interface AttachMenuItemsProps {
  readonly canAttach: boolean;
  readonly pickers: { readonly file: PickerRef; readonly media: PickerRef };
  /** Opens the file dialog of a picker. */
  onPick(picker: PickerRef): void;
  onInsert(text: string): void;
  /** Swaps the items for the address field; the event keeps the menu open. */
  onAskAddress(event: Event): void;
  readonly onVoice?: () => void;
}

/** The items of the "+" menu in the order of the design. */
function AttachMenuItems({
  canAttach,
  pickers,
  onPick,
  onInsert,
  onAskAddress,
  onVoice,
}: AttachMenuItemsProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {canAttach ? (
        <>
          <DropdownMenuItem
            className={ITEM}
            onSelect={() => onPick(pickers.file)}
          >
            <Paperclip aria-hidden="true" className={ICON} />
            {t("chatPage.attach.file")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={ITEM}
            onSelect={() => onPick(pickers.media)}
          >
            <ImageIcon aria-hidden="true" className={ICON} />
            {t("chatPage.attach.media")}
          </DropdownMenuItem>
        </>
      ) : null}
      <DropdownMenuItem
        className={ITEM}
        onSelect={() => onInsert(CODE_TEMPLATE)}
      >
        <Code aria-hidden="true" className={ICON} />
        {t("chatPage.attach.code")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={ITEM}
        onSelect={() => onInsert(DIFF_TEMPLATE)}
      >
        <Diff aria-hidden="true" className={ICON} />
        {t("chatPage.attach.diff")}
      </DropdownMenuItem>
      <DropdownMenuItem className={ITEM} onSelect={onAskAddress}>
        <Globe aria-hidden="true" className={ICON} />
        {t("chatPage.attach.web")}
      </DropdownMenuItem>
      {onVoice ? (
        <DropdownMenuItem className={ITEM} onSelect={onVoice}>
          <Mic aria-hidden="true" className={ICON} />
          {t("chatPage.attach.voice")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/**
 * The square "+" of the composer with its menu (PAGE-298): attach a file, an
 * image or a video, insert a code block or a diff, embed a web page, record a
 * voice message.
 *
 * @remarks
 * The file fields stand outside the menu, which leaves the page when it
 * closes. "Webseite einbetten" swaps the items for a field that asks for the
 * address; only `http` and `https` addresses are inserted. Without
 * `canAttach` the two file items are left out.
 */
export function ChatPageAttachMenu({
  canAttach,
  onFiles,
  onInsert,
  onVoice,
}: ChatPageAttachMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const [isAskingAddress, setAskingAddress] = useState(false);
  const filePicker = useRef<HTMLInputElement | null>(null);
  const mediaPicker = useRef<HTMLInputElement | null>(null);

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    setAskingAddress(false);
  }

  function handleAskAddress(event: Event): void {
    // Keeps the menu open for the address field.
    event.preventDefault();
    setAskingAddress(true);
  }

  function handleAddress(address: string): void {
    handleOpenChange(false);
    onInsert(address);
  }

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange} open={isOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("chatPage.attach.menu")}
            className="size-9 min-h-9 shrink-0 rounded-[10px] p-0 xl:min-h-9 xl:p-0"
            title={t("chatPage.attach.menu")}
          >
            <Plus aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label={t("chatPage.attach.menu")}
          className="min-w-60 border border-border p-1.5 shadow-floating"
          side="top"
        >
          {isAskingAddress ? (
            <WebAddressForm onInsert={handleAddress} />
          ) : (
            <AttachMenuItems
              canAttach={canAttach}
              onAskAddress={handleAskAddress}
              onInsert={onInsert}
              onPick={(picker) => picker.current?.click()}
              onVoice={onVoice}
              pickers={{ file: filePicker, media: mediaPicker }}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canAttach ? (
        <>
          <FilePicker ref={filePicker} onFiles={onFiles} />
          <FilePicker
            ref={mediaPicker}
            accept="image/*,video/*"
            onFiles={onFiles}
          />
        </>
      ) : null}
    </>
  );
}
