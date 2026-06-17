const { Address } = require('@ton/core');

/**
 * Normalizes any TON address format to a lowercase Raw Hex string (0:...).
 * Returns null if the input cannot be parsed as a valid TON address,
 * preventing invalid strings from being stored in the database.
 */
function normalizeAddress(input) {
  if (!input) return null;
  try {
    const addr = Address.parse(input.trim());
    return addr.toRawString().toLowerCase();
  } catch {
    // Return null instead of the raw string — callers must handle null explicitly
    return null;
  }
}

/**
 * Converts any TON address to a User-friendly Base64 (Non-bounceable) string.
 */
function toUserFriendly(input) {
  if (!input) return null;
  if (input.startsWith('U') || input.startsWith('E')) return input.trim();

  try {
    const addr = Address.parse(input.trim());
    return addr.toString({
      bounceable: false,
      testOnly: false,
      urlSafe: true
    });
  } catch {
    return input.trim();
  }
}

/**
 * Shortens an address for display in compact lists.
 */
function shortAddr(addr) {
  if (!addr) return '—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

module.exports = {
  normalizeAddress,
  toUserFriendly,
  shortAddr
};
