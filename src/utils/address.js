'use strict';

const { Address } = require('@ton/core');

/**
 * Normalizes any TON address format to a lowercase Raw Hex string (0:...).
 * This is our "Single Source of Truth" for database storage.
 * 
 * @param {string} input - Any TON address format (Base64, Hex, etc.)
 * @returns {string} Lowercase Raw Hex string.
 */
function normalizeAddress(input) {
  if (!input) return null;
  try {
    const addr = Address.parse(input);
    return addr.toRawString().toLowerCase();
  } catch (err) {
    // console.error(`[AddressUtils] Failed to normalize: ${input}`, err.message);
    return input.toLowerCase(); 
  }
}

/**
 * Converts any TON address to a User-friendly Base64 (Non-bounceable) string.
 * Required by TonAPI to avoid HTTP 400 errors.
 * 
 * @param {string} input - Raw Hex or any TON address.
 * @returns {string} User-friendly Base64 address.
 */
function toUserFriendly(input) {
  if (!input) return null;
  try {
    const addr = Address.parse(input);
    return addr.toString({
      bounceable: false,
      testOnly: false,
      urlSafe: true
    });
  } catch (err) {
    return input; 
  }
}

/**
 * Shortens an address for display in compact lists.
 */
function shortAddr(addr) {
  if (!addr) return '—';
  const friendly = toUserFriendly(addr);
  if (friendly.length < 12) return friendly;
  return `${friendly.slice(0, 6)}...${friendly.slice(-4)}`;
}

module.exports = {
  normalizeAddress,
  toUserFriendly,
  shortAddr
};
