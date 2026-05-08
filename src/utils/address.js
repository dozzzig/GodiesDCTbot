const { Address } = require('@ton/core');

/**
 * Normalizes any TON address format to a lowercase Raw Hex string (0:...).
 */
function normalizeAddress(input) {
  if (!input) return null;
  try {
    const addr = Address.parse(input.trim());
    return addr.toRawString().toLowerCase();
  } catch (err) {
    return input.trim().toLowerCase(); 
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
  } catch (err) {
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
