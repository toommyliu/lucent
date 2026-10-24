export type Rgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

let context: CanvasRenderingContext2D | null = null;

function getContext(): CanvasRenderingContext2D {
  if (context === null) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const created = canvas.getContext("2d", { willReadFrequently: true });
    if (created === null) {
      throw new Error("2D canvas is unavailable");
    }
    context = created;
  }
  return context;
}

function computedColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export function composite(layers: ReadonlyArray<string>): Rgba {
  const ctx = getContext();
  ctx.clearRect(0, 0, 1, 1);
  for (const layer of layers) {
    ctx.fillStyle = computedColor(layer);
    ctx.fillRect(0, 0, 1, 1);
  }
  const [red = 0, green = 0, blue = 0, alpha = 0] = ctx.getImageData(
    0,
    0,
    1,
    1,
  ).data;
  return [red, green, blue, alpha / 255];
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: Rgba): number {
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function toHex([red, green, blue]: Rgba): string {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}
