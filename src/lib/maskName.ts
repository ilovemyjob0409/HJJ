// Keeps the first and last character of a name, replacing everything in
// between with one full-width 'Ｏ' per masked character. Used only when
// building a roster response for a STUDENT-role requester — admins and
// the assigned teacher always see real names (see
// docs/superpowers/specs/2026-07-22-go-hall-design.md, "Name masking").
export function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + 'Ｏ';
  return name[0] + 'Ｏ'.repeat(name.length - 2) + name[name.length - 1];
}
