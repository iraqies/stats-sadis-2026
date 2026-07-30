export function cleanSchoolName(name: string): string {
  return name.replace(/^\d+_/, '').replace(/_/g, ' ')
}
