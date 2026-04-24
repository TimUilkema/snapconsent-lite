import type { CurrentUserTenantMembership } from "@/lib/tenant/active-tenant";

type ActiveTenantSwitcherProps = {
  memberships: CurrentUserTenantMembership[];
  activeTenantId: string;
  label: string;
  submitLabel: string;
};

export function ActiveTenantSwitcher({
  memberships,
  activeTenantId,
  label,
  submitLabel,
}: ActiveTenantSwitcherProps) {
  if (memberships.length < 2) {
    return null;
  }

  return (
    <form action="/api/tenants/active" method="post" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="next" value="/projects" />
      <input type="hidden" name="error_redirect" value="/select-tenant" />
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</span>
        <select
          name="tenant_id"
          defaultValue={activeTenantId}
          className="min-w-[200px] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
        >
          {memberships.map((membership) => (
            <option key={membership.tenantId} value={membership.tenantId}>
              {membership.tenantName}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}
