-- AlterTable
ALTER TABLE "merchant" ADD COLUMN     "wa_phone_number_id" TEXT,
ADD COLUMN     "wa_business_account_id" TEXT,
ADD COLUMN     "wa_display_phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "merchant_wa_phone_number_id_key" ON "merchant"("wa_phone_number_id");
