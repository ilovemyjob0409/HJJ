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
