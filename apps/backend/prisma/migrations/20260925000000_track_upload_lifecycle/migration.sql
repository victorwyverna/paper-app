CREATE TABLE "Upload" (
    "objectKey" TEXT NOT NULL,
    "detectedContentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedAt" TIMESTAMP(3),

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("objectKey")
);

CREATE INDEX "Upload_attachedAt_createdAt_idx"
ON "Upload"("attachedAt", "createdAt");
