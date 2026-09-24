BEGIN;

ALTER TABLE "Article" ADD COLUMN "editTokenHash" TEXT;

UPDATE "Article"
SET "editTokenHash" = encode(
    sha256(
        convert_to(
            gen_random_uuid()::text || gen_random_uuid()::text,
            'UTF8'
        )
    ),
    'hex'
);

ALTER TABLE "Article" ALTER COLUMN "editTokenHash" SET NOT NULL;

DROP INDEX "Article_editToken_key";
ALTER TABLE "Article" DROP COLUMN "editToken";

CREATE UNIQUE INDEX "Article_editTokenHash_key"
ON "Article"("editTokenHash");

COMMIT;
