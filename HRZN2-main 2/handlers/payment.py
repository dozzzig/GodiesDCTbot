"""
handlers/payment.py — обработчики платежей.

Telegram Stars:
  - pre_checkout_query: обязан ответить OK в течение 10 секунд
  - successful_payment: создаём/продлеваем VPN и пишем в БД

CryptoPay:
  - buy_crypto:<days>:<amount> — создаём инвойс
  - check_payment — проверяем статус открытого инвойса пользователя
"""
import logging
from datetime import datetime

from aiogram import F, Router
from aiogram.filters import Filter
from aiogram.types import (
    CallbackQuery,
    LabeledPrice,
    Message,
    PreCheckoutQuery,
    SuccessfulPayment,
)

from config import settings
from database import db
from keyboards import (
    buy_plans_keyboard,
    crypto_plans_keyboard,
    main_menu_keyboard,
    payment_invoice_keyboard,
)
from services.crypto_pay import crypto_pay
from services.xui import xui

logger = logging.getLogger(__name__)
router = Router(name="payment")

# Временное хранилище открытых инвойсов пользователя: user_id → {invoice_id, days}
# В продакшне лучше хранить в Redis или taблице pending_invoices в БД
_pending_invoices: dict[int, dict] = {}


# ------------------------------------------------------------------ #
#  Меню покупки                                                        #
# ------------------------------------------------------------------ #

