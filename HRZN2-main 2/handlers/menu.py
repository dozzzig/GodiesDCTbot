"""
handlers/menu.py — главное меню, статус подписки, демо-режим и реферальная программа.
"""
import logging
from datetime import datetime, timezone

from aiogram import F, Router
from aiogram.types import CallbackQuery, Message

from config import settings
from database import db
from keyboards import back_keyboard, main_menu_keyboard, referral_keyboard
from services.xui import xui

logger = logging.getLogger(__name__)
router = Router(name="menu")


@router.callback_query(F.data == "menu_connect")
async def cb_menu_connect(callback: CallbackQuery) -> None:
    """Выдаём актуальный ключ подключения или сообщаем об отсутствии подписки."""
    user_id = callback.from_user.id
    user = await db.get_user(user_id)

    if not user or not user["is_active"] or (
        user["expiry_date"] and user["expiry_date"] < datetime.now(timezone.utc)
    ):
        await callback.answer(
            "❌ У тебя нет активной подписки.\nВыбери Демо или оплати подписку.",
            show_alert=True
        )
        return

    try:
        vless_link = await xui.get_client_link(user_id)
        expiry_str = user["expiry_date"].strftime("%d.%m.%Y %H:%M")
        await callback.message.edit_text(  # type: ignore[union-attr]
            f"🔗 <b>Ключ подключения:</b>\n<code>{vless_link}</code>\n\n"
            f"📅 Действует до: <b>{expiry_str}</b>\n\n"
            "💡 Используй приложения: v2rayNG (Android), Streisand (iOS), Hiddify (PC).",
            reply_markup=back_keyboard(),
            parse_mode="HTML",
        )
    except Exception as exc:
        logger.error("Failed to get VPN link for user %d: %s", user_id, exc)
        await callback.answer("❌ Не удалось получить ключ. Попробуй позже.", show_alert=True)

    await callback.answer()


@router.callback_query(F.data == "menu_status")
async def cb_menu_status(callback: CallbackQuery) -> None:
    """Показывает текущий статус подписки."""
    user_id = callback.from_user.id
    user = await db.get_user(user_id)

    if not user:
        await callback.answer("Пользователь не найден.", show_alert=True)
        return

    now = datetime.now(timezone.utc)
    if user["is_active"] and user["expiry_date"] and user["expiry_date"] > now:
        remaining = user["expiry_date"] - now
        days_left = remaining.days
        hours_left = remaining.seconds // 3600
        status_text = (
            f"✅ <b>Подписка активна</b>\n\n"
            f"⏳ Осталось: <b>{days_left}д {hours_left}ч</b>\n"
            f"📅 До: <b>{user['expiry_date'].strftime('%d.%m.%Y')}</b>"
        )
    else:
        status_text = "❌ <b>Подписка не активна</b>"

    # Статистика рефералов
    referral_count: int = await db.pool.fetchval(
        "SELECT COUNT(*) FROM users WHERE referrer_id = $1 AND agreed_to_terms = TRUE",
        user_id,
    )

    status_text += (
        f"\n\n👥 <b>Рефералов:</b> {referral_count}\n"
        f"🧪 <b>Демо использовано:</b> {'Да' if user['trial_used'] else 'Нет'}"
    )

    await callback.message.edit_text(  # type: ignore[union-attr]
        status_text,
        reply_markup=back_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(F.data == "menu_trial")
async def cb_menu_trial(callback: CallbackQuery) -> None:
    """Активирует демо-доступ на 24 часа (строго 1 раз)."""
    user_id = callback.from_user.id
    user = await db.get_user(user_id)

    if not user:
        await callback.answer("Ошибка: пользователь не найден.", show_alert=True)
        return

    if user["trial_used"]:
        await callback.answer("❌ Ты уже использовал демо-доступ.", show_alert=True)
        return

    try:
        vless_link = await xui.create_or_extend(user_id, settings.trial_hours // 24 or 1)
        new_expiry = await db.add_subscription_days(user_id, 1)  # 1 день = 24ч
        await db.mark_trial_used(user_id)

        # Уведомление для админов: Активация демо
        username_str = f"@{callback.from_user.username}" if callback.from_user.username else "Нет юзернейма"
        notify_text = (
            f"🎁 <b>Активирован подарок (Демо)!</b>\n"
            f"ID: <code>{user_id}</code>\n"
            f"User: {username_str}\n"
            f"Период: 24 часа"
        )
        if settings.admin_group_id:
            try:
                await callback.bot.send_message(settings.admin_group_id, notify_text, parse_mode="HTML")
            except Exception as e:
                logger.error(f"Failed to notify admin group about trial: {e}")

        await callback.message.edit_text(  # type: ignore[union-attr]
            f"🎁 <b>Демо-доступ активирован на 24 часа!</b>\n\n"
            f"🔗 <b>Ключ подключения:</b>\n<code>{vless_link}</code>\n\n"
            f"📅 Доступ до: <b>{new_expiry.strftime('%d.%m.%Y %H:%M')}</b>\n\n"
            "💡 Понравилось? Купи полную подписку!",
            reply_markup=back_keyboard("menu_buy"),
            parse_mode="HTML",
        )
    except Exception as exc:
        logger.error("Trial activation failed for user %d: %s", user_id, exc)
        await callback.answer("❌ Ошибка активации демо. Попробуй позже.", show_alert=True)

    await callback.answer()


@router.callback_query(F.data == "menu_referral")
async def cb_menu_referral(callback: CallbackQuery) -> None:
    """Показывает реферальную ссылку и статистику."""
    user_id = callback.from_user.id
    bot_info = await callback.bot.get_me()  # type: ignore[union-attr]
    bot_username = bot_info.username

    referral_count: int = await db.pool.fetchval(
        "SELECT COUNT(*) FROM users WHERE referrer_id = $1 AND agreed_to_terms = TRUE",
        user_id,
    )

    await callback.message.edit_text(  # type: ignore[union-attr]
        f"👥 <b>Реферальная программа</b>\n\n"
        f"За каждого друга, которого ты пригласишь:\n"
        f"• 1-й друг → <b>+{settings.referral_first_days} дней</b>\n"
        f"• Каждый следующий → <b>+{settings.referral_next_days} дня</b>\n\n"
        f"Твоя ссылка:\n"
        f"<code>https://t.me/{bot_username}?start=ref{user_id}</code>\n\n"
        f"👤 Приглашено: <b>{referral_count} чел.</b>",
        reply_markup=referral_keyboard(bot_username, user_id),
        parse_mode="HTML",
    )
    await callback.answer()
