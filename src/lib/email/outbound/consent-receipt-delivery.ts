import { dispatchOutboundEmailJobById, enqueueConsentReceiptEmailJob } from "@/lib/email/outbound/jobs";

type SubmittedConsentForReceipt = {
  consentId: string;
  duplicate: boolean;
  revokeToken: string | null;
  subjectEmail: string;
  subjectName: string;
  projectName: string;
  signedAt: string;
  tenantId: string;
  consentText: string;
  consentVersion: string;
};

type DeliveryDependencies = {
  enqueueConsentReceiptEmailJob: typeof enqueueConsentReceiptEmailJob;
  dispatchOutboundEmailJobById: typeof dispatchOutboundEmailJobById;
};

const defaultDependencies: DeliveryDependencies = {
  enqueueConsentReceiptEmailJob,
  dispatchOutboundEmailJobById,
};

export async function deliverConsentReceiptAfterSubmit(
  consent: SubmittedConsentForReceipt,
  dependencies: DeliveryDependencies = defaultDependencies,
) {
  if (consent.duplicate || !consent.revokeToken) {
    return {
      receiptStatus: "sent" as const,
      jobId: null,
    };
  }

  try {
    const queued = await dependencies.enqueueConsentReceiptEmailJob({
      tenantId: consent.tenantId,
      payload: {
        consentId: consent.consentId,
        revokeToken: consent.revokeToken,
        subjectName: consent.subjectName,
        subjectEmail: consent.subjectEmail,
        projectName: consent.projectName,
        signedAtIso: consent.signedAt,
        consentText: consent.consentText,
        consentVersion: consent.consentVersion,
      },
    });

    if (queued.status === "sent") {
      return {
        receiptStatus: "sent" as const,
        jobId: queued.jobId,
      };
    }

    const dispatched = await dependencies.dispatchOutboundEmailJobById({
      tenantId: consent.tenantId,
      jobId: queued.jobId,
    });

    return {
      receiptStatus: dispatched.outcome === "sent" ? ("sent" as const) : ("queued" as const),
      jobId: queued.jobId,
    };
  } catch {
    return {
      receiptStatus: "queued" as const,
      jobId: null,
    };
  }
}
