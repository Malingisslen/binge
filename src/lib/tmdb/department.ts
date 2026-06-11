// PE1: TMDB returnerar known_for_department som rå engelsk sträng ("Acting").
// UI:t är svenskt — översätt kända departments, fallback: versal första bokstav.

const DEPARTMENT_SV: Record<string, string> = {
  'acting': 'Skådespelare',
  'directing': 'Regi',
  'writing': 'Manus',
  'production': 'Produktion',
  'sound': 'Ljud',
  'camera': 'Foto',
  'editing': 'Klippning',
  'art': 'Scenografi',
  'costume & make-up': 'Kostym & smink',
  'visual effects': 'Visuella effekter',
  'lighting': 'Ljus',
  'crew': 'Team',
  'creator': 'Skapare',
};

export function translateDepartment(department: string | null | undefined): string {
  if (!department) return 'Person';
  const known = DEPARTMENT_SV[department.trim().toLowerCase()];
  if (known) return known;
  const d = department.trim();
  return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
}
