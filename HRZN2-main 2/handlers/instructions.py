"""
handlers/instructions.py — модуль «Инструкции по настройке VPN».

Трёхуровневая навигация через Inline-клавиатуру:
  1. Выбор ОС
  2. Выбор приложения
  3. Текст инструкции + кнопка «Назад»
"""
import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

logger = logging.getLogger(__name__)
router = Router(name="instructions")

# ------------------------------------------------------------------ #
#  Клавиатуры                                                          #
# ------------------------------------------------------------------ #

def _kb_os() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🍏 iOS",     callback_data="inst_os_ios"),
         InlineKeyboardButton(text="🤖 Android", callback_data="inst_os_android")],
        [InlineKeyboardButton(text="💻 Windows", callback_data="inst_os_windows"),
         InlineKeyboardButton(text="🍎 macOS",   callback_data="inst_os_mac")],
        [InlineKeyboardButton(text="◀️ Назад",   callback_data="menu_back")],
    ])


def _kb_apps(apps: list[tuple[str, str]], back: str = "inst_os") -> InlineKeyboardMarkup:
    """Строит клавиатуру приложений динамически."""
    rows = [[InlineKeyboardButton(text=name, callback_data=cb)] for name, cb in apps]
    rows.append([InlineKeyboardButton(text="◀️ Назад", callback_data=back)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _kb_back_to_os() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="◀️ Назад к выбору ОС", callback_data="inst_os")
    ]])


# ------------------------------------------------------------------ #
#  Тексты инструкций                                                   #
# ------------------------------------------------------------------ #

_INSTRUCTIONS: dict[str, str] = {

    "inst_app_v2box": (
        "🍏 <b>V2Box — iOS</b>\n\n"
        "1. Установите <a href='https://apps.apple.com/app/v2box-v2ray-client/id6446814690'>V2Box</a> из App Store\n"
        "2. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "3. В V2Box нажмите <b>«+»</b> → <b>«Clipboard»</b>\n"
        "4. Ключ добавится автоматически — нажмите <b>Connect</b> ✅"
    ),

    "inst_app_streisand": (
        "🍏 <b>Streisand — iOS</b>\n\n"
        "1. Установите <a href='https://apps.apple.com/app/streisand/id6450534064'>Streisand</a> из App Store\n"
        "2. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "3. В Streisand нажмите <b>«+»</b> → <b>«Import from clipboard»</b>\n"
        "4. Переведите тумблер вверх — подключено ✅"
    ),

    "inst_app_v2rayng": (
        "🤖 <b>v2rayNG — Android</b>\n\n"
        "1. Установите <a href='https://play.google.com/store/apps/details?id=com.v2ray.ang'>v2rayNG</a> из Google Play\n"
        "2. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "3. В v2rayNG нажмите <b>«+»</b> → <b>«Import config from clipboard»</b>\n"
        "4. Нажмите кнопку <b>▶</b> — подключено ✅"
    ),

    "inst_app_hiddify_android": (
        "🤖 <b>Hiddify — Android</b>\n\n"
        "1. Установите <a href='https://play.google.com/store/apps/details?id=app.hiddify.com'>Hiddify</a> из Google Play\n"
        "2. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "3. В Hiddify нажмите <b>«+»</b> → <b>«Add profile from clipboard»</b>\n"
        "4. Нажмите <b>Connect</b> — подключено ✅"
    ),

    "inst_app_hiddify_win": (
        "💻 <b>Hiddify — Windows</b>\n\n"
        "1. Скачайте <a href='https://github.com/hiddify/hiddify-app/releases/latest'>Hiddify</a> (файл .exe)\n"
        "2. Установите и запустите\n"
        "3. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "4. В Hiddify нажмите <b>«+»</b> → <b>«Add from clipboard»</b>\n"
        "5. Нажмите <b>Connect</b> — подключено ✅"
    ),

    "inst_app_v2rayn": (
        "💻 <b>v2rayN — Windows</b>\n\n"
        "1. Скачайте <a href='https://github.com/2dust/v2rayN/releases/latest'>v2rayN</a> (архив .zip)\n"
        "2. Распакуйте и запустите <code>v2rayN.exe</code>\n"
        "3. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "4. В трее: <b>ПКМ → «Clipboard (Ctrl+V)»</b>\n"
        "5. В списке серверов нажмите <b>▶</b> — подключено ✅"
    ),

    "inst_app_hiddify_mac": (
        "🍎 <b>Hiddify — macOS</b>\n\n"
        "1. Скачайте <a href='https://github.com/hiddify/hiddify-app/releases/latest'>Hiddify</a> (файл .dmg)\n"
        "2. Установите и запустите\n"
        "3. Скопируйте ваш ключ в боте → кнопка <b>«🚀 Подключить VPN»</b>\n"
        "4. В Hiddify нажмите <b>«+»</b> → <b>«Add from clipboard»</b>\n"
        "5. Нажмите <b>Connect</b> — подключено ✅"
    ),
}

