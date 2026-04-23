"""
middlewares/terms.py — Gatekeeper middleware.
Блокирует любые хэндлеры пока пользователь не принял условия использования.
Пропускает: /start, callback accept_terms, pre_checkout_query.
"""
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import (
    CallbackQuery,
    Message,
    PreCheckoutQuery,
    TelegramObject,
    Update,
)

from database import db
from keyboards import terms_keyboard

# Команды и callback'и, доступные без принятия условий
_ALLOWED_COMMANDS = {"/start"}
_ALLOWED_CALLBACKS = {"accept_terms"}

TERMS_TEXT = (
    "👋 Привет! Прежде чем начать, ознакомься с нашими документами.\n\n"
    "Нажми «✅ Принять условия», чтобы продолжить."
)


class TermsMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        # pre_checkout_query пропускаем всегда (Telegram требует быстрый ответ)
        if isinstance(event, PreCheckoutQuery):
            return await handler(event, data)

        user_id = self._extract_user_id(event)
        if user_id is None:
            return await handler(event, data)

        # Разрешённые точки входа без условий
        if self._is_allowed(event):
            return await handler(event, data)

        # Проверяем флаг в БД
        user = await db.get_user(user_id)
        if user and user["agreed_to_terms"]:
            return await handler(event, data)

        # Блокируем и показываем онбординг
        await self._send_terms_prompt(event)
        return None

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _extract_user_id(event: TelegramObject) -> int | None:
        if isinstance(event, Message) and event.from_user:
            return event.from_user.id
        if isinstance(event, CallbackQuery) and event.from_user:
            return event.from_user.id
        return None

    @staticmethod
    def _is_allowed(event: TelegramObject) -> bool:
        if isinstance(event, Message):
            text = (event.text or "").strip()
            # Пропускаем /start (с любыми аргументами)
            return text.startswith("/start")
        if isinstance(event, CallbackQuery):
            return event.data in _ALLOWED_CALLBACKS
        return False

    @staticmethod
    async def _send_terms_prompt(event: TelegramObject) -> None:
        if isinstance(event, Message):
            await event.answer(TERMS_TEXT, reply_markup=terms_keyboard())
        elif isinstance(event, CallbackQuery):
            await event.answer("Сначала прими условия использования.", show_alert=True)
