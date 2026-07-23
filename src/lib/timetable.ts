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
  '#B4B1A4', // 暖灰綠
  '#D2D1CE', // 銀灰
  '#C6B69B', // 沙杏
  '#DFCDB2', // 奶油杏
  '#D9CFC0', // 亞麻
  '#C9C3B4', // 米灰
  '#AEB8AE', // 鼠尾草
  '#BFC9C4', // 灰薄荷
  '#ABC2CC', // 霧藍
  '#B4BFC9', // 灰藍
  '#C9B2AC', // 灰玫瑰
  '#B9B0BC', // 灰藕紫
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