_APPS_BY_OS: dict[str, list[tuple[str, str]]] = {
    "ios":     [("V2Box", "inst_app_v2box"), ("Streisand", "inst_app_streisand")],
    "android": [("v2rayNG", "inst_app_v2rayng"), ("Hiddify", "inst_app_hiddify_android")],
    "windows": [("Hiddify", "inst_app_hiddify_win"), ("v2rayN", "inst_app_v2rayn")],
    "mac":     [("Hiddify", "inst_app_hiddify_mac"), ("v2rayN (через Wine)", "inst_app_v2rayn")],
}

_OS_LABEL: dict[str, str] = {
    "ios": "inst_os_ios", "android": "inst_os_android",
    "windows": "inst_os_windows", "mac": "inst_os_mac",
}

# ------------------------------------------------------------------ #
#  Уровень 1 — Выбор ОС                                               #
# ------------------------------------------------------------------ #

_SELECT_OS_TEXT = (
    "📚 <b>Инструкции по подключению</b>\n\n"
    "Выберите ваше устройство:"
)


@router.message(Command("help"))
@router.callback_query(F.data == "inst_os")
@router.callback_query(F.data == "menu_instructions")
async def show_os_selection(event: Message | CallbackQuery) -> None:
    if isinstance(event, CallbackQuery):
        await event.message.edit_text(_SELECT_OS_TEXT, reply_markup=_kb_os())
        await event.answer()
    else:
        await event.answer(_SELECT_OS_TEXT, reply_markup=_kb_os())


# ------------------------------------------------------------------ #
#  Уровень 2 — Выбор приложения                                       #
# ------------------------------------------------------------------ #

@router.callback_query(F.data.startswith("inst_os_"))
async def show_app_selection(call: CallbackQuery) -> None:
    os_key = call.data.removeprefix("inst_os_")   # ios / android / windows / mac
    apps = _APPS_BY_OS.get(os_key)
    if not apps:
        await call.answer("Неизвестная платформа.", show_alert=True)
        return

    os_names = {"ios": "iOS", "android": "Android", "windows": "Windows", "mac": "macOS"}
    text = f"📱 Выберите приложение для <b>{os_names.get(os_key, os_key)}</b>:"

    await call.message.edit_text(text, reply_markup=_kb_apps(apps, back="inst_os"))
    await call.answer()


# ------------------------------------------------------------------ #
#  Уровень 3 — Текст инструкции                                       #
# ------------------------------------------------------------------ #

@router.callback_query(F.data.startswith("inst_app_"))
async def show_instruction(call: CallbackQuery) -> None:
    text = _INSTRUCTIONS.get(call.data)
    if not text:
        await call.answer("Инструкция не найдена.", show_alert=True)
        return

    await call.message.edit_text(
        text,
        reply_markup=_kb_back_to_os(),
        disable_web_page_preview=True,
    )
    await call.answer()
