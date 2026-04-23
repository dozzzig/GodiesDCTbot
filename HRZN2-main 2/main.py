"""
main.py — точка входа приложения.
FastAPI + aiogram webhook dispatcher.
Lifecycle: инициализация DB → XUI login → CryptoPay → регистрация handlers.
"""
import logging
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import Update
from aiogram.webhook.aiohttp_server import SimpleRequestHandler
from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse

from config import settings
from database import db
from handlers import admin_router, instructions_router, menu_router, payment_router, start_router
from middlewares import TermsMiddleware
from services.crypto_pay import crypto_pay
from services.xui import xui

# Настройка логгирования
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
#  Конфигурация бота и диспетчера                                      #
# ------------------------------------------------------------------ #

bot = Bot(
    token=settings.bot_token,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)

dp = Dispatcher()

# Middleware регистрируется один раз на update
dp.update.middleware(TermsMiddleware())

# Роутеры в порядке приоритета
# admin_router и instructions_router первые — до общих обработчиков
dp.include_router(start_router)
dp.include_router(payment_router)
dp.include_router(admin_router)
dp.include_router(instructions_router)
dp.include_router(menu_router)


# ------------------------------------------------------------------ #
#  Lifespan                                                            #
# ------------------------------------------------------------------ #

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и завершение всех сервисов."""
    logger.info("Starting up…")

    # База данных
    await db.connect()

    # 3X-UI (VPN Panel)
    try:
        await xui.start()
    except Exception as exc:
        logger.warning("XUI service init failed (non-fatal): %s", exc)

    # CryptoPay
    try:
        await crypto_pay.start()
    except Exception as exc:
        logger.warning("CryptoPay service init failed (non-fatal): %s", exc)

    # Устанавливаем webhook
    webhook_url = settings.full_webhook_url
    await bot.set_webhook(
        url=webhook_url,
        secret_token=settings.webhook_secret or None,
        drop_pending_updates=True,
    )
    logger.info("Webhook set to: %s", webhook_url)

    yield  # Приложение работает

    logger.info("Shutting down…")
    await bot.delete_webhook()
    await db.disconnect()
    await xui.stop()
    await crypto_pay.stop()
    await bot.session.close()


# ------------------------------------------------------------------ #
#  FastAPI приложение                                                  #
# ------------------------------------------------------------------ #

app = FastAPI(
    title="Горизонт 2 VPN Bot",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None,   # отключаем публичный swagger
    redoc_url=None,
)


@app.post(settings.webhook_path)
async def telegram_webhook(request: Request) -> Response:
    """Принимает обновления от Telegram."""
    # Проверяем секретный токен если он задан
    if settings.webhook_secret:
        secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if secret != settings.webhook_secret:
            return Response(status_code=status.HTTP_403_FORBIDDEN)

    body = await request.json()
    update = Update.model_validate(body, context={"bot": bot})
    await dp.feed_update(bot=bot, update=update)
    return Response(status_code=status.HTTP_200_OK)


@app.get("/health")
async def healthcheck() -> JSONResponse:
    """Простой healthcheck для мониторинга."""
    return JSONResponse({"status": "ok", "version": "2.0.0"})
