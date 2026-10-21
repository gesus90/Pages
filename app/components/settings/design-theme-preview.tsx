import type {
  DesignThemeChoice,
  DesignThemePreviewPalette,
} from "@/definition/DesignTheme";

interface PreviewWindowProps {
  readonly palette: DesignThemePreviewPalette;
}

/**
 * Draws a small window in the colors of one mode of a theme.
 *
 * @remarks
 * The colors come from the theme's manifest, like a color a user picked, so
 * they cannot be theme tokens: the preview shows a theme the page is not in.
 */
function PreviewWindow({ palette }: PreviewWindowProps): React.ReactElement {
  return (
    <div
      className="flex h-24 min-w-0 flex-1 overflow-hidden rounded-lg border"
      style={{
        backgroundColor: palette.background,
        borderColor: palette.border,
      }}
    >
      <div
        className="flex w-1/4 shrink-0 flex-col gap-1.5 border-r p-1.5"
        style={{
          backgroundColor: palette.sidebar,
          borderColor: palette.border,
        }}
      >
        <span
          className="h-1.5 rounded-full"
          style={{ backgroundColor: palette.primary }}
        />
        <span
          className="h-1 rounded-full opacity-50"
          style={{ backgroundColor: palette.mutedForeground }}
        />
        <span
          className="h-1 rounded-full opacity-50"
          style={{ backgroundColor: palette.mutedForeground }}
        />
      </div>
      <div className="flex min-w-0 flex-1 p-1.5">
        <div
          className="flex flex-1 flex-col gap-1.5 rounded-md border p-1.5"
          style={{
            backgroundColor: palette.surface,
            borderColor: palette.border,
          }}
        >
          <span
            className="h-1.5 w-2/3 rounded-full"
            style={{ backgroundColor: palette.foreground }}
          />
          <span
            className="h-1 rounded-full opacity-60"
            style={{ backgroundColor: palette.mutedForeground }}
          />
          <span
            className="mt-auto h-2.5 w-1/2 rounded"
            style={{ backgroundColor: palette.primary }}
          />
        </div>
      </div>
    </div>
  );
}

interface DesignThemePreviewProps {
  readonly choice: DesignThemeChoice;
}

/** Shows what a theme looks like: its preview image, or a mock-up per supported mode. */
export function DesignThemePreview({
  choice,
}: DesignThemePreviewProps): React.ReactElement {
  if (choice.previewImageUrl !== null) {
    return (
      <img
        alt=""
        className="aspect-[16/9] w-full rounded-lg border border-border object-cover"
        src={choice.previewImageUrl}
      />
    );
  }

  return (
    <div aria-hidden="true" className="flex gap-2">
      {choice.modes.map((mode) => {
        const palette = choice.preview[mode];

        return palette ? <PreviewWindow key={mode} palette={palette} /> : null;
      })}
    </div>
  );
}
