"""
run_polling.py — скрипт для запуска бота в режиме Polling (для тестов).
Не требует Webhook, HTTPS и Nginx.
"""
import asyncio
import logging

from main import bot, dp, db, xui, crypto_pay

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("polling_test")

async def start_polling():
    logger.info("Starting bot in POLLING mode (test)...")

    # 1. Инициализация всех сервисов
    await db.connect()
    
    try:
        await xui.start()
    except Exception as exc:
        logger.warning("XUI service init failed: %s", exc)

    try:
        await crypto_pay.start()
    except Exception as exc:
        logger.warning("CryptoPay service init failed: %s", exc)

    # 2. Удаляем вебхук, чтобы Telegram начал отдавать апдейты через polling
    await bot.delete_webhook(drop_pending_updates=True)
    logger.info("Webhook deleted. Polling started.")

    try:
        # 3. Запускаем polling
        await dp.start_polling(bot)
    finally:
        # 4. Завершение работы
        logger.info("Shutting down polling...")
        await db.disconnect()
        await xui.stop()
        await crypto_pay.stop()
        await bot.session.close()

if __name__ == "__main__":
    try:
        asyncio.run(start_polling())
    except KeyboardInterrupt:
        logger.info("Stopped by user (Ctrl+C)")
