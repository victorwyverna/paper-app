# Phase 6 Upload Validation and Lifecycle Design

## Purpose

Phase 6 makes Paper treat uploaded images as untrusted input and establishes a
minimal lifecycle for objects stored in S3. An accepted upload must be a fully
decodable JPEG, PNG, WebP, or GIF whose bytes agree with the request's declared
media type. Paper tracks every accepted upload in PostgreSQL, marks uploads when
validated article content first references them, and provides an idempotent
command for deleting uploads that remain unattached for more than 24 hours.

This design implements only Phase 6 of `docs/design/quality-hardening.md`.
Production scheduling and richer article-asset ownership remain future work.

## User and operator outcomes

- Authors cannot upload arbitrary or corrupt bytes by labelling them as an
  allowed image type.
- A successful upload keeps its original bytes and animation while using a
  server-detected content type and extension.
- An article cannot be created or updated with a Paper upload URL whose tracked
  upload no longer exists.
- Uploads referenced by successful article writes become ineligible for stale
  cleanup.
- Operators can run one bounded, repeatable cleanup command without configuring
  a scheduler in this phase.
- Partial failures between PostgreSQL and S3 remain discoverable and safe to
  retry.

## Scope and constraints

- Continue accepting a raw image request body at `POST /uploads`; do not switch
  to `multipart/form-data`.
- Keep the existing 5 MiB encoded-body limit.
- Accept only canonical `image/jpeg`, `image/png`, `image/webp`, and `image/gif`
  media types. Media type comparison is case-insensitive and ignores valid
  `Content-Type` parameters.
- Preserve the original accepted bytes. Phase 6 does not resize, strip metadata,
  optimise, or re-encode images.
- Keep upload URLs in the existing
  `/uploads/<uuid>.<jpg|png|webp|gif>` form.
- PostgreSQL is the source of truth for whether an upload is tracked and may be
  served or attached.
- Mark attachment only after a successful article create or content update.
- Do not unmark an upload when later article content stops referencing it.
- Do not delete uploads when an article is deleted.
- Do not add an Article-Asset relation, media library, production scheduler, or
  deployment configuration.

## Architecture

### Image validation module

`image-validation` is a deep module whose interface accepts the request bytes
and claimed media type and returns validated metadata:

```ts
type ValidatedImage = {
  detectedContentType: SupportedImageContentType;
  extension: "jpg" | "png" | "webp" | "gif";
  byteSize: number;
};

async function inspectImage(
  bytes: Buffer,
  claimedContentType: string,
): Promise<ValidatedImage>;
```

Its implementation owns `sharp`, supported-format mapping, full pixel decoding,
animated-frame handling, and decoded-pixel limits. Callers do not depend on
Sharp metadata or error shapes.

Sharp metadata inspection identifies the decoder and dimensions but is not, by
itself, sufficient validation because it does not decode compressed pixel data.
After checking that the detected format is one of the four allowed formats, the
module forces decoding of every frame with strict failure handling. The original
input buffer, rather than decoded or re-encoded output, proceeds to storage.

The module enforces a maximum of 40,000,000 decoded pixels across all frames.
For animated GIF and WebP input, total pixels are calculated from frame width,
frame height, and frame count before full decoding. Sharp's input safeguards
remain enabled as a second limit. A decoded-pixel overflow is a resource-limit
failure, not a media-type failure.

### Canonical upload-key module

`upload-key` owns the grammar for canonical Paper upload URLs and object keys.
It returns the decoded object key from a valid canonical URL and returns no
value for anything else. TipTap image-source validation and article upload-key
extraction both use this module so origin, path, UUID, extension, encoding,
query, and fragment rules cannot drift.

Extraction receives an already validated TipTap document, walks image nodes,
and returns deduplicated object keys. It does not perform a second independent
document validation.

### Upload module

`upload-service` orchestrates validated upload persistence behind a small
interface. It invokes image validation before any PostgreSQL or S3 write,
generates the object key from a random UUID and the detected extension, creates
the upload record, and then writes the original bytes to S3 with the detected
content type.

PostgreSQL and S3 cannot share a transaction. Creating the database record
first makes a crash or ambiguous S3 result discoverable: cleanup can later issue
an idempotent delete for the tracked key. Writing S3 first could leave an object
with no database record and therefore no cleanup path. The HTTP response is not
sent until both operations succeed.

The read path also treats PostgreSQL as authoritative. It first finds the
`Upload` record, returns `404` when none exists, then reads the S3 object and uses
`detectedContentType` for the response. S3 object metadata and the original
client header are not trusted as the response type. A tracked record whose S3
object is absent also produces the existing controlled `404` response.

### Article attachment module

