"""
services/xui.py — интеграция с панелью 3X-UI через REST API.
Управляет созданием и продлением VPN-клиентов.
"""
import json
import logging
import ssl
import uuid
from datetime import datetime, timedelta, timezone

import aiohttp
import certifi

from config import settings

logger = logging.getLogger(__name__)


class XUIService:
    """
    Клиент для работы с 3X-UI REST API.
    Сессия переиспользуется; login вызывается при старте приложения.
    """

    def __init__(self) -> None:
        self._session: aiohttp.ClientSession | None = None
        self._base: str = settings.xui_host.rstrip("/")
        self._is_mock = settings.xui_username.lower() == "dummy"
        self._headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }

    async def start(self) -> None:
        """Создаёт HTTP-сессию и выполняет аутентификацию."""
        if self._is_mock:
            logger.info("XUI service started in MOCK MODE (dummy username).")
            return

        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        # Разрешаем самоподписанные сертификаты (часто в панелях)
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        connector = aiohttp.TCPConnector(ssl=ssl_ctx)
        # unsafe=True нужен чтобы куки работали с IP-адресами (не только с доменами)
        jar = aiohttp.CookieJar(unsafe=True)
        self._session = aiohttp.ClientSession(
            connector=connector,
            cookie_jar=jar,
            headers=self._headers,
        )
        await self._login()
        logger.info("XUI service started and logged in.")

    async def stop(self) -> None:
        if self._session:
            await self._session.close()

    async def _login(self) -> None:
        resp = await self._request(
            "POST",
            "/login",
            data={"username": settings.xui_username, "password": settings.xui_password},
        )
        if not resp.get("success"):
            raise RuntimeError(f"3X-UI login failed: {resp}")
        logger.info("3X-UI login successful.")

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    async def create_client(self, user_id: int, days: int) -> str:
        """
        Создаёт нового VLESS-клиента в панели.
        Возвращает vless:// ссылку подключения.
        """
        client_id = str(uuid.uuid4())
        expiry_ms = self._expiry_ms(days)

        client_settings = {
            "clients": [{
                "id": client_id,
                "flow": "",
                "email": f"user_{user_id}",
                "limitIp": 0,
                "totalGB": 0,
                "expiryTime": expiry_ms,
                "enable": True,
                "tgId": str(user_id),
                "subId": f"sub_{user_id}",
                "comment": "",
                "reset": 0,
            }]
        }
        # Панель ожидает Form Data; settings передаётся как JSON-строка
        payload = {
            "id": settings.xui_inbound_id,
            "settings": json.dumps(client_settings),
        }

        resp = await self._request("POST", "/panel/api/inbounds/addClient", data=payload)
        if not resp.get("success"):
            raise RuntimeError(f"Failed to create XUI client: {resp}")

        logger.info("Created XUI client for user %d (%d days).", user_id, days)
        return self._build_link(user_id, client_id)

    async def extend_client(self, user_id: int, days: int) -> str:
        """
        Продлевает существующего клиента.
        Ищет по email = user_<user_id>, обновляет expiryTime.
        """
        client_info = await self._get_client_by_email(f"user_{user_id}")
        if not client_info:
            return await self.create_client(user_id, days)

        client_id = client_info["id"]
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        # Продлеваем от текущей даты окончания, если подписка ещё активна
        base_ms = max(client_info.get("expiryTime", 0), now_ms)
        new_expiry_ms = base_ms + days * 86_400_000

        update_settings = {
            "clients": [{**client_info, "expiryTime": new_expiry_ms, "enable": True}]
        }
        payload = {
            "id": settings.xui_inbound_id,
            "settings": json.dumps(update_settings),
        }

        resp = await self._request(
            "POST", f"/panel/api/inbounds/updateClient/{client_id}", data=payload
        )
        if not resp.get("success"):
            raise RuntimeError(f"Failed to extend XUI client: {resp}")

        logger.info("Extended XUI client for user %d by %d days.", user_id, days)
        return self._build_link(user_id, client_id)

    async def create_or_extend(self, user_id: int, days: int) -> str:
        """Умный метод: создаёт если нет, продлевает если есть."""
        client = await self._get_client_by_email(f"user_{user_id}")
        if client:
            return await self.extend_client(user_id, days)
        return await self.create_client(user_id, days)

    async def get_server_status(self) -> dict:
        """
        Возвращает статус сервера из 3X-UI.
        Эндпоинт: GET /panel/api/server/status
        """
        resp = await self._request("GET", "/panel/api/server/status")
        if not resp.get("success"):
            raise RuntimeError(f"Failed to get server status: {resp}")

        obj = resp.get("obj", {})

        def _fmt_bytes(val: int) -> str:
            """B → KB / MB / GB автоматически."""
            if not val:
                return "0 B"
            for unit in ("B", "KB", "MB", "GB"):
                if val < 1024:
                    return f"{val:.2f} {unit}"
                val /= 1024
            return f"{val:.2f} TB"

        def _fmt_uptime(seconds: int) -> str:
            if not seconds:
                return "—"
            days = seconds // 86400
            hours = (seconds % 86400) // 3600
            mins = (seconds % 3600) // 60
            parts = []
            if days:
                parts.append(f"{days}д")
            if hours:
                parts.append(f"{hours}ч")
            if mins and not days:
                parts.append(f"{mins}м")
            return " ".join(parts) or "<1м"

        mem  = obj.get("mem", {})
        swap = obj.get("swap", {})
        disk = obj.get("disk", {})
        xray = obj.get("xray", {})
        net_io = obj.get("netIO", {})
        loads = obj.get("loads", [0, 0, 0])

        return {
            "cpu":          f"{obj.get('cpu', 0):.1f}",
            "mem_used":     _fmt_bytes(mem.get("current", 0)),
            "mem_total":    _fmt_bytes(mem.get("total", 0)),
            "swap_used":    _fmt_bytes(swap.get("current", 0)),
            "swap_total":   _fmt_bytes(swap.get("total", 0)),
            "disk_used":    _fmt_bytes(disk.get("current", 0)),
            "disk_total":   _fmt_bytes(disk.get("total", 0)),
            "uptime_sys":   _fmt_uptime(obj.get("uptime", 0)),
            "uptime_xray":  _fmt_uptime(xray.get("uptime", 0)),
            "xray_state":   xray.get("state", "—"),
            "xray_version": xray.get("version", "—"),
            "tcp_count":    obj.get("tcpCount", 0),
            "udp_count":    obj.get("udpCount", 0),
            "load_1":       f"{loads[0]:.2f}" if len(loads) > 0 else "—",
            "load_5":       f"{loads[1]:.2f}" if len(loads) > 1 else "—",
            "load_15":      f"{loads[2]:.2f}" if len(loads) > 2 else "—",
            "net_up":       _fmt_bytes(net_io.get("up", 0)) + "/s",
            "net_down":     _fmt_bytes(net_io.get("down", 0)) + "/s",
        }

    async def get_client_link(self, user_id: int, client_id: str | None = None) -> str:
        """Возвращает vless:// ссылку подключения для клиента."""
        if client_id is None:
            client = await self._get_client_by_email(f"user_{user_id}")
            if not client:
                raise RuntimeError(f"No XUI client found for user {user_id}")
            client_id = client["id"]
        return self._build_link(user_id, client_id)

    # ------------------------------------------------------------------ #
    #  Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    def _build_link(self, user_id: int, client_id: str) -> str:
        """Собирает VLESS TCP Reality ссылку из проверенных параметров панели."""
        params = (
            "type=tcp&encryption=none&security=reality"
            "&pbk=4uiJtJy-CDxtQjIdRvAgW-JiNTX5hoMu6guTVOGBkDI"
            "&fp=chrome&sni=www.intel.com&sid=c8&spx=%2F"
        )
        return f"vless://{client_id}@144.31.141.164:7443?{params}#HRZN2-user_{user_id}"

    async def _get_client_by_email(self, email: str) -> dict | None:
        resp = await self._request(
            "GET", f"/panel/api/inbounds/getClientTraffics/{email}"
        )
        if resp.get("success") and resp.get("obj"):
            return resp["obj"]
        return None

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        """Выполняет HTTP-запрос к панели. Все ошибки логируются."""
        if self._is_mock:
            if "addClient" in path or "updateClient" in path:
                return {"success": True}
            if "/get/" in path:
                return {"success": True, "obj": {"port": 7443, "remark": "Mock VPN"}}
            if "getClientTraffics" in path:
                return {"success": False}
            return {"success": True, "obj": {}}

        if self._session is None:
            raise RuntimeError("XUIService is not started. Call start() first.")

        url = f"{self._base}{path}"
        try:
            async with self._session.request(method, url, **kwargs) as resp:
                resp.raise_for_status()
                return await resp.json()
        except aiohttp.ClientError as exc:
            logger.error("XUI API request failed [%s %s]: %s", method, url, exc)
            raise

    @staticmethod
    def _expiry_ms(days: int) -> int:
        """Возвращает unix timestamp в миллисекундах через `days` дней."""
        expiry = datetime.now(timezone.utc) + timedelta(days=days)
        return int(expiry.timestamp() * 1000)


# Глобальный singleton сервиса
xui = XUIService()
