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

// Conversational Memory
const userState = {};

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

/** Escapes markdown special characters to prevent API errors. */
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
      [{ text: '👤 Выбрать кошелек', callback_data: 'cmd_select_wallet' }],
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

async function getStatsText() {
  const totalRes = await query('SELECT COUNT(*) AS total FROM current_inventory');
  const total = parseInt(totalRes.rows[0].total, 10);

  const collRes = await query(
    `SELECT collection_name, COUNT(*) AS cnt
     FROM current_inventory
     GROUP BY collection_name
     ORDER BY cnt DESC`
  );

  let text = `📊 *Общий баланс ДКТ:* ${total} стикеров\n\n`;
  text += '*По коллекциям:*\n';

  if (collRes.rows.length === 0) {
    text += '_(нет данных)_\n';
  } else {
    for (const row of collRes.rows) {
      const name = row.collection_name ?? '(без коллекции)';
      text += `• ${name} — *${row.cnt}* шт.\n`;
    }
  }

  const { lastSyncAt } = getSyncStatus();
  text += `\n⏱ _Срез: ${fmt(lastSyncAt)}_`;
  return text;
}

async function getWalletText(index) {
  const wallets = await getTrackedWallets();
  const wallet = wallets.find(w => w.index === index);
  if (!wallet) return '⚠️ Неверный номер кошелька.';

  const collRes = await query(
    `SELECT collection_name, COUNT(*) AS cnt
     FROM current_inventory
     WHERE wallet_address = $1
     GROUP BY collection_name
     ORDER BY cnt DESC`,
    [wallet.address]
  );

  const totalRes = await query(
    'SELECT COUNT(*) AS cnt FROM current_inventory WHERE wallet_address = $1',
    [wallet.address]
  );
  const total = parseInt(totalRes.rows[0].cnt, 10);

  let text = `👤 *Кошелёк #${index} — ${wallet.name}*\n`;
  text += `📍 \`${toUserFriendly(wallet.address)}\`\n`;
  text += `📦 Всего стикеров: *${total}*\n\n`;

  if (collRes.rows.length === 0) {
    text += '_(пусто)_\n';
  } else {
    for (const row of collRes.rows) {
      const name = row.collection_name ?? '(без коллекции)';
      text += `• ${name} — *${row.cnt}* шт.\n`;
    }
  }

  const { lastSyncAt } = getSyncStatus();
  text += `\n⏱ _Срез: ${fmt(lastSyncAt)}_`;
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
      text += `${emoji} \`${time}\` — ${to}: +1 _${nft}${coll}_ (пополнение от ${from})\n`;
    } else if (row.transfer_type === 'outgoing') {
      text += `${emoji} \`${time}\` — ${from}: -1 _${nft}${coll}_ (выбытие к ${to})\n`;
    }
  }
  return text;
}

async function getCollectionsText() {
  const res = await query(
    `SELECT collection_name, wallet_name, COUNT(*) AS cnt
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
    if (!collections.has(name)) collections.set(name, []);
    collections.get(name).push({ wallet: row.wallet_name, cnt: parseInt(row.cnt, 10) });
  }

  const sorted = [...collections.entries()]
    .map(([name, wallets]) => ({
      name,
      total: wallets.reduce((sum, w) => sum + w.cnt, 0),
      wallets,
    }))
    .sort((a, b) => b.total - a.total);

  const messages = [];
  let currentText = '📊 *Разбивка по коллекциям:*\n\n';
  let i = 1;

  for (const col of sorted) {
    const walletInfo = col.wallets.map((w) => `${esc(w.wallet)}(${w.cnt})`).join(', ');
    
    let line = `┌── *${esc(col.name)}*\n`;
    line += `├ 💎 Всего: *${col.total}*\n`;
    line += `└ 👥 _${walletInfo}_\n`;
    line += `━━━━━━━━━━━━━━\n\n`;

    if (currentText.length + line.length > 3900) {
      messages.push(currentText.trim());
      currentText = ''; 
    }
    currentText += line;
    i++;
  }
  
  if (currentText) messages.push(currentText.trim());
  return messages;
}

async function getWalletsListText() {
  const wallets = await getTrackedWallets();
  const res = await query(
    `SELECT wallet_address, wallet_name, COUNT(*) AS cnt
     FROM current_inventory
     GROUP BY wallet_address, wallet_name`
  );

  const countMap = new Map(res.rows.map((r) => [r.wallet_address, parseInt(r.cnt, 10)]));

  let text = '📋 *Кошельки ДКТ:*\n\n';
  for (const w of wallets) {
    const cnt = countMap.get(w.address) ?? 0;
    text += `*#${w.index}* — ${w.name}: *${cnt}* шт.\n`;
  }
  return text;
}

