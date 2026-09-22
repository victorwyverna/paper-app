import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const packagePaths = [
  "apps/backend/package.json",
  "apps/frontend/package.json",
];

export function findPackagesMissingTask(taskName, manifests) {
  return manifests
    .filter((manifest) => !manifest.scripts?.[taskName])
    .map((manifest) => manifest.name);
}

async function main() {
  const taskName = process.argv[2];

  if (!taskName) {
    throw new Error(
      "Usage: node scripts/assert-workspace-task.mjs <task-name>",
    );
  }

  const manifests = await Promise.all(
    packagePaths.map(async (packagePath) =>
      JSON.parse(await readFile(packagePath, "utf8")),
    ),
  );
  const missingPackages = findPackagesMissingTask(taskName, manifests);

  if (missingPackages.length > 0) {
    throw new Error(
      `Workspace task "${taskName}" is missing from: ${missingPackages.join(", ")}`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
