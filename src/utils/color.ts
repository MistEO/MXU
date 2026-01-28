export function isHexLike(input: string): boolean {
  const v = input.trim();
  return v === '' || v === '#' || /^#?[0-9a-fA-F]{0,6}$/.test(v);
}

export function isValidHex(input: string): boolean {
  const v = input.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v);
}

/**
 * Normalize a hex color string.
 * - Accepts '#RGB' / '#RRGGBB' / 'RGB' / 'RRGGBB'
 * - Returns normalized '#rrggbb'
 * - Returns null if it can't be normalized
 */
export function normalizeHex(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith('#')) v = `#${v}`;
  v = v.toLowerCase();

  if (/^#[0-9a-f]{3}$/.test(v)) {
    const r = v[1];
    const g = v[2];
    const b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return null;
}