async function getStatusText() {
  const { lastSyncAt, lastSyncErrors } = getSyncStatus();

  const inventoryRes = await query('SELECT COUNT(*) AS cnt FROM current_inventory');
  const transfersRes = await query('SELECT COUNT(*) AS cnt FROM transfers_history');
  const total = parseInt(inventoryRes.rows[0].cnt, 10);
  const transfers = parseInt(transfersRes.rows[0].cnt, 10);

  let text = `⚙️ *Технический статус ДКТ-аналитика*\n\n`;
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

async function performRefresh() {
  await runParser(); 
  return await getStatusText();
}

// =============================================================
// Message / Callback routing
// =============================================================

bot.on('message', async (msg) => {
  if (!isAdmin(msg)) return;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

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

      // 2. Fetch normalized hex address from TonAPI (just to verify it exists)
      await bot.sendMessage(chatId, `⏳ Проверяю кошелек в TonAPI...`);
      await tonapi.resolveAccount(text);
      
      // 3. Save to database using the FRIENDLY text string
      const maxRes = await query('SELECT MAX(wallet_index) as m FROM tracked_wallets');
      const nextIndex = (parseInt(maxRes.rows[0].m, 10) || 13) + 1;

      await query(
        'INSERT INTO tracked_wallets (name, address, wallet_index) VALUES ($1, $2, $3)',
        [state.name, normalizeAddress(text), nextIndex]
      );

      delete userState[chatId]; 
      return bot.sendMessage(chatId, `✅ Кошелек *${state.name}* успешно добавлен!\n\n📍 Адрес: \`${toUserFriendly(text)}\`\nОн появится в статистике при следующем парсинге.`, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuMarkup()
      });
    } catch (err) {
      let errStr = err.message;
      if (errStr.includes('duplicate key value')) errStr = 'Кошелек с таким адресом или именем уже существует в базе.';
      
      return bot.sendMessage(chatId, `❌ *Ошибка добавления:*\n_${errStr}_\n\nПопробуй отправить корректный адрес еще раз или нажми Отмена:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cmd_main_menu' }]] }
      });
    }
  }

  // Fallback to Main Menu
  if (msg.text) {
    if (state) delete userState[chatId]; // Force clearing state on stray messages
    await bot.sendMessage(chatId, '*Жмякай на кнопки*', {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuMarkup()
    });
  }
});

bot.on('callback_query', async (query) => {
  if (!query.message) return;
  if (!isAdmin(query)) {
    return bot.answerCallbackQuery(query.id, { text: 'Доступ запрещен', show_alert: true });
  }

  const data = query.data;
  const msg = query.message;
  const chatId = msg.chat.id;
  let textOut = '';
  let markupOut = getBackMarkup();

  try {
    if (data === 'cmd_main_menu') {
      delete userState[chatId]; // Clear states if navigating home
      textOut = '*Жмякай на кнопки*';
      markupOut = getMainMenuMarkup();
    } else if (data === 'cmd_notification_menu') {
      // Sent from a notification — don't edit the notification, send a fresh menu
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await bot.sendMessage(chatId, '*Жмякай на кнопки*', {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuMarkup()
      });
      return; // Skip the editMessageText call below
    } else if (data === 'cmd_add_wallet') {
      userState[chatId] = { step: 'ADD_WALLET_NAME' };
      textOut = '➕ *Добавление нового кошелька*\n\nОтправь название кошелька (например, `Alex5`):';
      markupOut = { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cmd_main_menu' }]] };
    } else if (data === 'cmd_stats') {
      textOut = await getStatsText();
    } else if (data === 'cmd_collections') {
      const texts = await getCollectionsText();
      // First part: Edit current message
      textOut = texts[0];
      // Remaining parts: Send as new messages
      if (texts.length > 1) {
        for (let j = 1; j < texts.length; j++) {
          await bot.sendMessage(msg.chat.id, texts[j], { parse_mode: 'Markdown' });
        }
      }
    } else if (data === 'cmd_moves') {
      textOut = await getMovesText();
    } else if (data === 'cmd_wallets_list') {
      textOut = await getWalletsListText();
    } else if (data === 'cmd_select_wallet') {
      textOut = '👤 *Выбери кошелек:*';
      markupOut = await getWalletsMarkup();
    } else if (data.startsWith('cmd_wallet_')) {
      const index = parseInt(data.replace('cmd_wallet_', ''), 10);
      textOut = await getWalletText(index);
      markupOut = {
        inline_keyboard: [[{ text: '🔙 Назад к списку', callback_data: 'cmd_select_wallet' }]]
      };
    } else if (data === 'cmd_status') {
      textOut = await getStatusText();
    } else if (data === 'cmd_refresh') {
      await bot.answerCallbackQuery(query.id, { text: '⚙️ Запускаю парсинг, это займет некоторое время...' });
      textOut = await performRefresh();
    } else {
      textOut = 'Неизвестная команда';
    }

    await bot.editMessageText(textOut, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: markupOut
    }).catch((e) => {
      if (!e.message.includes('message is not modified')) {
        console.error('[Bot] Edit error:', e.message);
        console.error('[Bot] Attempted text length:', textOut.length);
        // Fallback for markdown errors
        if (e.message.includes('can\'t parse entities')) {
          bot.editMessageText('❌ Ошибка отображения данных (проблема с Markdown).', {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'cmd_main_menu' }]] }
          }).catch(() => {});
        }
      }
    });

    if (data !== 'cmd_refresh') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
    }
  } catch (err) {
    console.error(`[Bot] Error handling callback "${data}":`, err.message);
    await bot.answerCallbackQuery(query.id, { text: 'Ошибка: ' + err.message, show_alert: true }).catch(() => {});
  }
});

bot.on('polling_error', (err) => {
  console.error('[Bot] Polling error:', err.message);
});

// =============================================================
// Background sync is handled by dkt-parser (scheduler.js).
// =============================================================
let isParserRunning = false;

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

console.log(`[Bot] DKT analytics bot started (presentation mode)`);


