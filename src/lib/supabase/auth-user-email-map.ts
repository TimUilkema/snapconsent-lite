import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type LoadAuthUserEmailMapOptions = {
  errorCode: string;
  errorMessage: string;
};

export async function loadAuthUserEmailMap(
  admin: SupabaseClient,
  userIds: string[],
  options: LoadAuthUserEmailMapOptions,
) {
  const wantedUserIds = new Set(userIds);
  const result = new Map<string, string>();
  const perPage = 1000;

  if (wantedUserIds.size === 0) {
    return result;
  }

  for (let page = 1; result.size < wantedUserIds.size; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new HttpError(500, options.errorCode, options.errorMessage);
    }

    data.users.forEach((user) => {
      if (wantedUserIds.has(user.id)) {
        result.set(user.id, user.email?.trim().toLowerCase() ?? "unknown@email");
      }
    });

    if (data.users.length < perPage) {
      break;
    }
  }

  return result;
}
