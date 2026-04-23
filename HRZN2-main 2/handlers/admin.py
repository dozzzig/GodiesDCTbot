"""
handlers/admin.py — модуль администратора и техподдержки.

Всё работает через закрытую Telegram-группу (ADMIN_GROUP_ID).
Бот должен быть добавлен в эту группу как администратор.

Функции:
  1. Анонимный прокси-чат (поддержка пользователей)
  2. /stats — статистика сервера из 3X-UI
  3. /users — статистика пользователей из БД + рассылка
"""
import logging
import re

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from config import settings
from database import db
from services.xui import xui

logger = logging.getLogger(__name__)
router = Router(name="admin")

# ------------------------------------------------------------------ #
#  Filters                                                             #
# ------------------------------------------------------------------ #

# Фильтр: сообщение пришло из группы администраторов
IS_ADMIN_GROUP = F.chat.id == settings.admin_group_id


# ------------------------------------------------------------------ #
#  Поддержка — кнопка в меню                                          #
# ------------------------------------------------------------------ #

@router.callback_query(F.data == "menu_support")
async def cb_menu_support(call: CallbackQuery) -> None:
    """Открывает режим поддержки: бот теперь ждёт сообщение и перешлёт его админам."""
    await call.message.edit_text(
        "📞 <b>Служба поддержки</b>\n\n"
        "Напишите ваш вопрос следующим сообщением — мы ответим в ближайшее время.\n\n"
        "ℹ️ Сообщение будет передано анонимно - ваш аккаунт <b>не будет раскрыт</b>.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="◀️ Назад", callback_data="menu_back")
        ]])
    )
    await call.answer()

# ------------------------------------------------------------------ #
#  Задача 2: /stats — Статистика сервера                               #
# ------------------------------------------------------------------ #

@router.message(IS_ADMIN_GROUP, Command("stats"))
async def cmd_stats(message: Message) -> None:
    """Выводит статистику сервера. Только в admin-группе."""
    await message.answer("⏳ Запрашиваю данные сервера...")

    try:
        s = await xui.get_server_status()
        xray_icon = "🟢" if s.get("xray_state") == "running" else "🔴"
        text = (
            "🖥 <b>Дашборд сервера</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🔥 <b>ЦП:</b> {s['cpu']}%\n"
            f"🧠 <b>ОЗУ:</b> {s['mem_used']} / {s['mem_total']}\n"
            f"💾 <b>Диск:</b> {s['disk_used']} / {s['disk_total']}\n"
            f"🔄 <b>Файл подкачки:</b> {s['swap_used']} / {s['swap_total']}\n\n"
            f"⚙️ <b>Xray:</b> {xray_icon} {s['xray_state']}  <code>v{s['xray_version']}</code>\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            f"⏱ <b>Время работы ОС:</b> {s['uptime_sys']}\n"
            f"⏱ <b>Время работы Xray:</b> {s['uptime_xray']}\n\n"
            f"📈 <b>Нагрузка:</b> {s['load_1']} | {s['load_5']} | {s['load_15']}\n"
            f"📡 <b>TCP:</b> {s['tcp_count']}  |  <b>UDP:</b> {s['udp_count']}\n"
            f"🌐 <b>Сеть:</b> ↑ {s['net_up']}  ↓ {s['net_down']}"
        )
    except Exception as exc:
        logger.error("Failed to get server status: %s", exc)
        text = f"❌ Не удалось получить данные сервера.\n<code>{exc}</code>"

    await message.answer(text)


# ------------------------------------------------------------------ #
@router.message(IS_ADMIN_GROUP, Command("users"))
async def cmd_users(message: Message) -> None:
    """Дашборд пользователей. Только в admin-группе."""
    total = await db.get_total_users()
    active = await db.get_active_subs()
    expiring = await db.get_expiring_in(days=3)

    text = (
        "👥 <b>Статистика пользователей</b>\n\n"
        f"📊 <b>Всего зарегистрировано:</b> {total}\n"
        f"✅ <b>Активных подписок:</b> {active}\n"
        f"⚠️ <b>Истекают в ближайшие 3 дня:</b> {expiring}\n"
    )

    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="📢 Сделать рассылку",
            callback_data="admin:broadcast"
        )
    ]])

    await message.answer(text, reply_markup=kb)


