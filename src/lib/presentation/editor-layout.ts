export type EditorPlotInsets = { x: number; y: number };

const FULL_X = 44;
const FULL_Y = 40;
const MIN_X = 20;
const MIN_Y = 16;
const MIN_INNER_WIDTH = 96;
const MIN_INNER_HEIGHT = 48;

/** Keep the plot usable when mobile viewport furniture leaves a short canvas. */
export function editorPlotInsets(
  width: number,
  height: number,
): EditorPlotInsets {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const availableX = Math.max(0, (safeWidth - MIN_INNER_WIDTH) / 2);
  const availableY = Math.max(0, (safeHeight - MIN_INNER_HEIGHT) / 2);
  const responsiveX = Math.max(MIN_X, safeWidth * 0.14);
  const responsiveY = Math.max(MIN_Y, safeHeight * 0.25);
  return {
    x: Math.min(FULL_X, responsiveX, availableX),
    y: Math.min(FULL_Y, responsiveY, availableY),
  };
}
