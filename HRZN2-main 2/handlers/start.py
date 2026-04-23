"""
handlers/start.py — обработчики /start и принятия условий.
Реализует юридический онбординг и запуск реферальной цепочки.
"""
import logging

from aiogram import F, Router
from aiogram.filters import CommandStart
from aiogram.types import CallbackQuery, Message

from database import db
from keyboards import main_menu_keyboard, terms_keyboard
from config import settings

logger = logging.getLogger(__name__)
router = Router(name="start")

WELCOME_TEXT = (
    "<code>...Инициализация системы... Доступ разрешен.</code>\n\n"
    "🔌 <b>Добро пожаловать в HRZN2.</b>\n\n"
    "Твой зашифрованный, скоростной и неуязвимый портал в свободный интернет. Нулевой цифровой след и бронированный канал связи — теперь это твой стандарт.\n\n"
    "Управление нейролинком и контрактом — на консоли ниже.\n\n"
    "Включайся. 🦾"
)

TERMS_TEXT = (
    "👋 Привет! Прежде чем начать, ознакомься с нашими документами.\n\n"
    "Нажми на кнопки ниже, чтобы прочитать их, и затем «✅ Принять условия»."
)

RULES_TEXT = (
    "📋 <b>Правила сервиса «HRZN2»</b>\n\n"
    "<b>1. Общие положения</b>\n"
    "Сервис предоставляет услуги доступа к виртуальной частной сети (VPN) по принципу «как есть». Мы стремимся к максимальной стабильности, но не гарантируем 100% аптайм в случае форс-мажорных обстоятельств или глобальных блокировок со стороны магистральных провайдеров.\n\n"
    "<b>2. Запрещенная деятельность</b>\n"
    "Пользователям строго запрещено использовать ресурсы HRZN2 для:\n"
    "• Рассылки спама (e-mail, мессенджеры);\n"
    "• Совершения DDoS-атак и попыток взлома любых ресурсов;\n"
    "• Распространения вредоносного ПО и фишинга;\n"
    "• Доступа к материалам, нарушающим законодательство вашей страны или страны расположения сервера.\n\n"
    "<b>3. Подписки и оплата</b>\n"
    "Активация подписки (1, 6 или 12 месяцев) происходит автоматически после подтверждения транзакции в Telegram Stars или Crypto Pay.\n"
    "Демо-режим предоставляется один раз на один аккаунт. Попытки обхода этого ограничения (мультиаккаунты) могут привести к блокировке всех связанных профилей.\n\n"
    "<b>4. Реферальная программа</b>\n"
    "Бонусные дни за приглашение друзей начисляются только после того, как приглашенный пользователь подтвердит согласие с данными правилами.\n"
    "Злоупотребление реферальной системой (использование ботов, самореферальство) является нарушением и ведет к обнулению бонусного баланса.\n\n"
    "<b>5. Ответственность и блокировка</b>\n"
    "Администрация оставляет за собой право приостановить доступ к сервису без возврата средств при обнаружении аномальной активности, создающей угрозу стабильности серверов.\n"
    "Пользователь несет единоличную ответственность за действия, совершенные с использованием его учетной записи и VPN-ключа в рамках HRZN2.\n\n"
    "<b>6. Техническая поддержка</b>\n"
    "Все вопросы по работе сервиса, настройке подключения или проблемам с оплатой принимаются через официальный канал поддержки: @your_support_account.\n\n"
    "<i>Нажимая кнопку «Принять условия», вы подтверждаете, что полностью прочитали и согласны с вышеуказанными правилами.</i>"
)

