'use strict';

// =============================================================
// parser.js — Core logic: fetch NFTs, upsert inventory, detect transfers
// =============================================================

require('dotenv').config();
const { getTrackedWallets, buildWalletLookups } = require('./config');
const { query } = require('./db');
const { getNFTsByWallet, getAccountEvents, getNFTItem } = require('./tonapi');
const axios = require('axios');

// Tracks the last sync timestamp for /status command
let lastSyncAt = null;
let lastSyncErrors = [];

/**
 * Main entry point. Processes all wallets sequentially to respect rate limits.
 */
async function runParser() {
  console.log('[Parser] Starting sync cycle...');
  lastSyncErrors = [];

  const wallets = await getTrackedWallets();
  const lookups = buildWalletLookups(wallets);

  for (const wallet of wallets) {
    try {
      await processWallet(wallet, lookups);
    } catch (err) {
      const msg = `${wallet.name}: ${err.message}`;
      console.error(`[Parser] ⚠️  Error processing ${msg}`);
      lastSyncErrors.push(msg);
    }
  }

  lastSyncAt = new Date();
  console.log(`[Parser] Sync complete at ${lastSyncAt.toISOString()}. Errors: ${lastSyncErrors.length}`);
}

/**
 * Processes a single wallet:
 * 1. Fetches current NFTs from TonAPI → upserts into current_inventory
 * 2. Fetches new events from TonAPI → classifies and records transfers
 */
async function processWallet(wallet, lookups) {
  console.log(`[Parser] Processing ${wallet.name} (${wallet.address})`);

  await syncInventory(wallet);
  await syncTransfers(wallet, lookups);
}

// =============================================================
// Inventory sync
// =============================================================

/**
 * Fetches NFTs for the wallet and upserts them into current_inventory.
 * Removes rows for NFTs that are no longer owned by this wallet.
 */
async function syncInventory(wallet) {
  const nftItems = await getNFTsByWallet(wallet.address);

  if (nftItems.length === 0) {
    // Clear inventory for this wallet (all NFTs left or none exist)
    await query(
      'DELETE FROM current_inventory WHERE wallet_address = $1',
      [wallet.address]
    );
    return;
  }

  const now = new Date().toISOString();
  const currentAddresses = nftItems.map((item) => item.address);

  // Upsert each NFT
  for (const item of nftItems) {
    const stickerName = item.metadata?.name ?? null;
    const collectionName = item.collection?.name ?? null;
    const collectionAddress = item.collection?.address ?? null;

    await query(
      `INSERT INTO current_inventory
         (wallet_address, wallet_name, nft_address, sticker_name, collection_name, collection_address, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (wallet_address, nft_address)
       DO UPDATE SET
         sticker_name       = EXCLUDED.sticker_name,
         collection_name    = EXCLUDED.collection_name,
         collection_address = EXCLUDED.collection_address,
         updated_at         = EXCLUDED.updated_at`,
      [wallet.address, wallet.name, item.address, stickerName, collectionName, collectionAddress, now]
    );
  }

  // Remove NFTs no longer in this wallet
  if (currentAddresses.length > 0) {
    const placeholders = currentAddresses.map((_, i) => `$${i + 2}`).join(', ');
    await query(
      `DELETE FROM current_inventory
        WHERE wallet_address = $1
          AND nft_address NOT IN (${placeholders})`,
      [wallet.address, ...currentAddresses]
    );
  }
}

// =============================================================
// Transfer detection
// =============================================================

/**
 * Fetches account events since the last processed lt,
 * extracts NftItemTransfer actions, classifies each, and inserts into transfers_history.
 */
