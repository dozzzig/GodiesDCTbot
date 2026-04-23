# 🌐 Горизонт 2 — VPN Telegram Bot

Telegram-бот для управления VPN-подпиской с автоматической интеграцией в панель 3X-UI, реферальной системой и двойным платёжным шлюзом (Telegram Stars + Crypto Pay).

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Язык | Python 3.11+ |
| Bot framework | aiogram 3.x |
| Web server | FastAPI + uvicorn |
| Database | Neon PostgreSQL (asyncpg) |
| VPN Panel | 3X-UI REST API |
| Payments | Telegram Stars + CryptoPay |

---

## Структура проекта

```
Horizon2/
├── main.py            # FastAPI + aiogram webhook entrypoint
├── config.py          # pydantic-settings конфигурация
├── database.py        # asyncpg pool, SSL, retries, миграции
├── keyboards.py       # Все клавиатуры
├── middlewares/
│   └── terms.py       # Gatekeeper: блокировка до принятия условий
├── handlers/
│   ├── start.py       # /start, принятие условий, онбординг
│   ├── payment.py     # Stars + CryptoPay платежи
│   └── menu.py        # Главное меню, статус, демо, рефералы
├── services/
│   ├── xui.py         # 3X-UI API: create/extend VPN clients
│   └── crypto_pay.py  # CryptoPay API: инвойсы
├── .env.example       # Шаблон конфигурации
├── requirements.txt   # Зависимости (зафиксированные версии)
└── .gitignore
```

---

## Быстрый старт

### 1. Подготовка окружения

```bash
cd Horizon2
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Настройка `.env`

```bash
cp .env.example .env
# Открой .env и заполни все переменные
nano .env
```

Обязательные переменные:
- `BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)
- `DATABASE_URL` — строка подключения Neon PostgreSQL
- `WEBHOOK_URL` — публичный домен сервера (HTTPS)
- `XUI_HOST`, `XUI_USERNAME`, `XUI_PASSWORD` — данные панели 3X-UI
- `CRYPTOPAY_TOKEN` — токен от [@CryptoBot](https://t.me/CryptoBot)

### 3. Запуск

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

При первом запуске автоматически создаются таблицы в БД и устанавливается webhook.

---

## База данных

Таблицы создаются автоматически при первом запуске:

| Таблица | Описание |
|---------|----------|
| `users` | Пользователи, флаг условий, дата истечения, реферал |
| `transactions` | История платежей со статусами |

---

## Бизнес-логика

### Онбординг (Gatekeeper)
- `/start` всегда доступен
- Все остальные функции заблокированы до нажатия «✅ Принять условия»
- Реализован через `TermsMiddleware`

### Реферальная система
- Реферальная ссылка: `https://t.me/BOT?start=ref<user_id>`
- 1-й подтверждённый реферал → **+10 дней** рефереру
- Каждый последующий → **+4 дня**
- Начисление в одной SQL-транзакции (атомарно)

### Платежи

**Telegram Stars:**
1. Пользователь выбирает тариф
2. Бот отправляет `invoice` с валютой `XTR`
3. `pre_checkout_query` → автоматическое подтверждение
4. `successful_payment` → активация VPN

**CryptoPay (USDT):**
1. Создаётся инвойс через API @CryptoBot
2. Пользователь платит и нажимает «Проверить оплату»
3. Бот проверяет статус → активация VPN

### VPN (3X-UI)
- Демо: 24 часа, строго 1 раз на аккаунт
- При оплате: если клиент существует — продление, иначе — создание
- Срок не теряется: продление считается от `MAX(now(), expiry_date)`

---

## Продакшн

Рекомендуется запускать через systemd или Docker:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

> ⚠️ `--workers 1` обязателен — бот не поддерживает multi-process (in-memory хранилище инвойсов).  
> Для multi-process нужно перенести `_pending_invoices` в Redis.

### Система уведомлений для админов
Бот автоматически уведомляет в Telegram-группу (указанную в `ADMIN_GROUP_ID` в `.env`) о важных событиях:
- 🆕 **Новый лид:** когда пользователь первый раз запускает бота.
- ✅ **Принятие условий:** когда лид становится активным пользователем.
- 🎁 **Активация демо:** когда пользователь пробует сервис.
- 💰 **Оплата:** информация о каждой успешной покупке (Stars или Crypto).

---

## Ручная настройка

После запуска необходимо:
1. Настроить Nginx/Caddy в качестве реверс-прокси (HTTPS)
2. В [@BotFather](https://t.me/BotFather) настроить:
   - Описание бота
   - Разрешить платежи Stars (`/mybots` → Bot Settings → Payments)
3. Получить токен от [@CryptoBot](https://t.me/CryptoBot) (команда `/pay`)