Article creation and content updates use the canonical upload-key module to
obtain referenced keys. One database transaction then:

1. locks all matching `Upload` rows;
2. verifies that every deduplicated key exists;
3. writes the article change;
4. sets one transaction timestamp as `attachedAt` for matching rows where it is
   still `null`;
5. commits the article and attachment changes together.

Missing upload records are invalid article data. Create returns the existing
controlled `400` response without creating an article; update returns `400`
without changing the existing article. Previously attached uploads are valid
references and keep their original `attachedAt`. An update that changes only
the title does not perform upload lifecycle work.

The slug retry loop remains database-driven. Each create attempt performs its
upload locking, article insert, and attachment marking inside one transaction;
a slug collision rolls back that attempt before the next suffix is tried.

### Cleanup module and command

`upload-cleanup` exposes a testable interface that receives the current time and
batch size explicitly. The CLI supplies the system clock and a default batch
size of 100. The stale cutoff is computed once per run as `now - 24 hours`, and
records are eligible when:

```text
attachedAt IS NULL AND createdAt <= cutoff
```

Candidate discovery is bounded and ordered deterministically. Each candidate is
processed in its own transaction so a persistent failure does not roll back
successful cleanup of unrelated uploads. The transaction rechecks eligibility,
locks the row with `FOR UPDATE SKIP LOCKED`, deletes the S3 object, deletes the
database row, and commits. An S3 not-found result counts as success because the
desired object state already holds.

If S3 deletion fails, the transaction rolls back and leaves the database record
eligible for a later run. The command records the failure, continues with other
candidates, and exits non-zero after printing a summary. It does not repeatedly
retry a failed key within the same run. Output may include object keys and
counts, but never image bytes, article edit tokens, credentials, or signed URLs.

Concurrent command instances skip rows already locked by another worker. A
second worker that reaches a row after its deletion observes no eligible row and
does nothing.

## Data model

Phase 6 adds this Prisma model and its migration:

```prisma
model Upload {
  objectKey           String   @id
  detectedContentType String
  byteSize            Int
  createdAt           DateTime @default(now())
  attachedAt          DateTime?

  @@index([attachedAt, createdAt])
}
```

`objectKey` is the natural identifier exposed by the upload response and stored
in the TipTap URL, so a separate numeric identifier adds no leverage. The
application constrains `detectedContentType` to the four supported values;
keeping it as a string avoids a database enum whose identifiers cannot directly
express MIME values. The existing 5 MiB request limit fits safely in a database
integer.

`attachedAt` records first successful attachment, not current ownership or a
reference count. This deliberately limited meaning supports stale-upload
cleanup without implying the Article-Asset relation deferred to a later phase.

## Request and failure behavior

### Upload acceptance

The upload controller applies these outcomes in order:

1. Missing or unsupported claimed media type: `415`.
2. Empty body: `400` with the existing image-required response.
3. Encoded body larger than 5 MiB: `413`.
4. Unsupported detected format, corrupt or truncated bytes, or claimed/detected
   media-type mismatch: `415`.
5. More than 40,000,000 decoded pixels across all frames: `413` with
   `Image dimensions are too large`.
6. Database or S3 infrastructure failure: the existing safe `500` response.
7. Successful database and S3 writes: `201` with the existing `{ key, url }`
   response.

No `415` path writes an upload record or calls S3. The object-key extension,
database content type, S3 content type, and served response content type all
derive from the detected bytes. The claimed type is used only as an acceptance
check.

If database insertion fails, S3 has not been called. If S3 returns an error after
the database insert, the unattached row remains. This includes ambiguous network
failures where the object may in fact exist. Cleanup can safely reconcile either
case after the row becomes stale.

### Article attachment failures

The canonical URL grammar remains a schema-level concern. Once a document passes
that schema, a missing `Upload` record is a lifecycle validation failure and uses
the existing `400 Invalid article data` envelope. Article persistence and all
attachment updates roll back together.

Repeated image nodes for one key do not require repeated rows or writes. One
upload may be referenced by multiple articles because Phase 6 tracks only first
attachment and does not model ownership.

### Cleanup concurrency

Article attachment and cleanup use the same upload-row lock as their seam:

- If article attachment locks first, it sets `attachedAt` and commits. Cleanup
  rechecks after waiting and skips the now-ineligible row.
- If cleanup locks first, it deletes the object and row. Article attachment then
  observes the missing key and rolls its article change back with `400`.

Holding one row lock across its S3 delete is intentional. It makes the external
side effect and attachment decision mutually exclusive while bounding lock time
to one object operation. If the database commit fails after S3 deletion, the row
remains; the next cleanup run treats S3 not-found as success and deletes it.

## Command behavior