PRIVACY_TEXT = (
    "🔒 <b>ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ ПО РАБОТЕ С ПЕРСОНАЛЬНЫМИ ДАННЫМИ ПОЛЬЗОВАТЕЛЕЙ</b>\n\n"
    "<b>1. ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ</b>\n"
    "<b>Персональные данные</b> - любая информация, относящаяся к определенному физическому лицу. К такой информации, в частности, можно отнести номер телефона, адрес электронной почты и другую информацию.\n"
    "<b>Обработка персональных данных</b> – любое действие (операция) осуществленное с персональными данными.\n"
    "<b>Конфиденциальность</b> - обязательное требование надлежаще соблюдать правила обработки данных, не допускать их распространения без согласия пользователя.\n"
    "<b>Использование данных</b> - действия с персональными данными, направленные на предоставление доступа к сервису.\n"
    "<b>Оператор</b> - Компания, осуществляющая обработку персональных данных пользователей.\n"
    "<b>Пользователь</b> - посетитель сервиса.\n\n"
    "<b>2. ПРАВА И ОБЯЗАННОСТИ</b>\n"
    "<b>2.1. Оператор имеет право:</b> получать достоверную информацию; продолжить обработку (при наличии законных оснований) в случае отзыва согласия пользователем.\n"
    "<b>2.2. Оператор обязан:</b> организовывать обработку в соответствии с законодательством РФ; удалять и прекращать передачу данных в установленном законом порядке.\n"
    "<b>2.3. Пользователи имеют право:</b> получать информацию о своих данных; требовать уточнения, блокировки или уничтожения данных.\n"
    "<b>2.4. Пользователи обязаны:</b> предоставлять достоверные данные и сообщать об их обновлениях.\n\n"
    "<b>3. ПРИНЦИПЫ ОБРАБОТКИ ПЕРСОНАЛЬНЫХ ДАННЫХ</b>\n"
    "Обработка осуществляется на законной основе. Допускается обработка только тех данных, которые необходимы для предоставления сервиса. Хранение осуществляется не дольше, чем этого требуют цели обработки.\n\n"
    "<b>4. ЦЕЛИ ОБРАБОТКИ ПЕРСОНАЛЬНЫХ ДАННЫХ</b>\n"
    "Информирование Пользователя и предоставление доступа к сервису.\n\n"
    "<b>5. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ</b>\n"
    "Любые изменения политики отражаются в данном документе. Политика действует бессрочно до замены ее новой версией."
)

AGREEMENT_TEXT = (
    "📝 <b>Пользовательское соглашение (Публичная оферта)</b>\n\n"
    "<b>1. Термины и определения</b>\n"
    "<b>Оферта</b> – настоящее Пользовательское соглашение.\n"
    "<b>Сервис</b> – Telegram-бот @HRZN2_bot, предназначенный для предоставления доступа к VPN.\n"
    "<b>Пользователь</b> – физическое лицо, принявшее Оферту.\n"
    "<b>Услуга</b> – предоставление доступа к ВПН.\n"
    "<b>Акцепт</b> – совершение Пользователем оплаты.\n\n"
    "<b>2. Предмет Оферты</b>\n"
    "Исполнитель обязуется предоставить доступ к VPN, а Пользователь – оплатить его. Сервис не аффилирован с Telegram FZ-LLC.\n\n"
    "<b>3. Порядок оплаты</b>\n"
    "Стоимость определяется в боте. Оплата производится через Telegram Stars или Crypto Pay в режиме 100% предоплаты. Выдача ключа происходит автоматически после подтверждения оплаты.\n\n"
    "<b>4. Условия возврата</b>\n"
    "После успешной генерации и выдачи VPN-ключа услуга считается оказанной, возврат средств не производится. Возврат/перерасчет возможны только при технических сбоях (оплата списана, но услуга не зачислена).\n\n"
    "<b>5. Права и обязанности</b>\n"
    "Исполнитель обязуется предоставить Услугу и обеспечивать работу Сервиса. Пользователь обязан использовать VPN законно и соблюдать правила сервиса.\n\n"
    "<b>6. Ответственность и форс-мажор</b>\n"
    "Стороны освобождаются от ответственности при форс-мажоре. К нему относятся глобальные сбои интернета, сбои платформы Telegram и блокировки сервисов государственными органами.\n\n"
    "<b>7. Разрешение споров</b>\n"
    "Все споры решаются через официальную службу поддержки. В случае невозможности – в порядке, установленном законодательством.\n\n"
    "<b>8. Срок действия</b>\n"
    "Оферта действует с момента публикации и акцепта."
)


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """
    Обрабатывает /start.
    Парсит реферальный deep-link (?start=ref<user_id>),
    создаёт пользователя если нет, показывает онбординг или меню.
    """
    user = message.from_user
    args = message.text.split(maxsplit=1)
    deep_link = args[1] if len(args) > 1 else ""

    # Парсим реферала: ожидаем формат ref<user_id>
    referrer_id: int | None = None
    if deep_link.startswith("ref"):
        try:
            referrer_id = int(deep_link[3:])
            # Нельзя быть рефералом самого себя
            if referrer_id == user.id:
                referrer_id = None
        except ValueError:
            referrer_id = None

    # Создаём пользователя (ON CONFLICT DO NOTHING — идемпотентно)
    new_user = await db.create_user(
        user_id=user.id,
        username=user.username,
        referrer_id=referrer_id,
    )

    if new_user:
        logger.info(f"New user registered: {user.id}")
        username_str = f"@{user.username}" if user.username else "Нет юзернейма"
        ref_text = f"\nРеферал: <code>{referrer_id}</code>" if referrer_id else ""
        notify_text = (
            f"🌟 <b>Новый лид (пользователь) в боте!</b>\n"
            f"ID: <code>{user.id}</code>\n"
            f"User: {username_str}{ref_text}"
        )
        
        # Уведомляем группу, если есть
        if settings.admin_group_id:
            try:
                await message.bot.send_message(settings.admin_group_id, notify_text, parse_mode="HTML")
            except Exception as e:
                logger.error(f"Failed to notify admin group: {e}")
        # Иначе уведомляем тех админов, кого сможем
        elif settings.admin_ids:
            for adm_id in settings.admin_ids:
                try:
                    await message.bot.send_message(adm_id, notify_text, parse_mode="HTML")
                except Exception as e:
                    logger.error(f"Failed to notify admin {adm_id}: {e}")

    db_user = await db.get_user(user.id)

    if not db_user or not db_user["agreed_to_terms"]:
        await message.answer(TERMS_TEXT, reply_markup=terms_keyboard(), parse_mode="HTML")
    else:
        await message.answer(WELCOME_TEXT, reply_markup=main_menu_keyboard(), parse_mode="HTML")


