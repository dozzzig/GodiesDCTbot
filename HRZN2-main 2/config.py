"""
config.py — централизованная конфигурация через pydantic-settings.
Все секреты загружаются из .env файла, никогда не хардкодятся.
"""
from functools import lru_cache
from typing import Any

from pydantic import AnyUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # --- Telegram Bot ---
    bot_token: str
    webhook_url: str          # e.g. https://yourdomain.com
    webhook_path: str = "/webhook"
    webhook_secret: str = ""  # X-Telegram-Bot-Api-Secret-Token

    # --- Database (Neon PostgreSQL) ---
    database_url: str         # postgresql+asyncpg://... or native asyncpg DSN

    # --- 3X-UI Panel ---
    xui_host: str             # e.g. https://panel.yourdomain.com:2053
    xui_username: str
    xui_password: str
    xui_inbound_id: int = 1   # ID входящего соединения в панели

    # --- CryptoPay (@CryptoBot) ---
    cryptopay_token: str
    cryptopay_testnet: bool = False  # True — тестовая сеть

    # --- Business logic ---
    trial_hours: int = 24
    referral_first_days: int = 10   # Дней за первого реферала
    referral_next_days: int = 4     # Дней за каждого следующего

    # --- Admin ---
    # Список Telegram user_id администраторов (через запятую в .env)
    admin_ids: Any = []
    # ID Telegram-группы для админки и поддержки (добавить бота как администратора!)
    admin_group_id: int = 0  # TODO: заменить на реальный ID группы в .env

    # --- URLs для онбординга ---
    terms_url: str = "https://example.com/terms"
    privacy_url: str = "https://example.com/privacy"

    # --- Ценообразование ---
    # Эталон: 1 месяц (30 дней) = base_price_rub рублей
    base_price_rub: float = 100.0
    # Курсы конвертации (настраиваются в .env при изменении рынка)
    rub_per_star: float = 2.0     # 50 ⭐ ≈ $0.99 ≈ 100 руб
    rub_per_usdt: float = 95.0    # рыночный курс

    @field_validator("admin_ids", mode="before")
    @classmethod
    def parse_admin_ids(cls, value: str | list) -> list[int]:
        """Парсим строку '123,456' или уже готовый список."""
        if isinstance(value, str):
            return [int(i.strip()) for i in value.split(",") if i.strip()]
        return value

    @property
    def full_webhook_url(self) -> str:
        return f"{self.webhook_url.rstrip('/')}{self.webhook_path}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


# Глобальный singleton — удобен для импорта
settings = get_settings()
