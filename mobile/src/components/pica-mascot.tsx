import { Image } from "react-native";

import picaMascotSource from "../../assets/images/pica-mascot.png";

interface PicaMascotProps {
  /** Edge length in density-independent pixels; the canvas is square. */
  readonly size: number;
}

/**
 * Pica's mascot, the one graphic that stands for Pica in the app.
 *
 * @remarks
 * The mascot is decorative: the heading or message around it names Pica for
 * assistive technology. It keeps its square canvas and is never clipped, so the
 * folded corner and the waving flap stay whole.
 */
export function PicaMascot({ size }: PicaMascotProps): React.ReactElement {
  return (
    <Image
      accessibilityIgnoresInvertColors
      accessible={false}
      resizeMode="contain"
      source={picaMascotSource}
      style={{ width: size, height: size }}
    />
  );
}
