-- =============================================================
-- Migration: Tracked Wallets & Dynamic Config
-- =============================================================

CREATE TABLE IF NOT EXISTS tracked_wallets (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  address TEXT UNIQUE NOT NULL,
  wallet_index INT UNIQUE NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Важно: мы переводим адреса в сырой hex формат, так как 
-- TonAPI и наш код нормализуют все адреса к такому виду.
INSERT INTO tracked_wallets (name, address, wallet_index) VALUES
('Alex1',  '0:ea726011d2f68ad621c4abfd54b8ba1798f2f06799d476333f193457f3b61d9e', 1),
('Alex2',  '0:3348b550d48ecf6d79fbfbc5dad0816e388d6cc5ef1ce8108d757d05c22463ab', 2),
('Alex3',  '0:cf31157f8a9905d325d2cae81899ee6965012b7bdf813a0c442d4a2760023a9d', 3),
('Alex4',  '0:d0df4c79d277f7687cfb3a58f6c710557bfdbfffeb80d7caa4843ecc532820d5', 4),
('Den1',   '0:921bc10f9230d332d34f72fdc53197e4993d55985abf9c7181b1faa017ddf6c4', 5),
('Den2',   '0:202054f77b583e54c35f9eaf1fabaa28f31f0de28e068a09a478695c07d299e7', 6),
('Den3',   '0:f2e0470bdd9b8cc9c809af1676baced39479381903fffd7f3a19d4f0c1e35df0', 7),
('ONE',    '0:15a3dfd8ed67a21dfe10eeb70a7eb55c6bede0348ff7efadaeada895f84c115d', 8),
('Doz',    '0:21168d53d2c1555ea2b4a6e3d2f972873ac75b97d2ac83d89d5ea46c8a39aed6', 9),
('Disco',  '0:5fc92f8e8b0e6f9a6753a12059f4fdaa1f91aaed98700b84603dc1311e44ebf3', 10),
('Mih',    '0:253d550aacff309ac79fe65bd990230114e6c34ac47946f49f025b1d5274fdaf', 11),
('Vnutri', '0:ffcc2eb393fef1550a51134fe88ec6ff4054366b8797a96f5eaa474b7a1a7d21', 12),
('Zuk',    '0:75eb0cb93fc6bfba37cce7c22946f611e2badd054077c0b6028a0617453064db', 13)
ON CONFLICT (name) DO NOTHING;
