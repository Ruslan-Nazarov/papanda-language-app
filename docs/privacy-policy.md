# Политика конфиденциальности — papanda

_Последнее обновление: 8 сентября 2026 г._

Приложение **papanda** (пакет `com.papanda.app`, далее — «Приложение») — это инструмент
для изучения языков. Настоящая политика описывает, какие данные Приложение обрабатывает.
Разработчик — частное лицо, контакт: **runaz2007@gmail.com**.

## Коротко

- Приложение **не собирает** персональные данные: ни имя, ни email, ни номер телефона,
  ни точную геолокацию.
- В Приложении **нет** рекламы, аналитики, трекеров и SDK третьих сторон для отслеживания.
- Ваш словарь, прогресс обучения и статистика хранятся **только на вашем устройстве**.
- Для генерации и разбора учебных предложений короткие тексты (слова и предложения)
  отправляются через наш прокси-сервер в облачный сервис Google Gemini.

## Какие данные хранятся на устройстве

Приложение сохраняет локально (в хранилище приложения на телефоне):

- добавленные вами слова и переводы;
- отметки «знаю / не знаю», счётчики показов, даты последнего повторения;
- рассчитанную статистику и ежедневные снимки индекса запоминания;
- пользовательские настройки.

Эти данные **не передаются** нам и никуда не загружаются автоматически. Они удаляются
при удалении Приложения. Вы можете вручную экспортировать их в файл и импортировать
обратно (функция «Экспорт / импорт прогресса» в настройках) — этот файл создаётся и
хранится там, куда вы его сохраните; мы к нему доступа не имеем.

## Какие данные покидают устройство

Для функций генерации учебных предложений и объяснения их структуры Приложение
отправляет запрос на наш промежуточный сервер (Cloudflare Worker), который пересылает
его в **Google Gemini API**. В запросе передаются:

- текст задания для модели: изучаемый язык, несколько слов из вашего активного словаря
  и/или предложение, которое нужно разобрать;
- случайный идентификатор установки (UUID, генерируется на устройстве) — используется
  только для ограничения частоты запросов и защиты от злоупотреблений. Он не привязан
  к вашей личности, аккаунту или устройству и не используется для рекламы или аналитики.

Промежуточный сервер не ведёт журналов содержимого запросов на постоянной основе и
хранит только счётчики количества запросов по идентификатору установки (сбрасываются
по времени). Обработка данных на стороне Google регулируется условиями
[Google APIs Terms of Service](https://developers.google.com/terms) и
[Google Privacy Policy](https://policies.google.com/privacy).

Приложению требуется разрешение «Интернет» исключительно для этих запросов.

## AI-генерируемый контент

Учебные предложения и объяснения создаются языковой моделью и могут содержать неточности.
Они предназначены только для учебных целей.

## Дети

Приложение не предназначено для детей младше 13 лет и не собирает намеренно данные детей.

## Изменения политики

При изменении политики обновляется дата в начале документа. Существенные изменения будут
отражены в описании обновления Приложения.

## Контакты

По вопросам о данных: **runaz2007@gmail.com**

---

# Privacy Policy — papanda

_Last updated: 8 September 2026_

**papanda** (package `com.papanda.app`, the "App") is a language-learning tool. This policy
explains what data the App processes. The developer is an individual; contact:
**runaz2007@gmail.com**.

## Summary

- The App does **not** collect personal data — no name, email, phone number, or precise
  location.
- The App contains **no** ads, analytics, tracking, or third-party tracking SDKs.
- Your vocabulary, learning progress, and statistics are stored **only on your device**.
- To generate and analyse practice sentences, short texts (words and sentences) are sent
  through our proxy server to the Google Gemini cloud service.

## Data stored on your device

The App stores locally (in the app's storage on your phone):

- words and translations you add;
- "known / unknown" marks, view counters, last-review dates;
- computed statistics and daily memory-index snapshots;
- app settings.

This data is **never** sent to us or uploaded automatically. It is removed when you
uninstall the App. You can manually export it to a file and import it back ("Export /
import progress" in settings) — that file is stored wherever you choose to save it and
we have no access to it.

## Data that leaves your device

For sentence generation and structure-explanation features, the App sends a request to
our intermediary server (a Cloudflare Worker), which forwards it to the **Google Gemini
API**. The request contains:

- the task text for the model: the language being studied, a few words from your active
  vocabulary, and/or a sentence to analyse;
- a random installation identifier (a UUID generated on the device) — used only for rate
  limiting and abuse prevention. It is not linked to your identity, account, or device
  and is not used for advertising or analytics.

The intermediary server does not persistently log request contents; it stores only
per-installation request counters that reset over time. Google's processing is governed
by the [Google APIs Terms of Service](https://developers.google.com/terms) and the
[Google Privacy Policy](https://policies.google.com/privacy).

The App requests the "Internet" permission solely for these requests.

## AI-generated content

Practice sentences and explanations are produced by a language model and may contain
inaccuracies. They are for learning purposes only.

## Children

The App is not directed to children under 13 and does not knowingly collect children's data.

## Changes

If this policy changes, the date at the top is updated. Material changes will be noted in
the App's update description.

## Contact

Data questions: **runaz2007@gmail.com**
