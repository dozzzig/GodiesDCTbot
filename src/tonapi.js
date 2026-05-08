'use strict';

// =============================================================
// tonapi.js — TonAPI v2 client with rate-limiting and retry
// =============================================================

require('dotenv').config();
const axios = require('axios');

const { toUserFriendly } = require('./utils/address');

// Rate limit delay. Free tier (no key): 1 req/s.
const TONAPI_REQUEST_DELAY_MS = 1100;

const BASE_URL = 'https://tonapi.io/v2';
const MAX_RETRIES = 2;

const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000, 
  headers: process.env.TONAPI_KEY
    ? { Authorization: `Bearer ${process.env.TONAPI_KEY}` }
    : {},
});

/** Pause execution for `ms` milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes a request with automatic retry on transient errors (5xx / timeout / 429).
 */
async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRetryable = !status || status >= 500 || status === 429 || err.code === 'ECONNABORTED';

      if (!isRetryable || attempt === MAX_RETRIES) break;

      const backoffMs = attempt * 2_000;
      console.warn(`[TonAPI] ${label} — attempt ${attempt} failed (${status ?? err.code}), retrying in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastError;
}

/**
 * Fetches all NFT items owned by a wallet, paginating automatically.
 */
async function getNFTsByWallet(address) {
  const friendly = toUserFriendly(address);
  const allItems = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    await sleep(TONAPI_REQUEST_DELAY_MS);

    const response = await withRetry(
      () => httpClient.get(`/accounts/${friendly}/nfts`, {
        params: { limit, offset, indirect_ownership: false },
      }),
      `getNFTsByWallet(${friendly})`
    );

    const items = response.data?.nft_items ?? [];
    allItems.push(...items);

    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}

/**
 * Fetches account events (NFT transfers, etc.).
 */
async function getAccountEvents(address, lastProcessedLt = 0) {
  const friendly = toUserFriendly(address);
  await sleep(TONAPI_REQUEST_DELAY_MS);

  const response = await withRetry(
    () => httpClient.get(`/accounts/${friendly}/events`, {
      params: {
        limit: 100,
        subject_only: true,
      },
    }),
    `getAccountEvents(${friendly})`
  );

  const events = response.data?.events ?? [];
  return lastProcessedLt > 0
    ? events.filter((e) => Number(e.lt) > lastProcessedLt)
    : events;
}

/**
 * Resolves any TON address format to the raw 0:hex format.
 */
async function resolveAccount(address) {
  const friendly = toUserFriendly(address);
  await sleep(TONAPI_REQUEST_DELAY_MS);
  try {
    const res = await withRetry(
      () => httpClient.get(`/accounts/${friendly}`),
      `resolveAccount(${friendly})`
    );
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
  const friendly = toUserFriendly(nftAddress);
  await sleep(TONAPI_REQUEST_DELAY_MS);
  try {
    const res = await withRetry(
      () => httpClient.get(`/nfts/${friendly}`),
      `getNFTItem(${friendly})`
    );
    return res.data;
  } catch (err) {
    return null; 
  }
}

module.exports = { getNFTsByWallet, getAccountEvents, resolveAccount, getNFTItem };
