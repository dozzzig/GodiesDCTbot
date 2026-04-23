'use strict';

// =============================================================
// Settings & Configuration
// =============================================================

const { Address } = require('@ton/core');
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
 * Normalizes any TON address into raw 0:hex
 */
function toAddress(addressStr) {
  try {
    return Address.parse(addressStr).toRawString();
  } catch (err) {
    throw new Error(`Invalid TON address format: ${addressStr}`);
  }
}

/**
 * Fetches all tracked wallets directly from the database.
 */
async function getTrackedWallets() {
  const res = await query('SELECT id, name, address, wallet_index FROM tracked_wallets ORDER BY wallet_index ASC');
  return res.rows.map(row => ({
    id: row.id,
    name: row.name,
    address: row.address, // Friendly UQD string
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
    try {
      const rawHex = toAddress(w.address);
      addressMap.add(rawHex);
      nameMap.set(rawHex, w);
    } catch(e) {
      console.warn(`[Config] Skipped invalid wallet ${w.name}`);
    }
  }

  return {
    isDktAddress: (addr) => {
      try { return addressMap.has(toAddress(addr)); } catch { return false; }
    },
    getDktWallet: (addr) => {
      try { return nameMap.get(toAddress(addr)) || null; } catch { return null; }
    },
  };
}

module.exports = {
  toAddress,
  isValidTonFormat,
  getTrackedWallets,
  buildWalletLookups
};