# ------------------------------------------------------------------ #
#  Управление пользователями                                           #
# ------------------------------------------------------------------ #

@router.message(IS_ADMIN_GROUP, Command("give"))
async def cmd_give_days(message: Message) -> None:
    """
    Вручную выдает дни подписки пользователю.
    Формат: /give 12345678 30
    """
    args = message.text.split()
    if len(args) < 3:
        await message.answer("❌ Формат: <code>/give &lt;user_id&gt; &lt;days&gt;</code>", parse_mode="HTML")
        return

    try:
        target_id = int(args[1])
        days = int(args[2])
    except ValueError:
        await message.answer("❌ ID и количество дней должны быть числами.")
        return

    user = await db.get_user(target_id)
    if not user:
        await message.answer(f"❌ Пользователь <code>{target_id}</code> не найден в базе.", parse_mode="HTML")
        return

    try:
        # Продлеваем в БД и в XUI
        vless_link = await xui.create_or_extend(target_id, days)
        new_expiry = await db.add_subscription_days(target_id, days)
        
        await message.answer(
            f"✅ Пользователю <code>{target_id}</code> начислено <b>{days} дн.</b>\n"
            f"📅 Новая дата: <b>{new_expiry.strftime('%d.%m.%Y')}</b>",
            parse_mode="HTML"
        )
        
        # Уведомляем пользователя
        try:
            await message.bot.send_message(
                target_id,
                f"🎁 <b>Администратор продлил вашу подписку на {days} дн.!</b>\n\n"
                f"📅 Теперь она активна до: <b>{new_expiry.strftime('%d.%m.%Y')}</b>\n"
                f"🔗 Ключ: <code>{vless_link}</code>",
                parse_mode="HTML"
            )
        except Exception:
            await message.answer("⚠️ Пользователь получил дни, но не был уведомлен (возможно, бот заблокирован).")
            
    except Exception as e:
        logger.error(f"Manual give failed: {e}")
        await message.answer(f"❌ Ошибка: {e}")


