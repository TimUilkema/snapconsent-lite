export type SubjectRelation =
  | {
      email: string;
      full_name: string;
    }
  | Array<{
      email: string;
      full_name: string;
    }>
  | null
  | undefined;

export function normalizeSubjectRelation(subjects: SubjectRelation) {
  if (Array.isArray(subjects)) {
    return subjects[0] ?? null;
  }

  return subjects ?? null;
}
