-- CreateTable
CREATE TABLE "ephemeral_state" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ephemeral_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ephemeral_state_expires_at_idx" ON "ephemeral_state"("expires_at");
