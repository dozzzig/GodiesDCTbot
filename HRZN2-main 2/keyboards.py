"""
keyboards.py — все клавиатуры бота в одном месте.
Изменение текста кнопок — только здесь, нигде больше.
Цены рассчитываются автоматически из config.settings.
"""
import math

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    KeyboardButton,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

from config import settings


# ------------------------------------------------------------------ #
#  Ценообразование                                                      #
# ------------------------------------------------------------------ #

# Периоды подписки: (название, дни, процент скидки)
_PLAN_PERIODS: list[tuple[str, int, float]] = [
    ("1 месяц",    30,  0.0),
    ("3 месяца",   90,  0.0),
    ("6 месяцев",  180, 0.0),
    ("12 месяцев", 365, 0.0),
]


def _calc_stars(days: int) -> int:
    """Рассчитывает цену в звёздах, округляя до ближайших 10."""
    rub = (days / 30) * settings.base_price_rub
    raw = rub / settings.rub_per_star
    # Округляем до ближайших 10 (вверх по умолчанию)
    return max(10, math.ceil(raw / 10) * 10)


def _calc_rub(days: int) -> float:
    """Рассчитывает цену в RUB."""
    rub = (days / 30) * settings.base_price_rub
    return round(rub, 2)


def _build_plans() -> list[tuple[str, int, int, float]]:
    """Строит список (label, days, stars, rub) на основе текущих курсов."""
    plans = []
    for label, days, _discount in _PLAN_PERIODS:
        stars = _calc_stars(days)
        rub = _calc_rub(days)
        plans.append((label, days, stars, rub))
    return plans


# ------------------------------------------------------------------ #
#  Онбординг / принятие условий                                        #
# ------------------------------------------------------------------ #

def terms_keyboard() -> InlineKeyboardMarkup:
    """Клавиатура с кнопками условий использования."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="📋 Правила сервиса", callback_data="show_rules"),
    )
    builder.row(
        InlineKeyboardButton(text="🔒 Политика конфиденциальности", callback_data="show_privacy"),
    )
    builder.row(
        InlineKeyboardButton(text="📝 Пользовательское соглашение", callback_data="show_agreement"),
    )
    builder.row(
        InlineKeyboardButton(text="✅ Принять условия", callback_data="accept_terms"),
    )
    return builder.as_markup()


# ------------------------------------------------------------------ #
#  Главное меню                                                        #
# ------------------------------------------------------------------ #

def main_menu_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🔌 Подключить VPN", callback_data="menu_connect"),
        InlineKeyboardButton(text="🗄 Мой профиль", callback_data="menu_status"),
    )
    builder.row(
        InlineKeyboardButton(text="🔗 Пригласить друга", callback_data="menu_referral"),
    )
    builder.row(
        InlineKeyboardButton(text="💎 Купить доступ", callback_data="menu_buy"),
        InlineKeyboardButton(text="⏱ Демо (24ч)", callback_data="menu_trial"),
    )
    builder.row(
        InlineKeyboardButton(text="📚 Инструкции", callback_data="menu_instructions"),
    )
    builder.row(
        InlineKeyboardButton(text="🛠 Техподдержка", callback_data="menu_support"),
    )
    return builder.as_markup()


# ------------------------------------------------------------------ #
#  Покупка / выбор тарифа                                              #
# ------------------------------------------------------------------ #

def buy_plans_keyboard() -> InlineKeyboardMarkup:
    """Выбор тарифного плана (оплата звёздами)."""
    builder = InlineKeyboardBuilder()
    for label, days, stars, _rub in _build_plans():
        builder.row(
            InlineKeyboardButton(
                text=f"{label} — {stars} ⭐",
                callback_data=f"buy_stars:{days}:{stars}",
            )
        )
    builder.row(
        InlineKeyboardButton(text="💎 Оплатить криптой", callback_data="buy_crypto_menu"),
    )
    builder.row(
        InlineKeyboardButton(text="◀️ Назад", callback_data="menu_back"),
    )
    return builder.as_markup()


def crypto_plans_keyboard() -> InlineKeyboardMarkup:
    """Выбор тарифного плана для оплаты криптой."""
    builder = InlineKeyboardBuilder()
    for label, days, _stars, rub in _build_plans():
        builder.row(
            InlineKeyboardButton(
                text=f"{label} — {rub:g} ₽",
                callback_data=f"buy_crypto:{days}:{rub}",
            )
        )
    builder.row(
        InlineKeyboardButton(text="◀️ Назад", callback_data="menu_buy"),
    )
    return builder.as_markup()


def payment_invoice_keyboard(pay_url: str) -> InlineKeyboardMarkup:
    """Кнопка перехода к оплате криптой."""
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="💳 Оплатить", url=pay_url))
    builder.row(InlineKeyboardButton(text="🔄 Проверить оплату", callback_data="check_payment"))
    builder.row(InlineKeyboardButton(text="◀️ Отмена", callback_data="menu_buy"))
    return builder.as_markup()


# ------------------------------------------------------------------ #
#  Реферальное меню                                                    #
# ------------------------------------------------------------------ #

def referral_keyboard(bot_username: str, user_id: int) -> InlineKeyboardMarkup:
    ref_link = f"https://t.me/{bot_username}?start=ref{user_id}"
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="📤 Поделиться ссылкой",
            url=f"https://t.me/share/url?url={ref_link}&text=🔥+Попробуй+VPN+Горизонт!",
        )
    )
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="menu_back"))
    return builder.as_markup()


# ------------------------------------------------------------------ #
#  Служебные                                                           #
# ------------------------------------------------------------------ #

def back_keyboard(callback: str = "menu_back") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data=callback))
    return builder.as_markup()
