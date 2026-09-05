-- How a merchant wants crypto sales settled.
--
--   'naira' -> OnSwitch off-ramps to her bank account; she needs no wallet
--   'usdc'  -> the EVM rail pays her own Arbitrum wallet directly
--
-- Nullable rather than defaulted, so an existing merchant is "never asked"
-- instead of silently assigned a preference she did not choose. Callers treat
-- null as the platform default.
ALTER TABLE "merchant" ADD COLUMN "crypto_settlement" TEXT;
