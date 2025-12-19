import type { ColorPalette, Color } from "../types/index.ts";

/** Generate a default color palette with N colors */
export function generatePalette(size: number): ColorPalette {
  if (size < 2 || size > 256) {
    throw new Error("Palette size must be between 2 and 256");
  }
  
  const colors: Color[] = [];
  
  // For 16 colors, use a standard palette
  if (size === 16) {
    colors.push(
      { r: 0, g: 0, b: 0 },       // 0: Black
      { r: 0, g: 0, b: 170 },     // 1: Blue
      { r: 0, g: 170, b: 0 },     // 2: Green
      { r: 0, g: 170, b: 170 },   // 3: Cyan
      { r: 170, g: 0, b: 0 },     // 4: Red
      { r: 170, g: 0, b: 170 },   // 5: Magenta
      { r: 170, g: 85, b: 0 },    // 6: Brown
      { r: 170, g: 170, b: 170 }, // 7: Light Gray
      { r: 85, g: 85, b: 85 },    // 8: Dark Gray
      { r: 85, g: 85, b: 255 },   // 9: Light Blue
      { r: 85, g: 255, b: 85 },   // A: Light Green
      { r: 85, g: 255, b: 255 },  // B: Light Cyan
      { r: 255, g: 85, b: 85 },   // C: Light Red
      { r: 255, g: 85, b: 255 },  // D: Light Magenta
      { r: 255, g: 255, b: 85 },  // E: Yellow
      { r: 255, g: 255, b: 255 }  // F: White
    );
  } else {
    // Generate evenly distributed colors in RGB space
    const steps = Math.ceil(Math.cbrt(size));
    let count = 0;
    
    for (let r = 0; r < steps && count < size; r++) {
      for (let g = 0; g < steps && count < size; g++) {
        for (let b = 0; b < steps && count < size; b++) {
          colors.push({
            r: Math.floor((r / (steps - 1)) * 255),
            g: Math.floor((g / (steps - 1)) * 255),
            b: Math.floor((b / (steps - 1)) * 255),
          });
          count++;
        }
      }
    }
  }
  
  return { colors: colors.slice(0, size), size };
}

/** Find nearest color in palette (Euclidean distance) */
export function findNearestColor(color: Color, palette: ColorPalette): number {
  let minDistance = Infinity;
  let nearestIndex = 0;
  
  for (let i = 0; i < palette.colors.length; i++) {
    const distance = colorDistance(color, palette.colors[i]);
    if (distance < minDistance) {
      minDistance = distance;
      nearestIndex = i;
    }
  }
  
  return nearestIndex;
}

/** Calculate Euclidean distance between two colors */
function colorDistance(c1: Color, c2: Color): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Convert color index to color */
export function indexToColor(index: number, palette: ColorPalette): Color {
  if (index < 0 || index >= palette.size) {
    throw new Error(`Color index ${index} out of range`);
  }
  return palette.colors[index];
}

/** Quantize an arbitrary color to nearest palette color */
export function quantizeColor(color: Color, palette: ColorPalette): Color {
  const index = findNearestColor(color, palette);
  return palette.colors[index];
}
