-- DropIndex
DROP INDEX "payment_provider_ref_key";

-- AlterTable
ALTER TABLE "merchant" ADD COLUMN     "processor_subaccount_code" TEXT;

-- CreateIndex
CREATE INDEX "payment_provider_ref_idx" ON "payment"("provider_ref");
