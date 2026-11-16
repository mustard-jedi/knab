// Flag colours. A flag stores one of these keys; the hex is the same in light
// and dark mode and is only ever used as a fill or tint, never as text colour.
export const FLAG_COLORS = {
  red: '#e5484d',
  orange: '#f08c2e',
  yellow: '#e0b000',
  green: '#2fa860',
  blue: '#3b8eea',
  purple: '#8b62d9',
  pink: '#e0619f',
  teal: '#1aa6a6',
  gray: '#8a94a3',
};

// The last entry is the review flag: see server/migrations/003_review_flag.sql.
export const REVIEW_FLAG = 'To review';
export const DEFAULT_FLAGS = [['Red', 'red'], ['Orange', 'orange'], ['Yellow', 'yellow'], ['Green', 'green'], ['Blue', 'blue'], ['Purple', 'purple'], [REVIEW_FLAG, 'teal']];
