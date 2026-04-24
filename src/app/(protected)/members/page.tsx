import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MemberManagementPanel } from "@/components/members/member-management-panel";
import { HttpError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { getTenantMemberManagementData } from "@/lib/tenant/member-management-service";
import { ensureTenantId } from "@/lib/tenant/resolve-tenant";

export default async function MembersPage() {
  const t = await getTranslations("members");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await ensureTenantId(supabase);
  let data = null as Awaited<ReturnType<typeof getTenantMemberManagementData>> | null;
  let readOnly = false;

  try {
    data = await getTenantMemberManagementData({
      supabase,
      tenantId,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === "tenant_member_management_forbidden") {
      readOnly = true;
    } else {
      throw error;
    }
  }

  if (readOnly) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
          <p className="text-sm text-zinc-600">{t("subtitle")}</p>
        </div>
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          {t("readOnly")}
        </p>
        <Link href="/projects" className="text-sm text-zinc-700 underline">
          {t("backToProjects")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="text-sm text-zinc-600">{t("subtitle")}</p>
      </div>
      <MemberManagementPanel data={data!} />
    </div>
  );
}
