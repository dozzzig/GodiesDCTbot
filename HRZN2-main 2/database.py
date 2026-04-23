"""
database.py — асинхронный слой работы с PostgreSQL через asyncpg.
Поддержка SSL (обязательно для Neon), retry с экспоненциальным backoff,
все критичные операции в транзакциях.
"""
import asyncio
import logging
import ssl
from datetime import datetime, timedelta, timezone

import asyncpg
import certifi

from config import settings

logger = logging.getLogger(__name__)

# Количество попыток подключения и начальная задержка (секунды)
_RETRY_ATTEMPTS = 5
_RETRY_BASE_DELAY = 1.0


class Database:
    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None

    # ------------------------------------------------------------------ #
    #  Lifecycle                                                           #
    # ------------------------------------------------------------------ #

    async def connect(self) -> None:
        """Создаёт пул соединений с retry + SSL для Neon."""
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        ssl_ctx.check_hostname = True
        ssl_ctx.verify_mode = ssl.CERT_REQUIRED

        for attempt in range(1, _RETRY_ATTEMPTS + 1):
            try:
                self._pool = await asyncpg.create_pool(
                    dsn=settings.database_url,
                    ssl=ssl_ctx,
                    min_size=2,
                    max_size=10,
                    command_timeout=30,
                )
                logger.info("Database pool created successfully.")
                await self._run_migrations()
                return
            except Exception as exc:
                delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(
                    "DB connect attempt %d/%d failed: %s. Retrying in %.1fs…",
                    attempt,
                    _RETRY_ATTEMPTS,
                    exc,
                    delay,
                )
                if attempt == _RETRY_ATTEMPTS:
                    raise RuntimeError(
                        f"Failed to connect to database after {_RETRY_ATTEMPTS} attempts."
                    ) from exc
                await asyncio.sleep(delay)

    async def disconnect(self) -> None:
        if self._pool:
            await self._pool.close()
            logger.info("Database pool closed.")

    @property
    def pool(self) -> asyncpg.Pool:
        if not self._pool:
            raise RuntimeError("Database pool is not initialized. Call connect() first.")
        return self._pool

    # ------------------------------------------------------------------ #
    #  Migrations                                                          #
    # ------------------------------------------------------------------ #

    async def _run_migrations(self) -> None:
        """Создаёт таблицы и индексы если они ещё не существуют."""
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id         BIGINT      PRIMARY KEY,
                    username        TEXT,
                    referrer_id     BIGINT,
                    agreed_to_terms BOOLEAN     NOT NULL DEFAULT FALSE,
                    expiry_date     TIMESTAMPTZ,
                    trial_used      BOOLEAN     NOT NULL DEFAULT FALSE,
                    is_active       BOOLEAN     NOT NULL DEFAULT FALSE,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_users_referrer_id
                    ON users (referrer_id);

                CREATE TABLE IF NOT EXISTS transactions (
                    id          BIGSERIAL   PRIMARY KEY,
                    user_id     BIGINT      NOT NULL REFERENCES users(user_id),
                    amount      NUMERIC     NOT NULL,
                    currency    TEXT        NOT NULL CHECK (currency IN ('STARS', 'USDT', 'TON', 'RUB')),
                    status      TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'completed', 'failed')),
                    provider_id TEXT,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
            logger.info("Migrations applied.")

    # ------------------------------------------------------------------ #
    #  Users                                                               #
    # ------------------------------------------------------------------ #

    async def get_user(self, user_id: int) -> asyncpg.Record | None:
        return await self.pool.fetchrow(
            "SELECT * FROM users WHERE user_id = $1", user_id
        )

    async def create_user(
        self, user_id: int, username: str | None, referrer_id: int | None
    ) -> asyncpg.Record | None:
        return await self.pool.fetchrow(
            """
            INSERT INTO users (user_id, username, referrer_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO NOTHING
            RETURNING *
            """,
            user_id,
            username,
            referrer_id,
        )

    async def accept_terms(self, user_id: int) -> int | None:
        """
        Принимает условия и начисляет реферальные дни пригласившему.
        Всё в одной транзакции. Возвращает кол-во начисленных дней (или None).
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Помечаем условия как принятые
                row = await conn.fetchrow(
                    """
                    UPDATE users
                    SET agreed_to_terms = TRUE
                    WHERE user_id = $1
                    RETURNING referrer_id
                    """,
                    user_id,
                )
                if not row or not row["referrer_id"]:
                    return None

                referrer_id = row["referrer_id"]

                # Считаем уже существующих подтверждённых рефералов
                existing = await conn.fetchval(
                    """
                    SELECT COUNT(*) FROM users
                    WHERE referrer_id = $1
                      AND agreed_to_terms = TRUE
                      AND user_id != $2
                    """,
                    referrer_id,
                    user_id,
                )

                # Первый реферал → 10 дней, все последующие → 4 дня
                bonus_days = (
                    settings.referral_first_days
                    if existing == 0
                    else settings.referral_next_days
                )

                # Начисляем дни рефереру
                await conn.execute(
                    """
                    UPDATE users
                    SET expiry_date = GREATEST(COALESCE(expiry_date, NOW()), NOW())
                                      + ($1 || ' days')::INTERVAL,
                        is_active   = TRUE
                    WHERE user_id = $2
                    """,
                    str(bonus_days),
                    referrer_id,
                )
                logger.info(
                    "Referrer %d credited %d days (referral #%d by user %d).",
                    referrer_id,
                    bonus_days,
                    existing + 1,
                    user_id,
                )
                return bonus_days

    async def add_subscription_days(self, user_id: int, days: int) -> datetime:
        """Продлевает подписку на `days` дней. Возвращает новую дату окончания."""
        row = await self.pool.fetchrow(
            """
            UPDATE users
            SET expiry_date = GREATEST(COALESCE(expiry_date, NOW()), NOW())
                              + ($1 || ' days')::INTERVAL,
                is_active   = TRUE
            WHERE user_id = $2
            RETURNING expiry_date
            """,
            str(days),
            user_id,
        )
        return row["expiry_date"]

    async def mark_trial_used(self, user_id: int) -> None:
        await self.pool.execute(
            "UPDATE users SET trial_used = TRUE WHERE user_id = $1", user_id
        )

    # ------------------------------------------------------------------ #
    #  Transactions                                                        #
    # ------------------------------------------------------------------ #

    async def create_transaction(
        self,
        user_id: int,
        amount: float,
        currency: str,
        provider_id: str | None = None,
    ) -> int:
        """Создаёт запись транзакции. Возвращает её id."""
        row = await self.pool.fetchrow(
            """
            INSERT INTO transactions (user_id, amount, currency, provider_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            """,
            user_id,
            amount,
            currency,
            provider_id,
        )
        return row["id"]

    async def update_transaction_status(
        self, transaction_id: int, status: str, provider_id: str | None = None
    ) -> None:
        await self.pool.execute(
            """
            UPDATE transactions
            SET status = $1, provider_id = COALESCE($2, provider_id)
            WHERE id = $3
            """,
            status,
            provider_id,
            transaction_id,
        )

    # ------------------------------------------------------------------ #
    #  Admin Stats                                                         #
    # ------------------------------------------------------------------ #

    async def get_total_users(self) -> int:
        """Возвращает общее кол-во зарегистрированных пользователей."""
        return await self.pool.fetchval("SELECT COUNT(*) FROM users")

    async def get_active_subs(self) -> int:
        """Возвращает кол-во пользователей с активной (не истёкшей) подпиской."""
        return await self.pool.fetchval(
            "SELECT COUNT(*) FROM users WHERE is_active = TRUE AND expiry_date > NOW()"
        )

    async def get_expiring_in(self, days: int = 3) -> int:
        """Возвращает кол-во подписок, истекающих в ближайшие `days` дней."""
        return await self.pool.fetchval(
            """
            SELECT COUNT(*) FROM users
            WHERE is_active = TRUE
              AND expiry_date > NOW()
              AND expiry_date <= NOW() + ($1 || ' days')::INTERVAL
            """,
            str(days),
        )

    async def get_active_users_for_broadcast(self) -> list:
        """Возвращает список активных пользователей для рассылки (user_id + expiry_date)."""
        return await self.pool.fetch(
            """
            SELECT user_id, expiry_date FROM users
            WHERE is_active = TRUE
            ORDER BY user_id
            """
        )


# Глобальный singleton базы данных
db = Database()