@router.callback_query(F.data == "show_rules")
async def cb_show_rules(callback: CallbackQuery) -> None:
    """Показывает правила сервиса прямо в боте."""
    await callback.message.edit_text(  # type: ignore[union-attr]
        RULES_TEXT,
        reply_markup=terms_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(F.data == "show_privacy")
async def cb_show_privacy(callback: CallbackQuery) -> None:
    """Показывает политику конфиденциальности прямо в боте."""
    await callback.message.edit_text(  # type: ignore[union-attr]
        PRIVACY_TEXT,
        reply_markup=terms_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(F.data == "show_agreement")
async def cb_show_agreement(callback: CallbackQuery) -> None:
    """Показывает пользовательское соглашение прямо в боте."""
    await callback.message.edit_text(  # type: ignore[union-attr]
        AGREEMENT_TEXT,
        reply_markup=terms_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(F.data == "accept_terms")
async def cb_accept_terms(callback: CallbackQuery) -> None:
    """
    Пользователь нажал «Принять условия».
    Фиксируем принятие, начисляем реферальные дни пригласившему.
    """
    user_id = callback.from_user.id

    # Атомарная операция: принять условия + начислить реф. дни
    bonus_days = await db.accept_terms(user_id)

    # Уведомление для админов: Лид стал активным пользователем
    username_str = f"@{callback.from_user.username}" if callback.from_user.username else "Нет юзернейма"
    notify_text = (
        f"✅ <b>Пользователь принял условия!</b>\n"
        f"ID: <code>{user_id}</code>\n"
        f"User: {username_str}"
    )
    if bonus_days:
        notify_text += f"\n🎁 Начислено рефереру: <b>{bonus_days} дней</b>"

    if settings.admin_group_id:
        try:
            await callback.bot.send_message(settings.admin_group_id, notify_text, parse_mode="HTML")
        except Exception as e:
            logger.error(f"Failed to notify admin group about terms acceptance: {e}")

    await callback.message.edit_text(  # type: ignore[union-attr]
        WELCOME_TEXT,
        reply_markup=main_menu_keyboard(),
        parse_mode="HTML",
    )

    if bonus_days:
        # Уведомляем самого пользователя что он принят по реферальной ссылке
        logger.info("User %d accepted terms via referral, referrer got %d days.", user_id, bonus_days)

    await callback.answer("✅ Условия приняты!")


@router.callback_query(F.data == "menu_back")
async def cb_menu_back(callback: CallbackQuery) -> None:
    await callback.message.edit_text(  # type: ignore[union-attr]
        WELCOME_TEXT,
        reply_markup=main_menu_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()