The backend package exposes a cleanup script that runs the compiled CLI entry
point. Building the backend therefore produces both the HTTP server and the
cleanup executable. The command uses the same database and S3 environment
variables as the server.

The command is safe to schedule, but Phase 6 adds no cron, systemd, container,
or hosted scheduler configuration. Operations documentation explains the manual
command, the 24-hour rule, successful summary, partial-failure exit status, and
safe rerun behavior.

## Testing strategy

### Image-validation tests

- Decode small real fixtures for JPEG, PNG, WebP, GIF, animated GIF, and animated
  WebP.
- Return the canonical detected content type, extension, and exact encoded byte
  size for each accepted fixture.
- Reject unsupported formats, random bytes, corrupted headers, truncated pixel
  data, and valid signatures with invalid payloads.
- Reject every claimed/detected mismatch across the four allowed types.
- Accept case-insensitive declared types and valid parameters while retaining
  the canonical detected type.
- Reject total decoded pixels above 40,000,000, including animated-frame totals,
  without disabling Sharp's built-in safeguards.

### Upload integration tests

- Upload and retrieve each supported format through real PostgreSQL and MinIO.
- Assert the exact `Upload` metadata, key extension, original S3 bytes, S3 content
  type, and HTTP response content type.
- Assert missing/unsupported MIME, empty/oversized bodies, invalid bytes,
  truncation, mismatch, and decoded-pixel overflow return the specified status.
- Compare database rows and bucket objects before and after each `415` case to
  prove neither persistence layer was written.
- Simulate an S3 failure after record creation and assert the unattached record
  remains available for later cleanup.
- Assert GET returns `404` for untracked keys and for tracked keys whose S3 object
  is absent.

### Article integration tests

- Create an article containing one or several uploaded images and assert one
  common `attachedAt` timestamp.
- Deduplicate repeated references to the same key.
- Attach newly introduced images on content update while leaving earlier
  `attachedAt` values unchanged.
- Allow an already attached upload to be reused.
- Perform no upload writes for a title-only update.
- Reject a missing upload key on create and update and assert complete rollback.
- Exercise slug collision retry with referenced uploads.
- Deterministically race article attachment against cleanup and verify both legal
  outcomes preserve the locking invariant.

### Cleanup tests

- Delete stale unattached objects and rows through real PostgreSQL and MinIO.
- Preserve rows newer than the cutoff and rows with `attachedAt` set.
- Treat a missing S3 object as success and remove its stale database row.
- With a controlled failing storage adapter, retain the failed row, continue
  cleaning unrelated rows, and report failure.
- Run cleanup repeatedly and concurrently to demonstrate idempotence and
  `SKIP LOCKED` behavior.
- Pin the inclusive 24-hour boundary using an injected `now`.

### Acceptance gate

The Phase 6 acceptance run executes formatting checks, lint, type checking, the
complete root test suite with real PostgreSQL and MinIO, and the production
build. Type and test tasks must report non-zero execution. The OpenAPI document,
backend README, root hardening checklist, and generated Prisma client must agree
with the implemented contract.

## Security and operational review checklist

- Client-supplied MIME is never stored or served as authoritative metadata.
- Full decoding happens before all persistence writes.
- Encoded-byte and decoded-pixel limits both remain active.
- Animated formats validate every frame.
- Object keys are generated by Paper and extensions derive from detected bytes.
- Article writes cannot commit references to absent upload records.
- Cleanup and attachment serialize on the same row lock.
- S3 not-found deletion is idempotent; other S3 failures retain the tracking row.
- Cleanup output contains no credentials or private content.
- No production scheduler or broader asset ownership behavior is introduced.

## Rejected alternatives

### Header or magic-byte validation only

Rejected because a valid signature does not prove that compressed pixel data is
complete or decodable. It would continue accepting truncated and deliberately
malformed files.

### Re-encoding accepted images

Rejected because it changes quality, animation, colour profiles, metadata, and
possibly file size. Normalisation is not required to establish the Phase 6 trust
boundary.

### Write S3 before creating the upload record

Rejected because a crash between the two writes creates an untracked object with
no database-driven cleanup path.

### Accept syntactically valid but untracked upload URLs in articles

Rejected because cleanup could delete the object while an article successfully
commits its URL. Requiring every referenced key to exist makes the cleanup race
explicit and resolvable.

### Cleanup database rows before S3 objects

Rejected because an S3 failure would leave an untracked object that later runs
cannot discover. Deleting S3 first while holding the row lock keeps retry state
in PostgreSQL.

### Add current ownership or reference counting

Rejected because Phase 6 never unmarks removed images and never deletes assets
with an article. `attachedAt` is intentionally monotonic lifecycle groundwork;
an Article-Asset relation belongs in a later standalone phase.
