import { useTranslations } from "next-intl";

type TemplateStatusBadgeProps = {
  status: "draft" | "published" | "archived";
};

const STATUS_STYLES: Record<TemplateStatusBadgeProps["status"], string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-800",
  published: "border-emerald-200 bg-emerald-50 text-emerald-800",
  archived: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

export function TemplateStatusBadge({ status }: TemplateStatusBadgeProps) {
  const t = useTranslations("templates.status");

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {t(status)}
    </span>
  );
}
