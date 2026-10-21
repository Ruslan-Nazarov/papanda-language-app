# Политика конфиденциальности — papanda

_Последнее обновление: 21 октября 2026 г._

Papanda (com.papanda.app) — приложение для изучения языков. Контакт разработчика: **runaz2007@gmail.com**.

## Данные на устройстве

Приложение не запрашивает имя, email, телефон или геолокацию для обучения.
Словарь, переводы, ассоциации, результаты тренировок и настройки сохраняются локально.
В приложении нет встроенной рекламной или поведенческой аналитики.

При импорте сохраняется одна локальная точка восстановления — состояние перед
последним импортом. Следующий импорт заменяет эту точку. Она, как и текущий
прогресс, может быть потеряна при удалении приложения. Файлы экспорта сохраняются
в выбранном вами месте; их доступность и резервирование зависят от выбранного
хранилища. Приложение не синхронизирует весь прогресс с нашим сервером.

## AI и передача текстов

Собственные тексты для чтения, позиция чтения, готовые разборы и результаты
самостоятельного выбора членов предложения хранятся на устройстве и включаются
в экспорт прогресса. Сохранение текста само по себе не отправляет его ИИ.
Кнопки разбора, уточнения маркеров, развития и сравнения языков отправляют выбранное
предложение, его разметку и при необходимости указанную вами деталь. Остальная
часть сохранённого текста в эти запросы не включается.

Если AI подключён, запросы проходят через Cloudflare Worker в **Google Gemini,
Cerebras или Groq**, в зависимости от серверной настройки. При ошибке основного
провайдера тот же запрос может быть направлен резервному провайдеру.

Передаются язык, учебные слова и их переводы, предложения, разметка и инструкции
для генерации или объяснения. Проверка слов и подготовка предложений могут
запускаться в фоне при использовании приложения. Поэтому часть словаря может
передаваться без отдельного нажатия на AI-кнопку. Весь файл прогресса
в эти запросы не включается. Не вводите в учебные тексты сведения,
которые не хотите передавать AI-провайдерам.

Прокси получает случайный идентификатор установки для ограничения запросов;
он не является авторизацией. В Durable Object сохраняются счётчики по этому
идентификатору. Код прокси не сохраняет содержимое запросов в собственной базе.
Cloudflare и AI-провайдеры обрабатывают технические данные соединений по своим
правилам. Сроки хранения и использование AI-текстов зависят от провайдера,
тарифа и серверной конфигурации; единое обещание об отсутствии хранения или
обучения моделей на этих текстах не даётся.

Правила провайдеров: [Gemini API](https://ai.google.dev/gemini-api/terms),
[Cerebras](https://www.cerebras.ai/privacy-policy),
[Groq](https://groq.com/privacy-policy),
[Cloudflare](https://www.cloudflare.com/privacypolicy/).

Отмена генерации прекращает ожидание и следующие попытки в приложении. Она
не отзывает текст, уже переданный провайдеру, и не гарантирует отмену его обработки.
Встроенные предложения и словарь доступны без AI.

## Озвучивание

По нажатию «Слушать» или «Медленно» текст передаётся системному синтезатору речи
устройства или браузера. Papanda не отправляет его через свой AI-прокси для
озвучивания. Наличие голосов и работа без сети зависят от системы и выбранного
голоса; некоторые системные движки могут использовать сетевые сервисы.

## Учебный контент и возрастные ограничения

AI-разборы могут содержать ошибки. Для AI-сервисов действуют также возрастные
и региональные ограничения выбранных провайдеров, указанные в их условиях.

## Изменения и контакт

Дата обновления указывается в начале политики. Вопросы о данных:
**runaz2007@gmail.com**.

# Privacy Policy — papanda

_Last updated: 21 October 2026_

Papanda (com.papanda.app) is a language-learning app. Developer contact: **runaz2007@gmail.com**.

## Local data

The app does not request a name, email address, phone number or location for
learning. Vocabulary, translations, associations, study results and settings
are stored locally. The app has no embedded advertising or behavioural analytics.

An import saves one local recovery point containing the state before that import.
The next import replaces this point. Uninstalling the app may remove both current
progress and the recovery point. Exported files are stored wherever you choose;
availability and backup depend on that storage provider. The app does not sync
the entire progress file to our server.

## AI requests

Personal reading texts, reading position, saved annotations and sentence-analysis
results are stored locally and included in progress exports. Saving a text alone
does not send it to AI. Analysis, marker, development and comparison buttons send
the selected sentence, its annotation and any requested detail. The rest of the
saved reading text is not included in these requests.

When configured, AI requests go through a Cloudflare Worker to **Google Gemini,
Cerebras or Groq**. Server settings select the provider; a failed request may
be forwarded to a fallback provider.

Requests include the language, practice words and translations, sentences,
annotations and instructions for generation or explanation. Word checks and
sentence preparation may run in the background while you use the app, without
a separate AI button press. The full progress file is not included.
Do not put information you do not want to share with AI providers
in your practice texts.

The proxy receives a random installation identifier for request quotas, not
authentication. A Durable Object stores counters associated with that identifier.
The proxy code does not store prompt content in its own database. Cloudflare and
AI providers process connection metadata according to their policies. Retention
and use of AI content depend on the provider, plan and server configuration;
there is no blanket promise that content is never retained or used for training.

Provider information: [Gemini API](https://ai.google.dev/gemini-api/terms),
[Cerebras](https://www.cerebras.ai/privacy-policy),
[Groq](https://groq.com/privacy-policy),
[Cloudflare](https://www.cloudflare.com/privacypolicy/).

Cancelling stops client waiting and subsequent attempts. It does not recall
content already sent or guarantee that provider processing is cancelled.
Bundled vocabulary and sentences work without AI.

## Speech

Listen and Slow send the selected text to the device or browser speech engine.
Papanda does not send it through its AI proxy for speech. Voices and offline
availability depend on the system; some speech engines may use network services.

## Learning content and age restrictions

AI explanations may be incorrect. AI services are also subject to the selected provider's age and
regional restrictions in its terms.

## Changes and contact

The update date appears above. Data questions: **runaz2007@gmail.com**.
