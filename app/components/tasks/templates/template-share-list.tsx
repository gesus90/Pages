import { Checkbox } from "@/app/components/ui/checkbox";

interface TemplateShareListProps {
  readonly legend: string;
  /** Field name the checked ids are posted under. */
  readonly name: string;
  readonly choices: readonly { readonly id: string; readonly name: string }[];
  readonly selected: readonly string[];
  readonly emptyHint: string;
  readonly onToggle: (id: string) => void;
}

/** A group of checkboxes for the departments or projects a template is shared with. */
export function TemplateShareList({
  legend,
  name,
  choices,
  selected,
  emptyHint,
  onToggle,
}: TemplateShareListProps): React.ReactElement {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {choices.map((choice) => (
            <label
              key={choice.id}
              className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm hover:bg-muted/40 xl:min-h-9"
            >
              <Checkbox
                checked={selected.includes(choice.id)}
                name={name}
                onChange={() => onToggle(choice.id)}
                value={choice.id}
              />
              <span className="min-w-0 break-words">{choice.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
