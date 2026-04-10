type ValidateConsentBaseFieldsInput = {
  subjectName: string | null | undefined;
  subjectEmail: string | null | undefined;
  consentAcknowledged: boolean;
  faceMatchOptIn: boolean;
  hasHeadshot: boolean;
};

export type ConsentBaseFieldErrors = Partial<
  Record<"subject_name" | "subject_email" | "consent_acknowledged" | "face_match_section", string>
>;

export function validateConsentBaseFields(input: ValidateConsentBaseFieldsInput) {
  const normalizedSubjectName = input.subjectName?.trim() ?? "";
  const normalizedSubjectEmail = input.subjectEmail?.trim().toLowerCase() ?? "";
  const fieldErrors: ConsentBaseFieldErrors = {};

  if (normalizedSubjectName.length < 2) {
    fieldErrors.subject_name = "required";
  }

  if (!normalizedSubjectEmail) {
    fieldErrors.subject_email = "required";
  } else if (!normalizedSubjectEmail.includes("@")) {
    fieldErrors.subject_email = "invalid";
  }

  if (!input.consentAcknowledged) {
    fieldErrors.consent_acknowledged = "required";
  }

  if (input.faceMatchOptIn && !input.hasHeadshot) {
    fieldErrors.face_match_section = "headshot_required";
  }

  return {
    normalizedSubjectName,
    normalizedSubjectEmail,
    fieldErrors,
  };
}