async function syncTransfers(wallet, lookups) {
  // Load last processed logical time for this wallet
  const stateResult = await query(
    'SELECT last_event_lt FROM parser_state WHERE wallet_address = $1',
    [wallet.address]
  );
  const lastLt = stateResult.rows[0]?.last_event_lt ?? 0;

  const events = await getAccountEvents(wallet.address, Number(lastLt));
  if (events.length === 0) return;

  let maxLt = Number(lastLt);

  for (const event of events) {
    const eventLt = Number(event.lt);
    if (eventLt > maxLt) maxLt = eventLt;

    const eventTs = new Date(event.timestamp * 1000).toISOString();

    for (const action of event.actions ?? []) {
      if (action.type !== 'NftItemTransfer' || action.status !== 'ok') continue;

      const transfer = action.NftItemTransfer;
      if (!transfer) continue;

      const fromAddress = transfer.sender?.address ?? null;
      const toAddress   = transfer.recipient?.address ?? null;
      const nftAddress  = transfer.nft;

      if (!nftAddress) continue;

      // Resolve DKT wallet names from addresses (null = external party)
      const fromWallet = fromAddress ? lookups.getDktWallet(fromAddress) : null;
      const toWallet   = toAddress   ? lookups.getDktWallet(toAddress)   : null;

      const fromInDkt = fromAddress ? lookups.isDktAddress(fromAddress) : false;
      const toInDkt   = toAddress   ? lookups.isDktAddress(toAddress)   : false;

      // Classify transfer type
      let transferType;
      if (fromInDkt && toInDkt)       transferType = 'internal';
      else if (!fromInDkt && toInDkt) transferType = 'incoming';
      else if (fromInDkt && !toInDkt) transferType = 'outgoing';
      else continue; // neither side is DKT — skip

      // Look up sticker/collection info from inventory if available
      const metaResult = await query(
        'SELECT sticker_name, collection_name FROM current_inventory WHERE nft_address = $1 LIMIT 1',
        [nftAddress]
      );
      let stickerName    = metaResult.rows[0]?.sticker_name    ?? transfer.nft_item?.metadata?.name    ?? null;
      let collectionName = metaResult.rows[0]?.collection_name ?? transfer.nft_item?.collection?.name  ?? null;

      // If still missing — fetch NFT metadata directly from TonAPI
      if (!stickerName || !collectionName) {
        const nftData = await getNFTItem(nftAddress);
        if (nftData) {
          stickerName    = stickerName    ?? nftData.metadata?.name    ?? null;
          collectionName = collectionName ?? nftData.collection?.name  ?? null;
        }
      }

      // Insert with deduplication guard (UNIQUE on nft_address + lt)
      const insertRes = await query(
        `INSERT INTO transfers_history
           (event_timestamp, from_address, from_name, to_address, to_name,
            nft_address, sticker_name, collection_name, transfer_type, lt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (nft_address, lt) DO NOTHING
         RETURNING id`,
        [
          eventTs,
          fromAddress,
          fromWallet?.name ?? null,
          toAddress,
          toWallet?.name ?? null,
          nftAddress,
          stickerName,
          collectionName,
          transferType,
          eventLt,
        ]
      );

      // Notify if this is a new event AND it's not the very first sync of this wallet (lastLt > 0 avoids spam)
      if (insertRes.rowCount > 0 && Number(lastLt) > 0) {
        const EMOJI = { internal: '🔄', incoming: '📈', outgoing: '📉' };
        const emoji   = EMOJI[transferType] ?? '❓';
        const from    = fromWallet?.name ?? shortAddr(fromAddress) ?? 'внешний';
        const to      = toWallet?.name   ?? shortAddr(toAddress)   ?? 'внешний';
        const nftName = stickerName    ?? '(название неизвестно)';
        const colName = collectionName ?? '(коллекция неизвестна)';
        const nftLink = `https://getgems.io/nft/${nftAddress}`;

        let notifyText = `${emoji} *Новое движение!*\n`;
        notifyText += `━━━━━━━━━━━━━━━\n`;

        if (transferType === 'internal') {
          notifyText += `📦 *Стикер:* ${nftName}\n`;
          notifyText += `📁 *Коллекция:* ${colName}\n`;
          notifyText += `🔁 *Маршрут:* ${from} → ${to}\n`;
        } else if (transferType === 'incoming') {
          notifyText += `📦 *Стикер:* ${nftName}\n`;
          notifyText += `📁 *Коллекция:* ${colName}\n`;
          notifyText += `📥 *Получатель:* ${to}\n`;
          notifyText += `📤 *Отправитель:* ${from}\n`;
        } else if (transferType === 'outgoing') {
          notifyText += `📦 *Стикер:* ${nftName}\n`;
          notifyText += `📁 *Коллекция:* ${colName}\n`;
          notifyText += `📤 *Отправитель:* ${from}\n`;
          notifyText += `📥 *Получатель:* ${to}\n`;
        }

        await sendTelegramNotification(notifyText, nftLink);
      }
    }
  }

  // Persist the highest lt we've seen for this wallet
  await query(
    `INSERT INTO parser_state (wallet_address, last_event_lt, last_sync_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (wallet_address)
     DO UPDATE SET last_event_lt = EXCLUDED.last_event_lt, last_sync_at = EXCLUDED.last_sync_at`,
    [wallet.address, maxLt]
  );
}

/** Returns metadata about the last completed sync cycle (used by the bot). */
function getSyncStatus() {
  return { lastSyncAt, lastSyncErrors };
}

function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr ?? '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function sendTelegramNotification(text, nftLink = null) {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };

  // Attach GetGems button if link is provided
  if (nftLink) {
    payload.reply_markup = {
      inline_keyboard: [
        [{ text: '🔗 Открыть на GetGems', url: nftLink }],
        [{ text: '🏠 Главное меню', callback_data: 'cmd_notification_menu' }]
      ]
    };
  }

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
  } catch (err) {
    console.error('[Notifier] Failed to send notification:', err.message);
  }
}

module.exports = { runParser, getSyncStatus };

// Allow running directly for testing: `node src/parser.js`
if (require.main === module) {
  runParser()
    .then(() => {
      console.log('[Parser] Done. Exiting.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Parser] Fatal error:', err);
      process.exit(1);
    });
}
