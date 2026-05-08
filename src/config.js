'use strict';

// =============================================================
// Settings & Configuration
// =============================================================

const { normalizeAddress } = require('./utils/address');
const { query } = require('./db');

/**
 * Validates basic string format so we don't pass obvious junk to TonAPI.
 */
function isValidTonFormat(str) {
  if (!str) return false;
  if (str.length < 40) return false;
  return /^[a-zA-Z0-9_\-]+$/.test(str) || /^0:[a-fA-F0-9]{64}$/.test(str) || /^\-1:[a-fA-F0-9]{64}$/.test(str);
}

/**
 * Fetches all tracked wallets directly from the database.
 */
async function getTrackedWallets() {
  const res = await query('SELECT id, name, address, wallet_index FROM tracked_wallets ORDER BY wallet_index ASC');
  return res.rows.map(row => ({
    id: row.id,
    name: row.name,
    address: row.address, // Raw Hex string (normalized)
    index: row.wallet_index
  }));
}

/**
 * Builds fast memory lookup functions for the parser to use during its cycle.
 */
function buildWalletLookups(wallets) {
  const nameMap = new Map();
  const addressMap = new Set();
  
  for (const w of wallets) {
    const rawHex = normalizeAddress(w.address);
    if (rawHex) {
      addressMap.add(rawHex);
      nameMap.set(rawHex, w);
    }
  }

  return {
    isDktAddress: (addr) => {
      const normalized = normalizeAddress(addr);
      return normalized ? addressMap.has(normalized) : false;
    },
    getDktWallet: (addr) => {
      const normalized = normalizeAddress(addr);
      return normalized ? nameMap.get(normalized) || null : null;
    },
  };
}

module.exports = {
  isValidTonFormat,
  getTrackedWallets,
  buildWalletLookups,
  PARSE_INTERVAL_MIN: parseInt(process.env.PARSE_INTERVAL_MIN, 10) || 120,
  TONAPI_KEY: process.env.TONAPI_KEY
};
