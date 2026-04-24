import {
  dispatchOutboundEmailJobById,
  enqueueTenantMembershipInviteEmailJob,
} from "@/lib/email/outbound/jobs";
import type { TenantMembershipInviteEmailPayload } from "@/lib/email/outbound/types";

type DeliveryDependencies = {
  enqueueTenantMembershipInviteEmailJob: typeof enqueueTenantMembershipInviteEmailJob;
  dispatchOutboundEmailJobById: typeof dispatchOutboundEmailJobById;
};

const defaultDependencies: DeliveryDependencies = {
  enqueueTenantMembershipInviteEmailJob,
  dispatchOutboundEmailJobById,
};

export async function deliverTenantMembershipInviteEmail(
  input: {
    tenantId: string;
    payload: TenantMembershipInviteEmailPayload;
  },
  dependencies: DeliveryDependencies = defaultDependencies,
) {
  try {
    const queued = await dependencies.enqueueTenantMembershipInviteEmailJob({
      tenantId: input.tenantId,
      payload: input.payload,
    });

    if (queued.status === "sent") {
      return {
        deliveryStatus: "sent" as const,
        jobId: queued.jobId,
      };
    }

    const dispatched = await dependencies.dispatchOutboundEmailJobById({
      tenantId: input.tenantId,
      jobId: queued.jobId,
    });

    return {
      deliveryStatus: dispatched.outcome === "sent" ? ("sent" as const) : ("queued" as const),
      jobId: queued.jobId,
    };
  } catch {
    return {
      deliveryStatus: "queued" as const,
      jobId: null,
    };
  }
}
