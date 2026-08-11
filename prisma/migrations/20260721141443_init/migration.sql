-- CreateTable
CREATE TABLE "merchant" (
    "id" TEXT NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "kyc_state" TEXT NOT NULL DEFAULT 'unverified',
    "crypto_enabled" BOOLEAN NOT NULL DEFAULT false,
    "settlement_bank_code" TEXT,
    "settlement_account_enc" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "image_url" TEXT,
    "stock_qty" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "buyer_ref" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "rail" TEXT NOT NULL DEFAULT 'fiat',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "rail_id" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "instruction_type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "name" TEXT,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_event" (
    "key" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_phone_hash_key" ON "merchant"("phone_hash");

-- CreateIndex
CREATE INDEX "product_merchant_id_idx" ON "product"("merchant_id");

-- CreateIndex
CREATE INDEX "order_merchant_id_idx" ON "order"("merchant_id");

-- CreateIndex
CREATE INDEX "order_status_idx" ON "order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_id_key" ON "payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_ref_key" ON "payment"("provider_ref");

-- CreateIndex
CREATE INDEX "payment_status_idx" ON "payment"("status");

-- CreateIndex
CREATE INDEX "ledger_entry_merchant_id_idx" ON "ledger_entry"("merchant_id");

-- CreateIndex
CREATE INDEX "buyer_merchant_id_idx" ON "buyer"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_merchant_id_phone_hash_key" ON "buyer"("merchant_id", "phone_hash");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
