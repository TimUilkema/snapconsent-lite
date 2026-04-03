import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const allowlistedFiles = new Set([
  "src/app/api/internal/headshots/cleanup/route.ts",
  "src/app/api/projects/[projectId]/assets/route.ts",
  "src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts",
  "src/lib/matching/auto-match-reconcile.ts",
]);
const safeCommentPattern = /safe-in-filter:/i;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(resolved);
    }

    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }

    return [resolved];
  });
}

const violations = [];

for (const filePath of walk(srcDir)) {
  const relativePath = path.relative(rootDir, filePath).replaceAll("\\", "/");
  if (allowlistedFiles.has(relativePath)) {
    continue;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes(".in(")) {
      return;
    }

    const windowStart = Math.max(0, index - 8);
    const context = lines.slice(windowStart, index + 1).join("\n");
    if (safeCommentPattern.test(context)) {
      return;
    }

    violations.push(`${relativePath}:${index + 1} direct .in(...) requires shared chunking, set-based SQL/RPC, or a safe-in-filter comment`);
  });
}

if (violations.length > 0) {
  console.error("Unsafe direct .in(...) usage detected:\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Unsafe .in(...) check passed.");
