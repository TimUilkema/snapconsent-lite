import { redirect } from "next/navigation";

import { ProfilesShell } from "@/components/profiles/profiles-shell";
import { listRecurringProfilesPageData } from "@/lib/profiles/profile-directory-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type ProfilesPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    type?: string | string[];
    includeArchived?: string | string[];
  }>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ProfilesPage({ searchParams }: ProfilesPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    redirect("/projects");
  }

  let data: Awaited<ReturnType<typeof listRecurringProfilesPageData>>;

  try {
    const resolvedSearchParams = await searchParams;
    data = await listRecurringProfilesPageData({
      supabase,
      tenantId,
      userId: user.id,
      q: firstSearchParam(resolvedSearchParams.q),
      profileTypeId: firstSearchParam(resolvedSearchParams.type),
      includeArchived: firstSearchParam(resolvedSearchParams.includeArchived) === "1",
    });
  } catch {
    redirect("/projects");
  }

  return <ProfilesShell data={data} />;
}
