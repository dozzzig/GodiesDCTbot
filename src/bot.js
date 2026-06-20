'use strict';

// =============================================================
// bot.js — Personal Telegram bot for DKT analytics
// =============================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { query } = require('./db');
const { getTrackedWallets, isValidTonFormat } = require('./config');
const { runParser, getSyncStatus } = require('./parser');
const tonapi = require('./tonapi');
const { toUserFriendly, shortAddr, normalizeAddress } = require('./utils/address');

const ADMIN_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is not set');
if (!ADMIN_ID) throw new Error('ADMIN_CHAT_ID is not set');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Conversational state per chat
const userState = {};

// FIX BUG 1: Single mutex — declared once, used by the one performRefresh below.
// Original file had two declarations; the first lacked this guard entirely.
let isParserRunning = false;

function isAdmin(msg) {
  return msg.from?.id === ADMIN_ID || msg.chat?.id === ADMIN_ID;
}

function fmt(date) {
  if (!date) return 'не было';
  return new Date(date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

const TRANSFER_EMOJI = {
  internal: '🔄',
  incoming: '📈',
  outgoing: '📉',
};

/** Escapes Markdown special characters to prevent Telegram API errors. */
function esc(str) {
  if (!str) return '';
  return str.toString().replace(/[_*`\[]/g, '\\$&');
}

// =============================================================
// Keyboards
// =============================================================

function getMainMenuMarkup() {
  return {
    inline_keyboard: [
      [{ text: '📊 Общая статистика', callback_data: 'cmd_stats' }, { text: '🏆 Коллекции', callback_data: 'cmd_collections' }],
      [{ text: '🔄 Движения за 24ч', callback_data: 'cmd_moves' }, { text: '📋 Все кошельки', callback_data: 'cmd_wallets_list' }],
      [{ text: '📊 Показать таблицу', callback_data: 'cmd_table' }, { text: '👤 Выбрать кошелек', callback_data: 'cmd_select_wallet' }],
      [{ text: '⚙️ Статус парсера', callback_data: 'cmd_status' }, { text: '🔄 Обновить сейчас', callback_data: 'cmd_refresh' }],
      [{ text: '➕ Добавить кошелек', callback_data: 'cmd_add_wallet' }]
    ]
  };
}

async function getWalletsMarkup() {
  const wallets = await getTrackedWallets();
  const kb = [];
  let row = [];
  for (const w of wallets) {
    row.push({ text: w.name, callback_data: `cmd_wallet_${w.index}` });
    if (row.length === 3) {
      kb.push(row);
      row = [];
    }
  }
  if (row.length > 0) kb.push(row);
  kb.push([{ text: '🔙 Назад в меню', callback_data: 'cmd_main_menu' }]);
  return { inline_keyboard: kb };
}

function getBackMarkup() {
  return {
    inline_keyboard: [[{ text: '🔙 Назад в меню', callback_data: 'cmd_main_menu' }]]
  };
}

// =============================================================
// Data Fetchers
// =============================================================

/**
 * Compact stats overview: header block + top-10 collections.
 * Avoids sending a wall of text by capping the list and pointing to 🏆 for full data.
 */
async function getStatsText() {
  const totalsRes = await query(`
    SELECT
      (SELECT COUNT(*) FROM current_inventory)                        AS total,
      (SELECT COUNT(DISTINCT collection_name) FROM current_inventory) AS total_colls,
      (SELECT SUM(sub.coll_sum) FROM (
         SELECT MAX(floor_price) * COUNT(*) AS coll_sum
         FROM current_inventory GROUP BY collection_name
       ) sub)                                                         AS total_value
  `);

  const total      = parseInt(totalsRes.rows[0].total, 10);
  const totalColls = parseInt(totalsRes.rows[0].total_colls, 10);
  const totalValue = parseFloat(parseFloat(totalsRes.rows[0].total_value || 0).toFixed(2));

  // Top-10 collections only — keeps the message short and readable
  const collRes = await query(`
    SELECT
      collection_name,
      COUNT(*)         AS cnt,
      MAX(floor_price) AS floor_price,
      MAX(floor_price) * COUNT(*) AS coll_total_sum
    FROM current_inventory
    GROUP BY collection_name
    ORDER BY cnt DESC
    LIMIT 10
  `);

  // Monospace table — same fixed-width style as the 📊 table command
  const NAME_W = 20;
  const CNT_W  = 5;
  const SEP    = '─'.repeat(NAME_W + CNT_W + 4);
  const pad    = (s, w) => String(s).slice(0, w).padEnd(w);
  const rpad   = (s, w) => String(s).slice(0, w).padStart(w);

  let tbl = `📊 Статистика DKT\n`;
  tbl += `${SEP}\n`;
  tbl += `${pad('Стикеров всего', NAME_W)} │ ${rpad(total, CNT_W)}\n`;
  tbl += `${pad('Коллекций', NAME_W)} │ ${rpad(totalColls, CNT_W)}\n`;
  if (totalValue > 0) {
    tbl += `${pad('Стоимость (TON)', NAME_W)} │ ${rpad(totalValue, CNT_W)}\n`;
  }
  tbl += `${SEP}\n`;
  tbl += `${pad('Коллекция', NAME_W)} │ ${rpad('Шт', CNT_W)}\n`;
  tbl += `${SEP}\n`;

  for (const row of collRes.rows) {
    tbl += `${pad(row.collection_name ?? '(без назв.)', NAME_W)} │ ${rpad(row.cnt, CNT_W)}\n`;
  }

  if (totalColls > 10) {
    tbl += `...ещё ${totalColls - 10}\n`;
  }

  const { lastSyncAt } = getSyncStatus();
  return `\`\`\`\n${tbl}\`\`\`\n⏱ _Срез: ${fmt(lastSyncAt)}_`;
}

/**
 * FIX BUG 2+3: Normalize wallet address before SQL queries.
 * tracked_wallets stores Base64; current_inventory stores hex.
 * Without normalization WHERE clause never matches → empty results.
 */
async function getWalletText(index) {
  const wallets = await getTrackedWallets();
  const wallet = wallets.find(w => w.index === index);
  if (!wallet) return '⚠️ Неверный номер кошелька.';

  // Always query inventory with the normalized hex address
  const walletAddr = normalizeAddress(wallet.address) ?? wallet.address;

  const dataRes = await query(`
    SELECT
      COUNT(ci.nft_address)          AS total_cnt,
      SUM(COALESCE(gp.global_floor, 0)) AS total_sum
    FROM current_inventory ci
    LEFT JOIN (
      SELECT collection_name, MAX(floor_price) AS global_floor
      FROM current_inventory
      WHERE collection_name IS NOT NULL
      GROUP BY collection_name
    ) gp ON ci.collection_name = gp.collection_name
    WHERE ci.wallet_address = $1
  `, [walletAddr]);

  const total      = parseInt(dataRes.rows[0].total_cnt, 10);
  const totalValue = parseFloat(parseFloat(dataRes.rows[0].total_sum || 0).toFixed(2));

  const collRes = await query(`
    SELECT
      ci.collection_name,
      COUNT(ci.nft_address)                                        AS cnt,
      MAX(gp.global_floor)                                         AS floor_price,
      COALESCE(MAX(gp.global_floor), 0) * COUNT(ci.nft_address)   AS coll_total_sum
    FROM current_inventory ci
    LEFT JOIN (
      SELECT collection_name, MAX(floor_price) AS global_floor
      FROM current_inventory
      WHERE collection_name IS NOT NULL
      GROUP BY collection_name
    ) gp ON ci.collection_name = gp.collection_name
    WHERE ci.wallet_address = $1
    GROUP BY ci.collection_name
    ORDER BY cnt DESC
  `, [walletAddr]);

  // Monospace table — same fixed-width style as the 📊 table command
  const NAME_W = 20;
  const CNT_W  = 5;
  const SEP    = '─'.repeat(NAME_W + CNT_W + 4);
  const pad    = (s, w) => String(s).slice(0, w).padEnd(w);
  const rpad   = (s, w) => String(s).slice(0, w).padStart(w);

  let tbl = `👤 #${index} — ${wallet.name}\n`;
  tbl += `${SEP}\n`;
  tbl += `${pad('Коллекция', NAME_W)} │ ${rpad('Шт', CNT_W)}\n`;
  tbl += `${SEP}\n`;

  if (collRes.rows.length === 0) {
    tbl += `(пусто)\n`;
  } else {
    for (const row of collRes.rows) {
      tbl += `${pad(row.collection_name ?? '(без назв.)', NAME_W)} │ ${rpad(row.cnt, CNT_W)}\n`;
    }
  }

  tbl += `${SEP}\n`;
  tbl += `${pad('ИТОГО', NAME_W)} │ ${rpad(total, CNT_W)}\n`;

  const { lastSyncAt } = getSyncStatus();
  let text = `\`\`\`\n${tbl}\`\`\`\n`;
  if (totalValue > 0) text += `💎 *${totalValue} TON*\n`;
  text += `⏱ _Срез: ${fmt(lastSyncAt)}_`;
  return text;
}

async function getMovesText() {
  const res = await query(
    `SELECT event_timestamp, from_name, from_address, to_name, to_address,
            sticker_name, collection_name, transfer_type
     FROM transfers_history
     WHERE event_timestamp >= NOW() - INTERVAL '24 hours'
     ORDER BY event_timestamp DESC
     LIMIT 50`
  );

  if (res.rows.length === 0) {
    return '📊 За последние 24 ч движений не зафиксировано.';
  }

  let text = `🔄 *Движение за 24 ч (${res.rows.length} событий):*\n\n`;

  for (const row of res.rows) {
    const emoji = TRANSFER_EMOJI[row.transfer_type] ?? '❓';
    const time  = fmt(row.event_timestamp);
    const from  = row.from_name ?? shortAddr(row.from_address) ?? 'внешний';
    const to    = row.to_name   ?? shortAddr(row.to_address)   ?? 'внешний';
    const nft   = row.sticker_name ?? '(без имени)';
    const coll  = row.collection_name ? ` [${row.collection_name}]` : '';

    if (row.transfer_type === 'internal') {
      text += `${emoji} \`${time}\` — ${from} → ${to}: _${nft}${coll}_\n`;
    } else if (row.transfer_type === 'incoming') {
      text += `${emoji} \`${time}\` — ${to}: +1 _${nft}${coll}_ (от ${from})\n`;
    } else if (row.transfer_type === 'outgoing') {
      text += `${emoji} \`${time}\` — ${from}: -1 _${nft}${coll}_ (к ${to})\n`;
    }
  }
  return text;
}

async function getCollectionsText() {
  const sumRes = await query(`
    SELECT SUM(coll_sum) AS total_sum
    FROM (
      SELECT MAX(floor_price) * COUNT(*) AS coll_sum
      FROM current_inventory
      GROUP BY collection_name
    ) sub
  `);
  const totalValueStr = parseFloat(parseFloat(sumRes.rows[0].total_sum || 0).toFixed(2));

  const res = await query(
    `SELECT collection_name, wallet_name, COUNT(*) AS cnt, MAX(floor_price) AS floor_price
     FROM current_inventory
     GROUP BY collection_name, wallet_name
     ORDER BY collection_name, cnt DESC`
  );

  if (res.rows.length === 0) {
    return ['_(нет данных)_'];
  }

  const collections = new Map();
  for (const row of res.rows) {
    const name = row.collection_name ?? '(без коллекции)';
    if (!collections.has(name)) collections.set(name, { wallets: [], floor_price: null });
    const entry = collections.get(name);
    entry.wallets.push({ wallet: row.wallet_name, cnt: parseInt(row.cnt, 10) });
    // Keep the first non-null floor_price found for this collection
    if (!entry.floor_price && row.floor_price) entry.floor_price = row.floor_price;
  }

  const sorted = [...collections.entries()]
    .map(([name, data]) => ({
      name,
      total: data.wallets.reduce((sum, w) => sum + w.cnt, 0),
      wallets: data.wallets,
      floor_price: data.floor_price,
    }))
    .sort((a, b) => b.total - a.total);

  // Monospace table — same fixed-width style as the 📊 table command
  const NAME_W = 20;
  const CNT_W  = 5;
  const SEP    = '─'.repeat(NAME_W + CNT_W + 4);
  const pad    = (s, w) => String(s).slice(0, w).padEnd(w);
  const rpad   = (s, w) => String(s).slice(0, w).padStart(w);

  const firstHeader = `🏆 Коллекции${totalValueStr > 0 ? `  💎 ${totalValueStr} TON` : ''}\n${SEP}\n${pad('Коллекция', NAME_W)} │ ${rpad('Шт', CNT_W)}\n${SEP}\n`;

  const messages = [];
  let currentBlock = firstHeader;

  for (const col of sorted) {
    const walletInfo = col.wallets.map((w) => `${w.wallet}:${w.cnt}`).join('  ');
    const line = `${pad(col.name, NAME_W)} │ ${rpad(col.total, CNT_W)}\n  ${walletInfo}\n`;

    if (currentBlock.length + line.length > 3000) {
      messages.push(`\`\`\`\n${currentBlock}\`\`\``);
      currentBlock = '';
    }
    currentBlock += line;
  }

  if (currentBlock) messages.push(`\`\`\`\n${currentBlock}\`\`\``);
  return messages;
}

/**
 * FIX BUG 2: getWalletsListText — was using a SQL JOIN between tracked_wallets
 * (Base64 addresses) and current_inventory (hex addresses), which always returned
 * 0 stickers. Now fetches per-wallet counts individually using normalized addresses.
 */
async function getWalletsListText() {
  const wallets = await getTrackedWallets();

  // Run per-wallet queries with normalized hex addresses
  const rows = await Promise.all(wallets.map(async (w) => {
    const addr = normalizeAddress(w.address) ?? w.address;
    const res = await query(`
      SELECT
        COUNT(ci.nft_address)             AS cnt,
        SUM(COALESCE(gp.global_floor, 0)) AS total_value
      FROM current_inventory ci
      LEFT JOIN (
        SELECT collection_name, MAX(floor_price) AS global_floor
        FROM current_inventory
        WHERE collection_name IS NOT NULL
        GROUP BY collection_name
      ) gp ON ci.collection_name = gp.collection_name
      WHERE ci.wallet_address = $1
    `, [addr]);

    return {
      index: w.index,
      name: w.name,
      cnt: parseInt(res.rows[0]?.cnt ?? 0, 10),
      total_value: parseFloat(res.rows[0]?.total_value ?? 0),
    };
  }));

  rows.sort((a, b) => a.index - b.index);

  let text = '📋 *Кошельки:*\n\n';
  for (const row of rows) {
    const floorVal = parseFloat(row.total_value.toFixed(2));
    const floorStr = floorVal > 0 ? ` — *${floorVal}* 💎` : '';
    text += `*#${row.index}* ${row.name}: *${row.cnt}* шт.${floorStr}\n`;
  }
  return text;
}

/**
 * NEW: Builds a compact monospace summary table of sticker counts by collection.
 * Uses a fixed-width code block for alignment — readable even on mobile.
 */
async function getTableText() {
  const wallets = await getTrackedWallets();

  const collRes = await query(`
    SELECT
      collection_name,
      COUNT(*)         AS total,
      MAX(floor_price) AS floor_price
    FROM current_inventory
    GROUP BY collection_name
    ORDER BY total DESC
  `);

  if (collRes.rows.length === 0) {
    return '_(нет данных в инвентаре)_';
  }

  // Per-wallet totals (for the summary line below the table)
  const walletTotals = await Promise.all(wallets.map(async (w) => {
    const addr = normalizeAddress(w.address) ?? w.address;
    const res = await query(
      'SELECT COUNT(*) AS cnt FROM current_inventory WHERE wallet_address = $1',
      [addr]
    );
    return { name: w.name, cnt: parseInt(res.rows[0]?.cnt ?? 0, 10) };
  }));

  const grandTotal = collRes.rows.reduce((s, r) => s + parseInt(r.total, 10), 0);
  const totalValue = collRes.rows.reduce((s, r) => {
    return s + (r.floor_price ? parseFloat(r.floor_price) * parseInt(r.total, 10) : 0);
  }, 0);

  const { lastSyncAt } = getSyncStatus();

  // Fixed column widths for monospace alignment
  const NAME_W = 22;
  const CNT_W  = 5;
  const SEP    = '─'.repeat(NAME_W + CNT_W + 4);

  const pad  = (s, w) => String(s).slice(0, w).padEnd(w);
  const rpad = (s, w) => String(s).slice(0, w).padStart(w);

  let table = '';
  table += `${pad('Коллекция', NAME_W)} │ ${rpad('Шт', CNT_W)}\n`;
  table += `${SEP}\n`;

  for (const row of collRes.rows) {
    const name = pad(row.collection_name ?? '(без коллекции)', NAME_W);
    const cnt  = rpad(row.total, CNT_W);
    table += `${name} │ ${cnt}\n`;
  }

  table += `${SEP}\n`;
  table += `${pad('ИТОГО', NAME_W)} │ ${rpad(grandTotal, CNT_W)}\n`;

  const walletLine = walletTotals
    .filter(w => w.cnt > 0)
    .map(w => `${w.name}: ${w.cnt}`)
    .join('  |  ');

  // Wrap table in code block for monospace rendering
  let text = `\`\`\`\n${table}\`\`\`\n`;
  if (totalValue > 0) {
    text += `💎 Стоимость: *${parseFloat(totalValue.toFixed(2))} TON*\n`;
  }
  if (walletLine) {
    text += `\n👤 *По кошелькам:*\n\`${walletLine}\`\n`;
  }
  text += `\n⏱ _Срез: ${fmt(lastSyncAt)}_`;
  return text;
}

async function getStatusText() {
  const { lastSyncAt, lastSyncErrors } = getSyncStatus();

  const inventoryRes = await query('SELECT COUNT(*) AS cnt FROM current_inventory');
  const transfersRes = await query('SELECT COUNT(*) AS cnt FROM transfers_history');
  const total     = parseInt(inventoryRes.rows[0].cnt, 10);
  const transfers = parseInt(transfersRes.rows[0].cnt, 10);

  let text = `⚙️ *Технический статус*\n\n`;
  text += `🕐 Последний срез: _${fmt(lastSyncAt)}_\n`;
  text += `📦 Записей в инвентаре: *${total}*\n`;
  text += `📜 Записей в истории: *${transfers}*\n`;

  if (lastSyncErrors.length > 0) {
    text += `\n⚠️ *Ошибки последнего цикла (${lastSyncErrors.length}):*\n`;
    text += lastSyncErrors.map((e) => `• ${e}`).join('\n');
  } else {
    text += `\n✅ Ошибок нет`;
  }
  return text;
}

/**
 * FIX BUG 1: Single authoritative performRefresh with mutex guard.
 * The original bot.js had two function declarations with the same name;
 * the first (line 354) lacked the isParserRunning guard entirely.
 */
async function performRefresh() {
  if (isParserRunning) return '⚠️ Обновление уже запущено. Подождите...';
  isParserRunning = true;
  try {
    await runParser();
    return await getStatusText();
  } catch (err) {
    return `❌ Ошибка: ${err.message}`;
  } finally {
    isParserRunning = false;
  }
}

// =============================================================
// Message / Callback routing
// =============================================================

bot.on('message', async (msg) => {
  if (!isAdmin(msg)) return;
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();

  // Routing for active conversational flows
  const state = userState[chatId];
  if (state?.step === 'ADD_WALLET_NAME') {
    state.name = text;
    state.step = 'ADD_WALLET_ADDR';
    return bot.sendMessage(chatId, `🏷 Название принято: *${text}*\n\nТеперь отправь адрес кошелька:`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cmd_main_menu' }]] }
    });
  }

  if (state?.step === 'ADD_WALLET_ADDR') {
    try {
      // 1. Validate string format
      if (!isValidTonFormat(text)) {
        throw new Error('Указан заведомо неверный формат строки адреса.');
      }

      // 2. Normalize and check for existing wallet
      const normalized = normalizeAddress(text);
      if (!normalized) throw new Error('Не удалось разобрать адрес TON.');

      const checkRes = await query(
        'SELECT name FROM tracked_wallets WHERE address = $1 OR address = $2',
        [text, normalized]
      );

      if (checkRes.rows.length > 0) {
        throw new Error(`Этот кошелек уже отслеживается под именем "${checkRes.rows[0].name}".`);
      }

      // 3. Verify address exists in TonAPI
      await bot.sendMessage(chatId, `⏳ Проверяю кошелек в TonAPI...`);
      await tonapi.resolveAccount(text);

      // 4. Save to database (store normalized hex address for consistency)
      const maxRes   = await query('SELECT MAX(wallet_index) as m FROM tracked_wallets');
      const nextIndex = (parseInt(maxRes.rows[0].m, 10) || 13) + 1;

      await query(
        'INSERT INTO tracked_wallets (name, address, wallet_index) VALUES ($1, $2, $3)',
        [state.name, normalized, nextIndex]
      );

      delete userState[chatId];
      return bot.sendMessage(
        chatId,
        `✅ Кошелек *${state.name}* успешно добавлен!\n\n📍 Адрес: \`${toUserFriendly(text)}\`\nОн появится в статистике при следующем парсинге.`,
        { parse_mode: 'Markdown', reply_markup: getMainMenuMarkup() }
      );
    } catch (err) {
      let errStr = err.message;
      if (errStr.includes('duplicate key value')) errStr = 'Кошелек с таким адресом или именем уже существует в базе.';

      return bot.sendMessage(
        chatId,
        `❌ *Ошибка добавления:*\n_${errStr}_\n\nПопробуй отправить корректный адрес ещё раз или нажми Отмена:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cmd_main_menu' }]] }
        }
      );
    }
  }

  // Fallback — show main menu on any plain text
  if (msg.text) {
    if (state) delete userState[chatId];
    await bot.sendMessage(chatId, '*НАВИГАЦИЯ*', {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuMarkup()
    });
  }
});

bot.on('callback_query', async (cbQuery) => {
  if (!cbQuery.message) return;
  if (!isAdmin(cbQuery)) {
    return bot.answerCallbackQuery(cbQuery.id, { text: 'Доступ запрещен', show_alert: true });
  }

  const data   = cbQuery.data;
  const msg    = cbQuery.message;
  const chatId = msg.chat.id;
  let textOut   = '';
  let markupOut = getBackMarkup();

  try {
    if (data === 'cmd_main_menu') {
      delete userState[chatId];
      textOut   = '*НАВИГАЦИЯ*';
      markupOut = getMainMenuMarkup();

    } else if (data === 'cmd_notification_menu') {
      // Sent from a transfer notification — send a fresh menu instead of editing
      await bot.answerCallbackQuery(cbQuery.id).catch(() => {});
      await bot.sendMessage(chatId, '*НАВИГАЦИЯ*', {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuMarkup()
      });
      return;

    } else if (data === 'cmd_add_wallet') {
      userState[chatId] = { step: 'ADD_WALLET_NAME' };
      textOut   = '➕ *Добавление нового кошелька*\n\nОтправь название кошелька (например, `Alex5`):';
      markupOut = { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cmd_main_menu' }]] };

    } else if (data === 'cmd_stats') {
      textOut = await getStatsText();

    } else if (data === 'cmd_collections') {
      const texts = await getCollectionsText();
      textOut = texts[0];
      // Send additional pages as new messages
      if (texts.length > 1) {
        for (let j = 1; j < texts.length; j++) {
          const isLast = j === texts.length - 1;
          await bot.sendMessage(msg.chat.id, texts[j], {
            parse_mode: 'Markdown',
            reply_markup: isLast ? getBackMarkup() : undefined,
          });
        }
        markupOut = undefined; // first message needs no back button if more follow
      }

    } else if (data === 'cmd_moves') {
      textOut = await getMovesText();

    } else if (data === 'cmd_wallets_list') {
      textOut = await getWalletsListText();

    } else if (data === 'cmd_select_wallet') {
      textOut   = '👤 *Выбери кошелек:*';
      markupOut = await getWalletsMarkup();

    } else if (data.startsWith('cmd_wallet_')) {
      const index = parseInt(data.replace('cmd_wallet_', ''), 10);
      textOut   = await getWalletText(index);
      markupOut = {
        inline_keyboard: [[{ text: '🔙 Назад к списку', callback_data: 'cmd_select_wallet' }]]
      };

    } else if (data === 'cmd_table') {
      textOut = await getTableText();

    } else if (data === 'cmd_status') {
      textOut = await getStatusText();

    } else if (data === 'cmd_refresh') {
      await bot.answerCallbackQuery(cbQuery.id, { text: '⚙️ Запускаю парсинг, это займёт некоторое время...' });
      textOut = await performRefresh();

    } else {
      textOut = 'Неизвестная команда';
    }

    await bot.editMessageText(textOut, {
      chat_id:    msg.chat.id,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: markupOut
    }).catch((e) => {
      if (e.message.includes('message is not modified')) return;
      console.error('[Bot] Edit error:', e.message, '| text length:', textOut.length);
      // Graceful fallback for Markdown parse errors
      if (e.message.includes("can't parse entities")) {
        bot.editMessageText('❌ Ошибка отображения данных (проблема с Markdown).', {
          chat_id:    msg.chat.id,
          message_id: msg.message_id,
          reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'cmd_main_menu' }]] }
        }).catch(() => {});
      }
    });

    if (data !== 'cmd_refresh') {
      await bot.answerCallbackQuery(cbQuery.id).catch(() => {});
    }
  } catch (err) {
    console.error(`[Bot] Error handling callback "${data}":`, err.message);
    await bot.answerCallbackQuery(cbQuery.id, { text: 'Ошибка: ' + err.message, show_alert: true }).catch(() => {});
  }
});

bot.on('polling_error', (err) => {
  console.error('[Bot] Polling error:', err.message);
});

console.log('[Bot] DKT analytics bot started');
