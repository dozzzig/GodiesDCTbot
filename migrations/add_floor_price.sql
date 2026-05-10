-- Safe migration: adds floor_price column without dropping or altering existing data.
-- Can be run multiple times safely (IF NOT EXISTS).

ALTER TABLE current_inventory
ADD COLUMN IF NOT EXISTS floor_price DECIMAL(18, 2) DEFAULT NULL;

COMMENT ON COLUMN current_inventory.floor_price IS 'Collection floor price in TON, fetched from Getgems';
