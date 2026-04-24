import { PassThrough, Readable } from "node:stream";

import type { SupabaseClient } from "@supabase/supabase-js";
import archiver from "archiver";

import { HttpError } from "@/lib/http/errors";
import {
  buildPreparedProjectExport,
  loadProjectExportRecords,
} from "@/lib/project-export/project-export";
import { resolveProjectWorkspaceSelection } from "@/lib/projects/project-workspaces-service";
import { resolveWorkspacePermissions } from "@/lib/tenant/permissions";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type ProjectRow = {
  id: string;
  name: string;
};

async function requireAuthenticatedProjectScope(input: {
  authSupabase: SupabaseClient;
  projectId: string;
  requestedWorkspaceId?: string | null;
}) {
  const {
    data: { user },
  } = await input.authSupabase.auth.getUser();

  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const tenantId = await resolveTenantId(input.authSupabase);
  if (!tenantId) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  const { data: project, error } = await input.authSupabase
    .from("projects")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", input.projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  const workspaceSelection = await resolveProjectWorkspaceSelection({
    supabase: input.authSupabase,
    tenantId,
    projectId: input.projectId,
    userId: user.id,
    requestedWorkspaceId: input.requestedWorkspaceId ?? null,
  });

  if (workspaceSelection.requiresExplicitSelection || !workspaceSelection.selectedWorkspace) {
    throw new HttpError(400, "workspace_required", "Select a project workspace before exporting.");
  }

  const workspacePermissions = await resolveWorkspacePermissions(
    input.authSupabase,
    tenantId,
    user.id,
    input.projectId,
    workspaceSelection.selectedWorkspace.id,
  );

  if (!workspacePermissions.canReviewProjects) {
    throw new HttpError(403, "project_export_forbidden", "Only owners, admins, and reviewers can export workspaces.");
  }

  return {
    tenantId,
    project: project as ProjectRow,
    workspace: workspaceSelection.selectedWorkspace,
  };
}

function toAttachmentFilename(filename: string) {
  return filename.replace(/["\\]/g, "_");
}

function createZipStreamResponse(input: {
  adminSupabase: SupabaseClient;
  preparedExport: ReturnType<typeof buildPreparedProjectExport>;
}) {
  const archive = archiver("zip", {
    zlib: { level: 9 },
  });
  const output = new PassThrough();

  const destroyOutput = (error: unknown) => {
    const normalizedError = error instanceof Error ? error : new Error("Project export failed.");
    if (!output.destroyed) {
      output.destroy(normalizedError);
    }
  };

  archive.on("error", destroyOutput);
  archive.on("warning", destroyOutput);
  archive.pipe(output);

  void (async () => {
    try {
      const rootPath = `${input.preparedExport.projectFolderName}/`;
      archive.append(Buffer.alloc(0), { name: `${rootPath}assets/` });
      archive.append(Buffer.alloc(0), { name: `${rootPath}consent_forms/` });

      for (const asset of input.preparedExport.assets) {
        const assetPath = `${rootPath}assets/${asset.exportedFilename}`;
        const metadataPath = `${rootPath}assets/${asset.metadataFilename}`;
        const { data, error } = await input.adminSupabase.storage
          .from(asset.storageBucket)
          .download(asset.storagePath);

        if (error || !data) {
          throw new HttpError(
            500,
            "project_export_asset_missing",
            "One or more original project assets are missing.",
          );
        }

        archive.append(Readable.fromWeb(data.stream()), { name: assetPath });
        archive.append(`${JSON.stringify(asset.metadata, null, 2)}\n`, { name: metadataPath });
      }

      for (const consent of input.preparedExport.consents) {
        const consentPath = `${rootPath}consent_forms/${consent.exportedFilename}`;
        archive.append(`${JSON.stringify(consent.data, null, 2)}\n`, { name: consentPath });
      }

      await archive.finalize();
    } catch (error) {
      destroyOutput(error);
      archive.destroy();
    }
  })();

  return new Response(Readable.toWeb(output), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${toAttachmentFilename(input.preparedExport.downloadFilename)}"`,
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function createProjectExportResponse(input: {
  authSupabase: SupabaseClient;
  adminSupabase: SupabaseClient;
  projectId: string;
  requestedWorkspaceId?: string | null;
}) {
  const { tenantId, project, workspace } = await requireAuthenticatedProjectScope({
    authSupabase: input.authSupabase,
    projectId: input.projectId,
    requestedWorkspaceId: input.requestedWorkspaceId ?? null,
  });

  const records = await loadProjectExportRecords({
    supabase: input.adminSupabase,
    tenantId,
    projectId: project.id,
    workspaceId: workspace?.id ?? null,
  });
  const preparedExport = buildPreparedProjectExport({
    projectId: project.id,
    projectName: project.name,
    records,
  });

  return createZipStreamResponse({
    adminSupabase: input.adminSupabase,
    preparedExport,
  });
}
