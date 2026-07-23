// Display helpers for the admin weekly timetable
// (docs/superpowers/specs/2026-07-23-class-weekly-timetable-design.md).

// The weekday is implied by which column a card sits in, so the 週X
// substring inside a class name is redundant there — strip it, including
// parentheses left empty by the removal (MPM（週一） → MPM）.
export function stripWeekday(name: string): string {
  return name
    .replace(/週[日一二三四五六]/g, '')
    .replace(/（\s*）/g, '')
    .trim();
}

// Mid-dark Morandi tones — one step deeper than MORANDI_PALETTE so the
// level accent bar stays visible against the bright pastel card colors.
export const LEVEL_PALETTE = [
  '#A67F78', // 豆沙紅
  '#A38F71', // 駝
  '#8D7B6C', // 灰褐
  '#8A9A7B', // 橄欖綠
  '#6B7D71', // 墨綠
  '#7A8B99', // 霧藍
  '#8C7F94', // 灰紫
  '#9A8492', // 藕紫
] as const;

export const UNSET_SUBJECT_COLOR = '#9a9a9a';

// Curated Morandi (muted, gray-toned) swatches for subject colors — the
// bright pastel end of the range; timetable cards pair these with dark
// ink text (not white) to keep contrast.
export const MORANDI_PALETTE = [
  '#E3C4BD', // 淡豆沙紅
  '#DCBBB2', // 淺磚紅
  '#E6D2C3', // 奶杏
  '#E4D9BD', // 淺芥黃
  '#DCCCB4', // 淺駝
  '#C6D1C1', // 淺橄欖綠
  '#B6C6BC', // 青灰綠
  '#BFCCC3', // 灰薄荷
  '#C7D3DB', // 淺霧藍
  '#B8C6D1', // 灰藍
  '#CEC5D4', // 淺灰紫
  '#D7C6CE', // 藕粉
] as const;

// Level is freeform text, so its accent color is derived by hashing the
// string into a fixed palette — stable per string, zero maintenance,
// collisions acceptable (it's a secondary cue, not an identifier).
export function levelColor(level: string): string {
  let hash = 0;
  for (let i = 0; i < level.length; i++) {
    hash = (hash * 31 + level.charCodeAt(i)) >>> 0;
  }
  return LEVEL_PALETTE[hash % LEVEL_PALETTE.length];
}
