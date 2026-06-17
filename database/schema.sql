-- =============================================================
-- GodiesDCTbot — Database Schema
-- Apply via Neon Console SQL Editor
-- =============================================================

-- Current snapshot of NFT balances across DKT wallets
CREATE TABLE IF NOT EXISTS current_inventory (
  wallet_address  TEXT        NOT NULL,
  wallet_name     TEXT        NOT NULL,
  nft_address     TEXT        NOT NULL,
  sticker_name    TEXT,
  collection_name TEXT,
  collection_address TEXT,
  floor_price     DECIMAL(18, 2) DEFAULT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (wallet_address, nft_address)
);

CREATE INDEX IF NOT EXISTS idx_inventory_wallet
  ON current_inventory (wallet_address);

CREATE INDEX IF NOT EXISTS idx_inventory_collection
  ON current_inventory (collection_name);


-- Full log of detected NFT movements
CREATE TABLE IF NOT EXISTS transfers_history (
  id                BIGSERIAL   PRIMARY KEY,
  event_timestamp   TIMESTAMPTZ NOT NULL,
  from_address      TEXT,
  from_name         TEXT,         -- NULL if external sender
  to_address        TEXT,
  to_name           TEXT,         -- NULL if external recipient
  nft_address       TEXT        NOT NULL,
  sticker_name      TEXT,
  collection_name   TEXT,
  -- 'internal' | 'incoming' | 'outgoing'
  transfer_type     TEXT        NOT NULL,
  lt                BIGINT,       -- TON logical time for deduplication
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate events from being re-inserted on each parser run
  UNIQUE (nft_address, lt)
);

CREATE INDEX IF NOT EXISTS idx_transfers_timestamp
  ON transfers_history (event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_transfers_type
  ON transfers_history (transfer_type);

CREATE INDEX IF NOT EXISTS idx_transfers_nft
  ON transfers_history (nft_address);


-- Tracks the last processed logical time per wallet.
-- Prevents re-fetching already-processed events on each parser run.
CREATE TABLE IF NOT EXISTS parser_state (
  wallet_address  TEXT        PRIMARY KEY,
  last_event_lt   BIGINT      NOT NULL DEFAULT 0,
  last_sync_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Persistent metadata cache for NFTs that have left tracked wallets.
-- Used by the transfer detector to resolve sticker/collection names
-- for NFTs no longer present in current_inventory.
-- FIX BUG 4: This table was referenced in parser.js but missing from schema.
CREATE TABLE IF NOT EXISTS nft_metadata (
  nft_address     TEXT PRIMARY KEY,
  name            TEXT,
  collection_name TEXT,
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

