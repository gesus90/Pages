import { HexColorField } from "@/app/components/tasks/hexagon-color-picker/hex-color-field";
import { HueSlider } from "@/app/components/tasks/hexagon-color-picker/hue-slider";
import { SaturationPad } from "@/app/components/tasks/hexagon-color-picker/saturation-pad";
import { hexToHsv } from "@/app/components/tasks/label-color";

interface HexagonColorPickerProps {
  readonly color: string;
  readonly onChange: (color: string) => void;
}

/**
 * Renders a free color picker with a hexagon saturation pad.
 *
 * @remarks
 * Visually follows the hexagon-picker idea without pulling in its
 * unmaintained React 16 dependency: the saturation pad is clipped to a
 * hexagon, the hue runs on a slider below, and the exact value stays editable
 * as HEX. Colors leave the picker already normalized to `#rrggbb`, matching
 * the preset representation one to one.
 */
export function HexagonColorPicker({
  color,
  onChange,
}: HexagonColorPickerProps): React.ReactElement {
  const hsv = hexToHsv(color);

  return (
    <div className="flex flex-col gap-3">
      <SaturationPad color={color} hsv={hsv} onChange={onChange} />
      <HueSlider hsv={hsv} onChange={onChange} />
      <HexColorField color={color} onChange={onChange} />
    </div>
  );
}
