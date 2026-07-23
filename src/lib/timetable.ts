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

export const LEVEL_PALETTE = [
  '#F2C14E',
  '#6FCF97',
  '#EB5757',
  '#56CCF2',
  '#BB6BD9',
  '#F2994A',
  '#27AE60',
  '#9B51E0',
] as const;

export const UNSET_SUBJECT_COLOR = '#9a9a9a';

// Curated Morandi (muted, gray-toned) swatches for subject colors — the
// bright pastel end of the range; timetable cards pair these with dark
// ink text (not white) to keep contrast.
export const MORANDI_PALETTE = [
  '#D4A59A', // 淡豆沙紅
  '#C99789', // 淺磚紅
  '#D9B9A3', // 奶杏
  '#D6C49A', // 淺芥黃
  '#C9B18C', // 淺駝
  '#A8B8A0', // 淺橄欖綠
  '#8FA898', // 青灰綠
  '#9CB0A2', // 灰薄荷
  '#A9BCC7', // 淺霧藍
  '#92A8B8', // 灰藍
  '#B3A6BD', // 淺灰紫
  '#C2A8B4', // 藕粉
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
