import { createClient } from "@supabase/supabase-js";

const FACE_DERIVATIVE_SIGNED_URL_TTL_SECONDS = 120;

function createStorageSigningClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type FaceDerivativeSignableRow = {
  asset_face_id: string;
  derivative_kind: "review_square_256";
  storage_bucket: string;
  storage_path: string;
};

export async function signFaceDerivativeUrl(
  derivative: FaceDerivativeSignableRow | null | undefined,
) {
  if (!derivative?.storage_bucket || !derivative.storage_path) {
    return null;
  }

  try {
    const admin = createStorageSigningClient();
    const { data, error } = await admin.storage
      .from(derivative.storage_bucket)
      .createSignedUrl(derivative.storage_path, FACE_DERIVATIVE_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function signFaceDerivativeUrls(
  derivatives: FaceDerivativeSignableRow[],
) {
  const signedEntries = await Promise.all(
    derivatives.map(async (derivative) => {
      const signedUrl = await signFaceDerivativeUrl(derivative);
      return [derivative.asset_face_id, signedUrl] as const;
    }),
  );

  return new Map<string, string | null>(signedEntries);
}
