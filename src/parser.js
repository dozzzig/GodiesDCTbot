'use strict';

// =============================================================
// parser.js — Core logic: fetch NFTs, upsert inventory, detect transfers
// =============================================================

require('dotenv').config();
const { getTrackedWallets, buildWalletLookups } = require('./config');
const { query } = require('./db');
const { getNFTsByWallet, getAccountEvents, getNFTItem } = require('./tonapi');
const { normalizeAddress, toUserFriendly, shortAddr } = require('./utils/address');
const axios = require('axios');

// Tracks the last sync timestamp for /status command
let lastSyncAt = null;
let lastSyncErrors = [];

// GLOBAL MUTEX: This is critical. It must be outside the function.
let isParserRunning = false;

/**
 * Main entry point. Processes all wallets sequentially to respect rate limits.
 */
async function runParser() {
  if (isParserRunning) {
    console.log('[Parser] Cycle already in progress. Skipping...');
    return;
  }

  isParserRunning = true;
  console.log('[Parser] Starting sync cycle...');
  lastSyncErrors = [];

  try {
    const wallets = await getTrackedWallets();
    const lookups = buildWalletLookups(wallets);

    // STRICT SEQUENTIAL LOOP
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
  } catch (err) {
    console.error('[Parser] Fatal cycle error:', err.message);
  } finally {
    isParserRunning = false;
  }
}

/**
 * Processes a single wallet.
 */
async function processWallet(wallet, lookups) {
  const normalizedWalletAddr = normalizeAddress(wallet.address);
  console.log(`[Parser] Processing ${wallet.name} (${toUserFriendly(normalizedWalletAddr)})`);

  await syncInventory(wallet, normalizedWalletAddr);
  await syncTransfers(wallet, normalizedWalletAddr, lookups);
}

/**
 * Fetches NFTs for the wallet and upserts them into current_inventory.
 */
async function syncInventory(wallet, walletAddress) {
  const nftItems = await getNFTsByWallet(walletAddress);

  if (nftItems.length === 0) {
    await query(
      'DELETE FROM current_inventory WHERE wallet_address = $1',
      [walletAddress]
    );
    return;
  }

  const now = new Date().toISOString();
  const currentNftAddresses = nftItems.map((item) => normalizeAddress(item.address));

  for (const item of nftItems) {
    const nftAddress = normalizeAddress(item.address);
    const stickerName = item.metadata?.name ?? null;
    const collectionName = item.collection?.name ?? null;
    const collectionAddress = normalizeAddress(item.collection?.address) ?? null;

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
      [walletAddress, wallet.name, nftAddress, stickerName, collectionName, collectionAddress, now]
    );
  }

  if (currentNftAddresses.length > 0) {
    const placeholders = currentNftAddresses.map((_, i) => `$${i + 2}`).join(', ');
    await query(
      `DELETE FROM current_inventory
        WHERE wallet_address = $1
          AND nft_address NOT IN (${placeholders})`,
      [walletAddress, ...currentNftAddresses]
    );
  }
}

/**
 * Fetches account events and records transfers.
 */
async function syncTransfers(wallet, walletAddress, lookups) {
  const stateResult = await query(
    'SELECT last_event_lt FROM parser_state WHERE wallet_address = $1',
    [walletAddress]
  );
  const lastLt = stateResult.rows[0]?.last_event_lt ?? 0;

  const events = await getAccountEvents(walletAddress, Number(lastLt));
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

      const fromAddress = normalizeAddress(transfer.sender?.address);
      const toAddress = normalizeAddress(transfer.recipient?.address);
      const nftAddress = normalizeAddress(transfer.nft);

      if (!nftAddress) continue;

      const fromWallet = lookups.getDktWallet(fromAddress);
      const toWallet = lookups.getDktWallet(toAddress);

      const fromInDkt = lookups.isDktAddress(fromAddress);
      const toInDkt = lookups.isDktAddress(toAddress);

      let transferType;
      if (fromInDkt && toInDkt) transferType = 'internal';
      else if (!fromInDkt && toInDkt) transferType = 'incoming';
      else if (fromInDkt && !toInDkt) transferType = 'outgoing';
      else continue;

      const metaResult = await query(
        'SELECT sticker_name, collection_name FROM current_inventory WHERE nft_address = $1 LIMIT 1',
        [nftAddress]
      );
      let stickerName = metaResult.rows[0]?.sticker_name ?? transfer.nft_item?.metadata?.name ?? null;
      let collectionName = metaResult.rows[0]?.collection_name ?? transfer.nft_item?.collection?.name ?? null;

      if (!stickerName || !collectionName) {
        // 1. Check persistent DB cache first
        const dbMeta = await query(
          'SELECT name, collection_name FROM nft_metadata WHERE nft_address = $1 LIMIT 1',
          [nftAddress]
        );
        
        if (dbMeta.rows.length > 0) {
          stickerName = dbMeta.rows[0].name;
          collectionName = dbMeta.rows[0].collection_name;
        } else {
          // 2. Fallback to TonAPI
          const nftData = await getNFTItem(nftAddress);
          if (nftData) {
            stickerName    = stickerName    ?? nftData.metadata?.name    ?? null;
            collectionName = collectionName ?? nftData.collection?.name  ?? null;
            
            // 3. Save to persistent cache
            await query(
              `INSERT INTO nft_metadata (nft_address, name, collection_name)
               VALUES ($1, $2, $3)
               ON CONFLICT (nft_address) DO NOTHING`,
              [nftAddress, stickerName, collectionName]
            );
          }
        }
      }

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

      if (insertRes.rowCount > 0 && Number(lastLt) > 0) {
        const EMOJI = { internal: '🔄', incoming: '📈', outgoing: '📉' };
        const emoji = EMOJI[transferType] ?? '❓';

        const fromLabel = fromWallet
          ? `*${fromWallet.name}*\n📍 \`${toUserFriendly(fromAddress)}\``
          : `\`${shortAddr(fromAddress)}\` (внешний)`;

        const toLabel = toWallet
          ? `*${toWallet.name}*\n📍 \`${toUserFriendly(toAddress)}\``
          : `\`${shortAddr(toAddress)}\` (внешний)`;

        const nftName = stickerName ?? '(название неизвестно)';
        const colName = collectionName ?? '(коллекция неизвестна)';
        const nftLink = `https://getgems.io/nft/${nftAddress}`;

        let notifyText = `${emoji} *Новое движение!*\n`;
        notifyText += `━━━━━━━━━━━━━━━\n`;
        notifyText += `📦 *Стикер:* ${nftName}\n`;
        notifyText += `📁 *Коллекция:* ${colName}\n`;

        if (transferType === 'internal') {
          notifyText += `🔁 *Тип:* Внутренний перевод\n`;
        }

        notifyText += `📤 *Отправитель:* ${fromLabel}\n`;
        notifyText += `📥 *Получатель:* ${toLabel}\n`;

        await sendTelegramNotification(notifyText, nftLink);
      }
    }
  }

  await query(
    `INSERT INTO parser_state (wallet_address, last_event_lt, last_sync_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (wallet_address)
     DO UPDATE SET last_event_lt = EXCLUDED.last_event_lt, last_sync_at = EXCLUDED.last_sync_at`,
    [walletAddress, maxLt]
  );
}

/** Returns metadata about the last completed sync cycle. */
function getSyncStatus() {
  return { lastSyncAt, lastSyncErrors };
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
