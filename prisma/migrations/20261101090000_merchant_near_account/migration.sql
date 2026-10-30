-- The merchant's own NEAR account (e.g. amaka.rhodium.near), where NEAR
-- Intents delivers USDC for her crypto sales.
--
-- Public, like a wallet address, so stored in the clear. Unique because two
-- merchants sharing one account would make every NEAR payment ambiguous about
-- whose sale it was. Nullable: a merchant without one simply is not offered
-- the NEAR checkout.
ALTER TABLE "merchant" ADD COLUMN "near_account_id" TEXT;
CREATE UNIQUE INDEX "merchant_near_account_id_key" ON "merchant"("near_account_id");
