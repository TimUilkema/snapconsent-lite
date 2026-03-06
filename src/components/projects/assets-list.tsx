type AssetRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  thumbnailUrl?: string | null;
};

type AssetsListProps = {
  assets: AssetRow[];
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AssetsList({ assets }: AssetsListProps) {
  if (assets.length === 0) {
    return <p className="text-sm text-zinc-600">No assets yet.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-4">
      {assets.map((asset) => (
        <li key={asset.id} className="rounded border border-zinc-200 p-3">
          <div className="mb-2 aspect-square w-full overflow-hidden rounded bg-zinc-100">
            {asset.thumbnailUrl ? (
              <img
                src={asset.thumbnailUrl}
                alt={asset.original_filename}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <p className="truncate font-medium" title={asset.original_filename}>
            {asset.original_filename}
          </p>
          <p className="text-xs text-zinc-600">
            {asset.status} - {formatBytes(asset.file_size_bytes)}
          </p>
        </li>
      ))}
    </ul>
  );
}
