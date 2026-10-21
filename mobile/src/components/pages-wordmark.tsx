import { Image } from "react-native";

import { useTheme } from "@/theme/theme-provider";

import pagesWordmarkDark from "../../assets/images/pages-wordmark-dark.png";
import pagesWordmarkLight from "../../assets/images/pages-wordmark.png";

import type { ImageSourcePropType } from "react-native";
import type { ColorScheme } from "@/theme/tokens";

interface PagesWordmarkProps {
  /** Width in density-independent pixels; the height follows the ratio. */
  readonly width: number;
}

// The images are trimmed to the artwork: 720 x 205 px.
const WORDMARK_ASPECT_RATIO = 720 / 205;

const WORDMARK_SOURCES: Readonly<Record<ColorScheme, ImageSourcePropType>> = {
  light: pagesWordmarkLight,
  dark: pagesWordmarkDark,
};

/**
 * The Pages wordmark of the web app, in the variant that reads on the theme.
 *
 * @remarks
 * The light variant is the Pages logo; the dark variant has the same shape with
 * its black strokes in the light foreground of the dark theme.
 */
export function PagesWordmark({
  width,
}: PagesWordmarkProps): React.ReactElement {
  const { scheme } = useTheme();

  return (
    <Image
      accessibilityLabel="Pages"
      resizeMode="contain"
      source={WORDMARK_SOURCES[scheme]}
      style={{ width, height: width / WORDMARK_ASPECT_RATIO }}
    />
  );
}
