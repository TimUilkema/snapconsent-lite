import { escapeEmailHtml } from "@/lib/email/outbound/html";
import { formatOutboundEmailTimestampUtc } from "@/lib/email/outbound/timestamps";
import type { RenderedOutboundEmail, TenantMembershipInviteEmailPayload } from "@/lib/email/outbound/types";
import { buildExternalUrl } from "@/lib/url/external-origin";
import { buildTenantMembershipInvitePath } from "@/lib/url/paths";

function formatRoleLabel(role: TenantMembershipInviteEmailPayload["role"]) {
  switch (role) {
    case "admin":
      return "Admin";
    case "reviewer":
      return "Reviewer";
    case "photographer":
      return "Photographer";
    default:
      return role;
  }
}

export function renderTenantMembershipInviteEmail(
  payload: TenantMembershipInviteEmailPayload,
): RenderedOutboundEmail {
  const acceptUrl = buildExternalUrl(buildTenantMembershipInvitePath(payload.inviteToken));
  const expiresAt = formatOutboundEmailTimestampUtc(payload.expiresAtIso);
  const roleLabel = formatRoleLabel(payload.role);
  const subject = `Join ${payload.tenantName} on SnapConsent`;

  const text = [
    `Hi,`,
    "",
    `${payload.inviterDisplayName} invited ${payload.invitedEmail} to join ${payload.tenantName} on SnapConsent.`,
    `Role: ${roleLabel}`,
    `Expires: ${expiresAt}`,
    "",
    "Open this link to review and accept the invitation:",
    acceptUrl,
    "",
    "If you were not expecting this invitation, you can ignore this email.",
  ].join("\n");

  const html = `
    <p>Hi,</p>
    <p>${escapeEmailHtml(payload.inviterDisplayName)} invited ${escapeEmailHtml(payload.invitedEmail)} to join ${escapeEmailHtml(payload.tenantName)} on SnapConsent.</p>
    <ul>
      <li><strong>Role:</strong> ${escapeEmailHtml(roleLabel)}</li>
      <li><strong>Expires:</strong> ${escapeEmailHtml(expiresAt)}</li>
    </ul>
    <p><a href="${escapeEmailHtml(acceptUrl)}">Review and accept the invitation</a></p>
    <p>If you were not expecting this invitation, you can ignore this email.</p>
  `;

  return {
    subject,
    text,
    html,
  };
}
