export const ACTIVITY_CATEGORIES = ['CAMP', 'LECTURE', 'COMPETITION', 'OBSERVATION'] as const;

export type ActivityCategoryValue = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategoryValue, string> = {
  CAMP: '營隊',
  LECTURE: '講座',
  COMPETITION: '比賽',
  OBSERVATION: '觀摩課',
};
