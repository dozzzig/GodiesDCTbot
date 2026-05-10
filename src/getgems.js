'use strict';

// =============================================================
// getgems.js — Floor price via TonAPI collection items scan
// Getgems blocks external API access (AWS WAF + GRAPHQL_STRANGE_QUERY).
// We derive floor price from TonAPI by finding the minimum active
// sale price among items in a collection. Same exported API, no
// changes needed in parser.js.
// =============================================================

require('dotenv').config();
const axios = require('axios');
const { toUserFriendly } = require('./utils/address');

const BASE_URL = 'https://tonapi.io/v2';
const REQUEST_TIMEOUT_MS = 20_000;
// 100 items per page to prevent TonAPI 500 Internal Server Errors.
const PAGE_LIMIT = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Separate axios instance — reuses TONAPI_KEY from env if present.
const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: process.env.TONAPI_KEY
    ? { Authorization: `Bearer ${process.env.TONAPI_KEY}` }
    : {},
});

/**
 * Fetches the floor price for an NFT collection by scanning active
 * Getgems sale contracts via TonAPI collection items endpoint.
 *
 * Scans up to 2 pages (2000 items). Returns the minimum active sale
 * price found, or null if no listings exist / on any error.
 *
 * @param {string} collectionAddress - Any TON address format (0:hex or base64).
 * @returns {number|null} Floor price in TON rounded to 2 decimals, or null.
 */
async function getCollectionFloorPrice(collectionAddress) {
  if (!collectionAddress) return null;

  // TonAPI requires user-friendly base64 address
  const friendly = toUserFriendly(collectionAddress);
  if (!friendly) return null;

  let minPriceNano = null;

  try {
    // Scan up to 20 pages (2000 items) to guarantee we find the floor price
    for (let page = 0; page < 20; page++) {
      if (page > 0) await sleep(1500); // rate-limit between pages

      const response = await httpClient.get(
        `/nfts/collections/${friendly}/items`,
        { params: { limit: PAGE_LIMIT, offset: page * PAGE_LIMIT } }
      );

      const items = response.data?.nft_items ?? [];

      for (const item of items) {
        if (item.sale?.price?.token_name !== 'TON') continue;
        const priceStr = item.sale?.price?.value;
        if (!priceStr) continue;

        const priceNano = Number(priceStr);
        if (isNaN(priceNano) || priceNano <= 0) continue;

        if (minPriceNano === null || priceNano < minPriceNano) {
          minPriceNano = priceNano;
        }
      }

      // No more pages if fewer items than limit were returned
      if (items.length < PAGE_LIMIT) break;
    }
  } catch (err) {
    console.warn(`[FloorPrice] Failed for ${friendly}: ${err.message}`);
    return null;
  }

  if (minPriceNano === null) return null;

  // Convert nanoTON → TON, round to 2 decimal places (matches DECIMAL(18,2))
  const floorTon = Math.round((minPriceNano / 1e9) * 100) / 100;
  return floorTon > 0 ? floorTon : null;
}

module.exports = { getCollectionFloorPrice };
