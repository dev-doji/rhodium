-- AlterTable
ALTER TABLE "merchant" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "merchant_slug_key" ON "merchant"("slug");
