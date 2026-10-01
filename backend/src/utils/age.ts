export function calculateAge(birthDate: string, asOf: Date = new Date()): number {
  const dob = new Date(`${birthDate}T00:00:00`);
  let age = asOf.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear =
    asOf.getMonth() < dob.getMonth() || (asOf.getMonth() === dob.getMonth() && asOf.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age--;
  return age;
}

export function isAdult(birthDate: string): boolean {
  return calculateAge(birthDate) >= 18;
}
