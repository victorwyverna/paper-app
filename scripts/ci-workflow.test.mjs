import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);
const workflow = await readFile(workflowPath, "utf8");

test("builds pinned official MinIO source instead of using a withdrawn image", () => {
  assert.doesNotMatch(workflow, /(?:quay\.io\/)?minio\/minio:/);
  assert.match(workflow, /uses: actions\/setup-go@v6/);
  assert.match(workflow, /go-version: 1\.24\.2/);
  assert.match(
    workflow,
    /go install\s+github\.com\/minio\/minio@07c3a429bfed433e49018cb0f78a52145d4bedeb/,
  );
  assert.match(workflow, /minio-bin\/minio"? server/);
});