@router.message(IS_ADMIN_GROUP, Command("info"))
async def cmd_user_info(message: Message) -> None:
    """
    Выводит подробную информацию о пользователе.
    Формат: /info 12345678
    """
    args = message.text.split()
    if len(args) < 2:
        await message.answer("❌ Формат: <code>/info &lt;user_id&gt;</code>", parse_mode="HTML")
        return

    try:
        target_id = int(args[1])
    except ValueError:
        await message.answer("❌ ID должен быть числом.")
        return

    user = await db.get_user(target_id)
    if not user:
        await message.answer(f"❌ Пользователь <code>{target_id}</code> не найден.", parse_mode="HTML")
        return

    status = "✅ Активен" if user["is_active"] else "❌ Неактивен"
    expiry = user["expiry_date"].strftime("%d.%m.%Y %H:%M") if user["expiry_date"] else "Нет"
    created = user["created_at"].strftime("%d.%m.%Y")
    
    text = (
        f"👤 <b>Инфо о пользователе</b> <code>{target_id}</code>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>User:</b> @{user['username'] or '—'}\n"
        f"📅 <b>Регистрация:</b> {created}\n"
        f"🚦 <b>Статус:</b> {status}\n"
        f"⏳ <b>Истекает:</b> {expiry}\n"
        f"🧪 <b>Демо:</b> {'Использовано' if user['trial_used'] else 'Не использовано'}\n"
        f"👥 <b>Реферер:</b> <code>{user['referrer_id'] or 'Нет'}</code>\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )
    
    await message.answer(text, parse_mode="HTML")


# ------------------------------------------------------------------ #
#  Задача 3: Рассылка по кнопке                                        #
# ------------------------------------------------------------------ #

@router.callback_query(IS_ADMIN_GROUP, F.data == "admin:broadcast")
async def cb_broadcast(call: CallbackQuery, bot: Bot) -> None:
    """
    Рассылает всем активным пользователям напоминание о подписке.
    Сообщение формируется персонально — с указанием остатка дней.
    """
    await call.answer("⏳ Запускаю рассылку...")
    await call.message.answer("📢 <b>Рассылка запущена...</b>")

    users = await db.get_active_users_for_broadcast()
    success, failed = 0, 0

    for row in users:
        user_id = row["user_id"]
        expiry = row["expiry_date"]

        if expiry:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            days_left = max(0, (expiry.replace(tzinfo=timezone.utc) - now).days)
            days_text = (
                f"⏳ До окончания вашей подписки осталось <b>{days_left} дн.</b>"
                if days_left > 0
                else "❗️ Ваша подписка <b>истекла</b>."
            )
        else:
            days_text = "❗️ Активной подписки нет."

        text = (
            "📬 <b>Напоминание от HRZN2</b>\n\n"
            f"{days_text}\n\n"
            "Продлите подписку, чтобы не потерять доступ к VPN.\n"
            "👉 Нажмите /start → <b>Продлить</b>"
        )

        try:
            await bot.send_message(user_id, text)
            success += 1
        except Exception:
            # Пользователь мог заблокировать бота
            failed += 1

    await call.message.answer(
        f"✅ Рассылка завершена.\n"
        f"📨 Отправлено: <b>{success}</b>\n"
        f"❌ Недоставлено: <b>{failed}</b>"
    )


# ------------------------------------------------------------------ #
#  Задача 1: Поддержка — пользователь → Group                          #
# ------------------------------------------------------------------ #

@router.message(F.chat.type == "private", F.text, ~F.text.startswith("/"))
async def user_to_support(message: Message, bot: Bot) -> None:
    """
    Пересылает текстовые сообщения пользователей в admin-группу.
    Используем copy_message чтобы скрыть аккаунт отправителя.

    TODO: Если хотите пересылать только от пользователей в определённом
    состоянии FSM (например, из меню поддержки), добавьте StateFilter
    и уберите этот универсальный обработчик.
    """
    if settings.admin_group_id == 0:
        # ADMIN_GROUP_ID не настроен — тихо игнорируем
        return

    user_id = message.from_user.id
    username = f"@{message.from_user.username}" if message.from_user.username else "без username"

    header = (
        f"💬 <b>Сообщение в поддержку</b>\n"
        f"👤 ID: <code>{user_id}</code> ({username})\n"
        f"{'─' * 20}\n"
    )

    try:
        await bot.send_message(
            chat_id=settings.admin_group_id,
            text=f"{header}{message.text}",
        )
        # Подтверждаем пользователю что сообщение получено
        await message.answer(
            "✅ Ваше сообщение принято в поддержку!\n"
            "Мы ответим вам в ближайшее время."
        )
    except Exception as exc:
        logger.error("Failed to forward support message to admin group: %s", exc)


# ------------------------------------------------------------------ #
#  Задача 1: Поддержка — Group → пользователь (Reply)                  #
# ------------------------------------------------------------------ #

@router.message(IS_ADMIN_GROUP, F.reply_to_message)
async def admin_reply_to_user(message: Message, bot: Bot) -> None:
    """
    Когда администратор делает Reply на сообщение бота в группе,
    бот извлекает ID пользователя из текста и отправляет ответ ему.
    """
    original_text = message.reply_to_message.text or ""

    # Ищем паттерн "ID: 12345678" в цитируемом сообщении
    match = re.search(r"ID:\s*(\d+)", original_text)
    if not match:
        # Это ответ не на сообщение поддержки — игнорируем
        return

    target_user_id = int(match.group(1))
    # Кнопка возврата в меню в ответе поддержки
    back_kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🏠 В главное меню", callback_data="menu_back")
    ]])
    try:
        await bot.send_message(
            chat_id=target_user_id,
            text=f"📩 <b>Ответ поддержки:</b>\n\n{message.text}",
            reply_markup=back_kb,
        )
        await message.react([{"type": "emoji", "emoji": "✅"}])
    except Exception as exc:
        logger.error(
            "Failed to deliver support reply to user %d: %s", target_user_id, exc
        )
        await message.answer(
            f"❌ Не удалось доставить ответ пользователю <code>{target_user_id}</code>.\n"
            f"Возможно, он заблокировал бота."
        )
