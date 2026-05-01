"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";

import type { RoleEditorData, RoleEditorRole } from "@/lib/tenant/custom-role-service";
import {
  CAPABILITY_GROUPS,
  CAPABILITY_LABEL_KEYS,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";

type StatusMessage =
  | {
      tone: "success" | "error";
      text: string;
    }
  | null;

type CustomRoleFormState = {
  mode: "create" | "edit";
  roleId: string | null;
  name: string;
  description: string;
  capabilityKeys: TenantCapability[];
};

const EMPTY_FORM: CustomRoleFormState = {
  mode: "create",
  roleId: null,
  name: "",
  description: "",
  capabilityKeys: [],
};

type CustomRoleManagementSectionProps = {
  data: RoleEditorData;
  onRefresh: () => void;
};

type MembersTranslator = ReturnType<typeof useTranslations>;

function roleCapabilityGroups(role: RoleEditorRole) {
  const selected = new Set(role.capabilityKeys);
  return CAPABILITY_GROUPS
    .map((group) => ({
      key: group.key,
      capabilities: group.capabilities.filter((capability) => selected.has(capability)),
    }))
    .filter((group) => group.capabilities.length > 0);
}

function errorMessage(t: MembersTranslator, payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return t("customRoleForm.error");
  }

  const error = "error" in payload ? String(payload.error) : "";
  if (error === "role_name_conflict") {
    return t("customRoleForm.duplicateNameError");
  }
  if (error === "empty_capability_set") {
    return t("customRoleForm.emptyCapabilityError");
  }

  return "message" in payload ? String(payload.message) : t("customRoleForm.error");
}

export function CustomRoleManagementSection({ data, onRefresh }: CustomRoleManagementSectionProps) {
  const t = useTranslations("members");
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<CustomRoleFormState>(EMPTY_FORM);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const activeCustomRoles = useMemo(
    () => data.customRoles.filter((role) => !role.archivedAt),
    [data.customRoles],
  );

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function editRole(role: RoleEditorRole) {
    setStatusMessage(null);
    setForm({
      mode: "edit",
      roleId: role.id,
      name: role.name,
      description: role.description ?? "",
      capabilityKeys: role.capabilityKeys,
    });
  }

  function toggleCapability(capability: TenantCapability) {
    setForm((current) => {
      const selected = new Set(current.capabilityKeys);
      if (selected.has(capability)) {
        selected.delete(capability);
      } else {
        selected.add(capability);
      }

      return {
        ...current,
        capabilityKeys: Array.from(selected),
      };
    });
  }

  function submitRole() {
    if (form.capabilityKeys.length === 0) {
      setStatusMessage({ tone: "error", text: t("customRoleForm.emptyCapabilityError") });
      return;
    }

    startTransition(async () => {
      try {
        const endpoint =
          form.mode === "edit" && form.roleId
            ? `/api/members/roles/${form.roleId}`
            : "/api/members/roles";
        const response = await fetch(endpoint, {
          method: form.mode === "edit" ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            capabilityKeys: form.capabilityKeys,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessage(t, payload));
        }

        setStatusMessage({
          tone: "success",
          text: form.mode === "edit" ? t("customRoles.updated") : t("customRoles.created"),
        });
        resetForm();
        onRefresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("customRoleForm.error"),
        });
      }
    });
  }

  function archiveRole(role: RoleEditorRole) {
    if (!window.confirm(t("customRoles.archiveConfirm", { name: role.name }))) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/roles/${role.id}/archive`, {
          method: "POST",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessage(t, payload));
        }

        const archivePayload = payload as { changed?: boolean } | null;
        setStatusMessage({
          tone: "success",
          text: archivePayload?.changed
            ? t("customRoles.archiveChanged")
            : t("customRoles.archiveUnchanged"),
        });
        if (form.roleId === role.id) {
          resetForm();
        }
        onRefresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("customRoleForm.error"),
        });
      }
    });
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-900">{t("customRoles.title")}</h2>
        <p className="text-sm text-zinc-600">{t("customRoles.subtitle")}</p>
        <p className="text-sm text-zinc-600">{t("customRoles.definitionOnlyNote")}</p>
      </div>

      {statusMessage ? (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            statusMessage.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-700"
          }`}
        >
          {statusMessage.text}
        </p>
      ) : null}

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          {form.mode === "edit" ? t("customRoleForm.editTitle") : t("customRoleForm.createTitle")}
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-zinc-800">
            {t("customRoleForm.nameLabel")}
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              disabled={isPending}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
            />
          </label>
          <label className="text-sm font-medium text-zinc-800">
            {t("customRoleForm.descriptionLabel")}
            <input
              value={form.description}
              placeholder={t("customRoleForm.descriptionPlaceholder")}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              disabled={isPending}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
            />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-zinc-800">
            {t("customRoleForm.capabilitiesLabel")}
          </legend>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {CAPABILITY_GROUPS.map((group) => (
              <div key={group.key} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="text-sm font-medium text-zinc-900">
                  {t(`capabilityGroups.${group.key}`)}
                </div>
                <div className="mt-2 space-y-2">
                  {group.capabilities.map((capability) => (
                    <label key={capability} className="flex gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={form.capabilityKeys.includes(capability)}
                        onChange={() => toggleCapability(capability)}
                        disabled={isPending}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                      />
                      <span>{t(`capabilities.${CAPABILITY_LABEL_KEYS[capability]}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={submitRole}
            disabled={isPending || !form.name.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {form.mode === "edit" ? t("customRoleForm.update") : t("customRoleForm.create")}
          </button>
          {form.mode === "edit" ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("customRoleForm.cancel")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        {activeCustomRoles.length === 0 ? (
          <p className="text-sm text-zinc-600">{t("customRoles.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-600">
                  <th className="py-2 pr-4 font-medium">{t("customRoles.columns.name")}</th>
                  <th className="py-2 pr-4 font-medium">{t("customRoles.columns.description")}</th>
                  <th className="py-2 pr-4 font-medium">{t("customRoles.columns.capabilities")}</th>
                  <th className="py-2 font-medium">{t("customRoles.columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {activeCustomRoles.map((role) => (
                  <tr key={role.id} className="border-b border-zinc-100 align-top last:border-b-0">
                    <td className="w-56 py-3 pr-4 font-medium text-zinc-900">{role.name}</td>
                    <td className="py-3 pr-4 text-zinc-600">{role.description || "-"}</td>
                    <td className="py-3 pr-4">
                      <div className="space-y-2 text-zinc-600">
                        {roleCapabilityGroups(role).map((group) => (
                          <div key={group.key}>
                            <div className="font-medium text-zinc-800">
                              {t(`capabilityGroups.${group.key}`)}
                            </div>
                            <div className="mt-1">
                              {group.capabilities
                                .map((capability) =>
                                  t(`capabilities.${CAPABILITY_LABEL_KEYS[capability]}`),
                                )
                                .join(", ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => editRole(role)}
                          disabled={isPending}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("customRoles.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => archiveRole(role)}
                          disabled={isPending}
                          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("customRoles.archive")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
