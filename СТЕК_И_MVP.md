# Стек и структура MVP

## Решения
- **Язык:** TypeScript (один язык для backend и редактора, близко к JS из n8n).
- **Backend:** Node 26 + Fastify, SQLite (`better-sqlite3`) — локально, без внешней БД и без Google Sheets.
- **Frontend:** React + Vite + Tailwind — автономный внутренний редактор.
- **LLM:** OpenRouter (OpenAI-совместимый API), **бесплатная модель** (`*:free`), ключ в `.env`.
- **Оркестрация:** внутренний конвейер стадий, состояние колоды в SQLite (резюмируемо).
- **Каркас «Я»/«МЫ»:** фиксированные константы (`framework.ts`) — 6 типов контента + 6 лучей ЗВЕЗДА, по 6 паттернов, гаммы, лимиты.

## Структура
```
carty/
  server/                # backend
    src/
      framework.ts       # фикс-каркас: типы Я, лучи МЫ, паттерны, гаммы, лимиты
      types.ts           # DeckProfile, Case, Card
      db.ts              # SQLite
      llm.ts             # OpenRouter клиент + JSON/retry
      stages/profiler.ts # Стадия 0
      index.ts           # Fastify сервер + API
    .env.example
  web/                   # React редактор (далее)
  *.md, _*.txt/json      # анализ и артефакты
```

## API (MVP, стадия 0)
- `POST /api/decks` `{theme, notes}` → создать колоду
- `GET  /api/decks` → список
- `GET  /api/decks/:id` → колода + профиль
- `POST /api/decks/:id/profile` → запустить Профайлер (стадия 0)
- `PUT  /api/decks/:id/profile` → сохранить правки профиля (ревизия человеком)
- `POST /api/decks/:id/profile/freeze` → заморозить профиль

## Бесплатный ключ OpenRouter
1. Регистрация на https://openrouter.ai → раздел Keys → Create Key (бесплатно).
2. Положить в `server/.env`: `OPENROUTER_API_KEY=sk-or-...`
3. Модель по умолчанию: `OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free` (можно сменить).

## Дальнейшие шаги (после стадии 0)
Стадии 1–3 (источник кейсов → валидация → карты), затем промпты изображений и Figma.
