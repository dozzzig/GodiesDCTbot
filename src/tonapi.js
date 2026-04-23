'use strict';

// =============================================================
// tonapi.js — TonAPI v2 client with rate-limiting and retry
// =============================================================

require('dotenv').config();
const axios = require('axios');

// Rate limit delay. With a paid TONAPI_KEY this can stay at 300ms.
// Free tier (no key): raise to 1500ms to avoid HTTP 429.
const TONAPI_REQUEST_DELAY_MS = 300;

const BASE_URL = 'https://tonapi.io/v2';
const MAX_RETRIES = 2;

const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000, // 30s — TonAPI can be slow on large wallets
  headers: process.env.TONAPI_KEY
    ? { Authorization: `Bearer ${process.env.TONAPI_KEY}` }
    : {},
});

/** Pause execution for `ms` milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes a request with automatic retry on transient errors (5xx / timeout).
 * @param {Function} fn    - Async function performing the actual request
 * @param {string}   label - Human-readable label for logging
 */
async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRetryable = !status || status >= 500 || err.code === 'ECONNABORTED';

      if (!isRetryable || attempt === MAX_RETRIES) break;

      const backoffMs = attempt * 1_000;
      console.warn(
        `[TonAPI] ${label} — attempt ${attempt} failed (${status ?? err.code}), retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }
  throw lastError;
}

/**
 * Fetches all NFT items owned by a wallet, paginating automatically.
 *
 * @param {string} address - Wallet address (UQ... or raw 0:... format)
 * @returns {Promise<Array>} TonAPI nft_items array
 */
async function getNFTsByWallet(address) {
  const allItems = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    await sleep(TONAPI_REQUEST_DELAY_MS);

    const response = await withRetry(
      () =>
        httpClient.get(`/accounts/${encodeURIComponent(address)}/nfts`, {
          params: { limit, offset, indirect_ownership: false },
        }),
      `getNFTsByWallet(${address})`
    );

    const items = response.data?.nft_items ?? [];
    allItems.push(...items);

    // Full page returned → more items may exist
    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}

/**
 * Fetches account events (NFT transfers, etc.) and filters to those
 * with a logical time (lt) greater than `lastProcessedLt`.
 *
 * TonAPI returns events newest-first, so we stop fetching as soon as
 * we hit an event we've already seen.
 *
 * @param {string} address        - Wallet address
 * @param {number} lastProcessedLt - Only return events with lt > this value
 * @returns {Promise<Array>} Array of new event objects
 */
async function getAccountEvents(address, lastProcessedLt = 0) {
  await sleep(TONAPI_REQUEST_DELAY_MS);

  const response = await withRetry(
    () =>
      httpClient.get(`/accounts/${encodeURIComponent(address)}/events`, {
        params: {
          limit: 100,
          subject_only: true, // only events where this wallet is sender/recipient
        },
      }),
    `getAccountEvents(${address})`
  );

  const events = response.data?.events ?? [];

  // Filter to events newer than what we've already processed
  return lastProcessedLt > 0
    ? events.filter((e) => Number(e.lt) > lastProcessedLt)
    : events;
}

/**
 * Given an arbitrary address format (base64, eq/uq), uses TonAPI to return the raw 0:hex format.
 * Throws if the account is invalid.
 */
async function resolveAccount(address) {
  try {
    const res = await httpClient.get(`/accounts/${encodeURIComponent(address)}`);
    return res.data.address; // returns the raw 0:hex
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 404) {
      throw new Error(`В сети TON такой адрес не найден.`);
    }
    throw err;
  }
}

/**
 * Fetches metadata for a single NFT item by its address.
 */
async function getNFTItem(nftAddress) {
  await sleep(TONAPI_REQUEST_DELAY_MS);
  try {
    const res = await withRetry(
      () => httpClient.get(`/nfts/${encodeURIComponent(nftAddress)}`),
      `getNFTItem(${nftAddress})`
    );
    return res.data;
  } catch (err) {
    return null; // Non-critical — we'll fall back to existing data
  }
}

module.exports = { getNFTsByWallet, getAccountEvents, resolveAccount, getNFTItem };
