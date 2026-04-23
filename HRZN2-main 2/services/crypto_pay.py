"""
services/crypto_pay.py — интеграция с CryptoPay API (@CryptoBot).
Создание инвойсов и проверка статуса оплаты.
"""
import logging
from typing import Any

import aiohttp
import ssl
import certifi

from config import settings

logger = logging.getLogger(__name__)

# Базовые URL для mainnet и testnet
_MAINNET_URL = "https://pay.crypt.bot/api"
_TESTNET_URL = "https://testnet-pay.crypt.bot/api"


class CryptoPayService:
    def __init__(self) -> None:
        self._base = _TESTNET_URL if settings.cryptopay_testnet else _MAINNET_URL
        self._headers = {"Crypto-Pay-API-Token": settings.cryptopay_token}
        self._session: aiohttp.ClientSession | None = None
        self._is_mock = settings.cryptopay_token.lower() == "dummy"

    async def start(self) -> None:
        if self._is_mock:
            logger.info("CryptoPay service started in MOCK MODE (dummy token).")
            return

        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        connector = aiohttp.TCPConnector(ssl=ssl_ctx)
        self._session = aiohttp.ClientSession(headers=self._headers, connector=connector)
        # Проверяем валидность токена
        await self._request("GET", "getMe")
        logger.info("CryptoPay service initialized.")

    async def stop(self) -> None:
        if self._session:
            await self._session.close()

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    async def create_invoice(
        self,
        amount: float,
        asset: str | None = None,
        fiat: str | None = None,
        currency_type: str = "crypto",
        payload: str = "",
        description: str = "VPN Goroh — Подписка",
        expires_in: int = 3600,
    ) -> dict[str, Any]:
        """
        Создаёт инвойс. Возвращает словарь с полем invoice_id и pay_url.
        """
        data = {
            "amount": str(amount),
            "payload": payload,
            "description": description,
            "expires_in": expires_in,
            "currency_type": currency_type,
        }
        if currency_type == "fiat" and fiat:
            data["fiat"] = fiat
        elif asset:
            data["asset"] = asset
            
        result = await self._request("POST", "createInvoice", json=data)
        logger.info(
            "CryptoPay invoice created: id=%s, amount=%s %s",
            result.get("invoice_id"),
            amount,
            fiat if currency_type == "fiat" else asset,
        )
        return result

    async def get_invoice(self, invoice_id: int) -> dict[str, Any]:
        """Возвращает данные инвойса по его ID."""
        result = await self._request(
            "GET", "getInvoices", params={"invoice_ids": str(invoice_id)}
        )
        items = result.get("items", [])
        if not items:
            raise ValueError(f"Invoice {invoice_id} not found.")
        return items[0]

    async def is_paid(self, invoice_id: int) -> bool:
        """Удобный хэлпер: True если инвойс оплачен."""
        invoice = await self.get_invoice(invoice_id)
        return invoice.get("status") == "paid"

    # ------------------------------------------------------------------ #
    #  Internal                                                            #
    # ------------------------------------------------------------------ #

    async def _request(self, method: str, endpoint: str, **kwargs) -> dict[str, Any]:
        if self._is_mock:
            # Возвращаем фейковые данные для тестов
            if endpoint == "createInvoice":
                return {
                    "invoice_id": 999999,
                    "pay_url": "https://t.me/CryptoBot?start=mock_invoice",
                    "status": "active"
                }
            if endpoint == "getInvoices":
                return {"items": [{"invoice_id": 999999, "status": "paid"}]}
            return {"ok": True, "result": {}}

        if self._session is None:
            raise RuntimeError("CryptoPayService is not started.")

        url = f"{self._base}/{endpoint}"
        try:
            async with self._session.request(method, url, **kwargs) as resp:
                resp.raise_for_status()
                body = await resp.json()
        except aiohttp.ClientError as exc:
            logger.error("CryptoPay API error [%s %s]: %s", method, url, exc)
            raise

        if not body.get("ok"):
            raise RuntimeError(f"CryptoPay error: {body.get('error')}")

        return body.get("result", body)


# Глобальный singleton
crypto_pay = CryptoPayService()
