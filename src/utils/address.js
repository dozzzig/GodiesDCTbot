'use strict';

const { Address } = require('@ton/core');

/**
 * PASS-THROUGH: No normalization as requested by user.
 */
function normalizeAddress(input) {
  return input ? input.trim() : null;
}

/**
 * PASS-THROUGH: No conversion as requested by user.
 */
function toUserFriendly(input) {
  return input ? input.trim() : null;
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