@router.callback_query(F.data == "menu_buy")
async def cb_menu_buy(callback: CallbackQuery) -> None:
    await callback.message.edit_text(  # type: ignore[union-attr]
        "💳 <b>Выбери тарифный план:</b>",
        reply_markup=buy_plans_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(F.data == "buy_crypto_menu")
async def cb_crypto_menu(callback: CallbackQuery) -> None:
    await callback.message.edit_text(  # type: ignore[union-attr]
        "💎 <b>Оплата криптовалютой:</b>",
        reply_markup=crypto_plans_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


# ------------------------------------------------------------------ #
#  Telegram Stars                                                      #
# ------------------------------------------------------------------ #

@router.callback_query(F.data.startswith("buy_stars:"))
async def cb_buy_stars(callback: CallbackQuery) -> None:
    """Отправляем инвойс через Telegram Stars."""
    _, days_str, stars_str = callback.data.split(":")
    days, stars = int(days_str), int(stars_str)

    await callback.message.answer_invoice(  # type: ignore[union-attr]
        title="🌐 VPN Горизонт — Подписка",
        description=f"VPN-доступ на {days} дней",
        payload=f"vpn:{days}",
        currency="XTR",  # Telegram Stars
        prices=[LabeledPrice(label="Подписка", amount=stars)],
        provider_token="",  # для Stars всегда пустой
    )
    await callback.answer()


@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery) -> None:
    """
    Telegram требует ответить OK в течение 10 секунд.
    Разрешаем все запросы — валидация payload происходит в successful_payment.
    """
    await query.answer(ok=True)


@router.message(F.successful_payment)
async def on_successful_payment(message: Message) -> None:
    """Оплата через Stars подтверждена — активируем VPN."""
    payment: SuccessfulPayment = message.successful_payment  # type: ignore[assignment]
    user_id = message.from_user.id  # type: ignore[union-attr]

    # Разбираем payload: vpn:<days>
    payload_parts = payment.invoice_payload.split(":")
    if len(payload_parts) != 2 or payload_parts[0] != "vpn":
        logger.error("Unexpected payment payload: %s", payment.invoice_payload)
        await message.answer("❌ Ошибка обработки платежа. Обратитесь в поддержку.")
        return

    days = int(payload_parts[1])

    # Записываем транзакцию
    tx_id = await db.create_transaction(
        user_id=user_id,
        amount=payment.total_amount,
        currency="STARS",
        provider_id=payment.telegram_payment_charge_id,
    )

    # Создаём / продлеваем VPN
    try:
        vless_link = await xui.create_or_extend(user_id, days)
        new_expiry = await db.add_subscription_days(user_id, days)
        await db.update_transaction_status(tx_id, "completed")

        # Уведомление об успешной оплате (Stars)
        username_str = f"@{message.from_user.username}" if message.from_user.username else "Нет юзернейма"
        notify_text = (
            f"💰 <b>Успешная оплата (Stars)!</b>\n"
            f"ID: <code>{user_id}</code>\n"
            f"User: {username_str}\n"
            f"Период: <b>{days} дней</b>\n"
            f"Сумма: <code>{payment.total_amount} XTR</code>"
        )
        if settings.admin_group_id:
            try:
                await message.bot.send_message(settings.admin_group_id, notify_text, parse_mode="HTML")
            except Exception as e:
                logger.error(f"Failed to notify admin group about Stars payment: {e}")

        expiry_str = new_expiry.strftime("%d.%m.%Y")
        await message.answer(
            f"✅ <b>Оплата принята!</b>\n\n"
            f"📅 Подписка активна до: <b>{expiry_str}</b>\n\n"
            f"🔗 <b>Ключ подключения:</b>\n<code>{vless_link}</code>\n\n"
            f"💡 Скопируй ключ и вставь в приложение (v2rayNG, Streisand, etc.)",
            parse_mode="HTML",
        )
    except Exception as exc:
        logger.error("VPN activation failed for user %d: %s", user_id, exc)
        await db.update_transaction_status(tx_id, "failed")
        await message.answer(
            "⚠️ Оплата прошла успешно, но возникла ошибка при активации VPN.\n"
            "Поддержка уже уведомлена и исправит это вручную."
        )


# ------------------------------------------------------------------ #
#  CryptoPay                                                           #
# ------------------------------------------------------------------ #

@router.callback_query(F.data.startswith("buy_crypto:"))
async def cb_buy_crypto(callback: CallbackQuery) -> None:
    """Создаём инвойс в CryptoPay и отправляем ссылку оплаты."""
    _, days_str, amount_str = callback.data.split(":")
    days, amount = int(days_str), float(amount_str)
    user_id = callback.from_user.id

    try:
        invoice = await crypto_pay.create_invoice(
            currency_type="fiat",
            fiat="RUB",
            amount=amount,
            payload=f"{user_id}:{days}",
            description=f"VPN Горизонт — {days} дней",
        )
    except Exception as exc:
        logger.error("Failed to create crypto invoice for user %d: %s", user_id, exc)
        await callback.answer("❌ Ошибка создания инвойса. Попробуй позже.", show_alert=True)
        return

    invoice_id = invoice["invoice_id"]
    pay_url = invoice["pay_url"]

    # Сохраняем pending инвойс
    _pending_invoices[user_id] = {"invoice_id": invoice_id, "days": days, "amount": amount}

    # Записываем в БД со статусом pending
    await db.create_transaction(
        user_id=user_id,
        amount=amount,
        currency="RUB",
        provider_id=str(invoice_id),
    )

    await callback.message.edit_text(  # type: ignore[union-attr]
        f"💎 <b>Инвойс создан!</b>\n\n"
        f"Сумма: <b>{amount:g} ₽</b> (в крипте по курсу)\n"
        f"Период: <b>{days} дней</b>\n\n"
        f"После оплаты нажми «🔄 Проверить оплату».",
        reply_markup=payment_invoice_keyboard(pay_url),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(F.data == "check_payment")
async def cb_check_payment(callback: CallbackQuery) -> None:
    """Проверяем статус ожидающего CryptoPay инвойса."""
    user_id = callback.from_user.id
    pending = _pending_invoices.get(user_id)

    if not pending:
        await callback.answer("Нет активного инвойса.", show_alert=True)
        return

    invoice_id = pending["invoice_id"]
    days = pending["days"]
    amount = pending["amount"]

    try:
        paid = await crypto_pay.is_paid(invoice_id)
    except Exception as exc:
        logger.error("Failed to check crypto invoice %d: %s", invoice_id, exc)
        await callback.answer("❌ Ошибка проверки. Попробуй позже.", show_alert=True)
        return

    if not paid:
        await callback.answer("⏳ Оплата ещё не поступила. Попробуй через минуту.", show_alert=True)
        return

    # Оплата подтверждена — убираем из pending и активируем
    _pending_invoices.pop(user_id, None)

    # Находим транзакцию и обновляем статус
    try:
        vless_link = await xui.create_or_extend(user_id, days)
        new_expiry = await db.add_subscription_days(user_id, days)

        # Обновляем статус транзакции в БД (ищем по provider_id)
        async with db.pool.acquire() as conn:
            await conn.execute(
                "UPDATE transactions SET status = 'completed' WHERE provider_id = $1",
                str(invoice_id),
            )

        # Уведомление об успешной оплате (Crypto)
        username_str = f"@{callback.from_user.username}" if callback.from_user.username else "Нет юзернейма"
        notify_text = (
            f"💰 <b>Успешная оплата (Crypto)!</b>\n"
            f"ID: <code>{user_id}</code>\n"
            f"User: {username_str}\n"
            f"Период: <b>{days} дней</b>\n"
            f"Сумма: <code>{amount:g} RUB</code>"
        )
        if settings.admin_group_id:
            try:
                await callback.bot.send_message(settings.admin_group_id, notify_text, parse_mode="HTML")
            except Exception as e:
                logger.error(f"Failed to notify admin group about Crypto payment: {e}")

        expiry_str = new_expiry.strftime("%d.%m.%Y")
        await callback.message.edit_text(  # type: ignore[union-attr]
            f"✅ <b>Оплата подтверждена!</b>\n\n"
            f"📅 Подписка активна до: <b>{expiry_str}</b>\n\n"
            f"🔗 <b>Ключ подключения:</b>\n<code>{vless_link}</code>",
            reply_markup=main_menu_keyboard(),
            parse_mode="HTML",
        )
        await callback.answer("✅ VPN активирован!")
    except Exception as exc:
        logger.error("VPN activation failed (crypto) for user %d: %s", user_id, exc)
        await callback.answer(
            "⚠️ Оплата принята, но произошла ошибка активации. Свяжись с поддержкой.",
            show_alert=True,
        )
