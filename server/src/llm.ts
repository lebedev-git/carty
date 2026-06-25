/**
 * Клиент OpenRouter (OpenAI-совместимый API).
 * - chat(): обычный текстовый ответ.
 * - chatJSON(): надёжный JSON — извлечение + валидация + авто-ретрай.
 *
 * Заземляет «хрупкий парсинг» текущей системы: вместо JSON.parse + «хирургии»
 * битого вывода мы извлекаем JSON и при неудаче переспрашиваем модель.
 */

import { spawn } from 'node:child_process';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Провайдер LLM:
 *  - 'openrouter' (по умолчанию) — HTTP к OpenRouter (см. callModel/chat ниже);
 *  - 'claude-cli' — локальный официальный клиент Claude Code в headless-режиме
 *    (`claude -p`). Шлюз Claude Code пропускает только официальный клиент, поэтому
 *    прямые HTTP-запросы к нему дают 403 — а дочерний процесс CLI работает.
 *    Требует установленного и залогиненного `claude` на машине сервера.
 */
const PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();

/** Бесплатные модели нестабильны — держим короткую запасную цепочку по умолчанию. */
const DEFAULT_MODELS = ['nvidia/nemotron-nano-9b-v2:free'];
/** Сколько раз ждать и повторять на 429 для ОДНОЙ модели, прежде чем перейти к следующей. */
const RATE_LIMIT_RETRIES = 2;
/** Потолок ожидания между ретраями (мс), чтобы не зависать надолго. */
const MAX_BACKOFF_MS = 12_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY не задан. Создай server/.env по образцу .env.example.'
    );
  }
  // Приоритет: список OPENROUTER_MODELS (через запятую) → одиночный OPENROUTER_MODEL → дефолт.
  const raw = process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL || '';
  const models = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return { apiKey, models: models.length ? models : DEFAULT_MODELS };
}

/** Достаёт паузу из ответа 429: заголовок Retry-After или metadata.retry_after_seconds. */
function parseRetryAfterMs(text: string, headers: Headers): number | null {
  const h = headers.get('retry-after');
  if (h && !Number.isNaN(Number(h))) return Number(h) * 1000;
  try {
    const j = JSON.parse(text) as any;
    const meta = j?.error?.metadata;
    const s = meta?.retry_after_seconds ?? meta?.headers?.['Retry-After'];
    if (s != null && !Number.isNaN(Number(s))) return Number(s) * 1000;
  } catch {
    /* тело не JSON — игнорируем */
  }
  return null;
}

type ModelResult =
  | { ok: true; content: string }
  | { ok: false; status: number; text: string; retryable: boolean };

/** Один вызов конкретной модели с бэкоффом на 429. */
async function callModel(
  apiKey: string,
  model: string,
  body: Record<string, unknown>
): Promise<ModelResult> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Carty Deck Factory',
      },
      body: JSON.stringify({ ...body, model }),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        return { ok: false, status: 200, text: 'пустой ответ модели', retryable: true };
      }
      return { ok: true, content };
    }

    const text = await res.text();
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = Math.min(
        parseRetryAfterMs(text, res.headers) ?? 1000 * 2 ** attempt,
        MAX_BACKOFF_MS
      );
      await sleep(wait);
      continue;
    }
    // 401/402/403 — проблема аккаунта/ключа: перебирать другие модели бессмысленно.
    const fatal = res.status === 401 || res.status === 402 || res.status === 403;
    return { ok: false, status: res.status, text: text.slice(0, 400), retryable: !fatal };
  }
}

// --- Провайдер claude-cli: запуск официального клиента Claude Code как процесса ---

/** Имя/путь бинаря и модель для headless-режима. Модель — алиас (`haiku`) или полный id. */
function getCliConfig() {
  return {
    bin: process.env.CLAUDE_CLI_BIN || 'claude',
    model: process.env.CLAUDE_CLI_MODEL || 'haiku',
    timeoutMs: Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 180_000,
  };
}

/**
 * Сводит наш диалог к одному prompt-строке для stdin `claude -p`.
 * Весь текст (включая system) идёт через stdin, а НЕ через аргументы: на Windows
 * процесс запускается с shell, и динамические аргументы со спецсимволами/переводами
 * строк передавались бы в шелл без экранирования (DEP0190) — это ненадёжно.
 * При ретрае chatJSON предыдущий ответ ассистента помечается явно, чтобы модель
 * видела свою ошибку и замечание к ней.
 */
function buildCliPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'system') return `[Системная инструкция]:\n${m.content}`;
      if (m.role === 'assistant') return `[Твой предыдущий ответ]:\n${m.content}`;
      return m.content;
    })
    .join('\n\n');
}

/** Один вызов headless Claude Code. Промпт целиком идёт в stdin. */
function callClaudeCli(messages: ChatMessage[]): Promise<string> {
  const { bin, model, timeoutMs } = getCliConfig();

  // Только статические аргументы (безопасны при shell на Windows). Без инструментов и MCP.
  const args = [
    '-p',
    '--model', model,
    '--output-format', 'json',
    '--allowedTools', '',
    '--strict-mcp-config',
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // На Windows `claude` может быть .cmd — shell обеспечивает разрешение имени.
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude-cli: таймаут ${timeoutMs} мс`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`claude-cli: не удалось запустить «${bin}» — ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(
          new Error(`claude-cli: код выхода ${code}. ${stderr.slice(0, 400) || stdout.slice(0, 400)}`)
        );
      }
      try {
        const env = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
        if (env.is_error) throw new Error('is_error=true');
        if (typeof env.result !== 'string' || !env.result.trim()) {
          throw new Error('пустое поле result');
        }
        resolve(env.result);
      } catch (e) {
        reject(
          new Error(
            `claude-cli: не разобрал ответ — ${e instanceof Error ? e.message : String(e)}`
          )
        );
      }
    });

    child.stdin.write(buildCliPrompt(messages));
    child.stdin.end();
  });
}

// --- Провайдер openmodel: Anthropic Messages API (НЕ OpenAI-совместим) ---

/** Конфиг openmodel. Ключ — секрет из .env, модель/потолок вывода настраиваемы. */
function getOpenModelConfig() {
  const apiKey = process.env.OPENMODEL_API_KEY;
  if (!apiKey) {
    throw new Error('OPENMODEL_API_KEY не задан. См. server/.env.');
  }
  const base = (process.env.OPENMODEL_BASE_URL || 'https://api.openmodel.ai/v1').replace(/\/+$/, '');
  return {
    apiKey,
    url: `${base}/messages`,
    model: process.env.OPENMODEL_MODEL || 'deepseek-v4-flash',
    // Потолок вывода: DeepSeek-V4-Flash — ризонер, его блок thinking тоже тратит max_tokens,
    // поэтому держим запас, чтобы текстовый ответ (большой JSON карт) не обрезался.
    maxTokens: Number(process.env.OPENMODEL_MAX_TOKENS) || 8192,
  };
}

/**
 * Склеивает текст из ответа Anthropic Messages: берём только блоки type:"text".
 * Ризонер дополнительно шлёт блок type:"thinking" — его игнорируем.
 */
function extractAnthropicText(data: any): string {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('');
}

/** Один вызов OpenModel (Anthropic-формат) с бэкоффом на 429 (фритир ~10 rpm). */
async function callOpenModel(
  messages: ChatMessage[],
  opts: { temperature?: number } = {}
): Promise<string> {
  const { apiKey, url, model, maxTokens } = getOpenModelConfig();
  // Anthropic-формат: system — отдельным полем, в messages только user/assistant.
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const msgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages: msgs };
  if (system) body.system = system;
  if (opts.temperature != null) body.temperature = opts.temperature;

  const OM_RETRIES = 3;
  const OM_MAX_BACKOFF_MS = 20_000;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const text = extractAnthropicText(data);
      if (!text.trim()) throw new Error('openmodel: пустой text в ответе модели');
      return text;
    }

    const text = await res.text();
    if (res.status === 429 && attempt < OM_RETRIES) {
      const wait = Math.min(parseRetryAfterMs(text, res.headers) ?? 1000 * 2 ** attempt, OM_MAX_BACKOFF_MS);
      await sleep(wait);
      continue;
    }
    throw new Error(`openmodel ${res.status}: ${text.slice(0, 300)}`);
  }
}

export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; jsonMode?: boolean } = {}
): Promise<string> {
  // Режим claude-cli: temperature/jsonMode не применимы (управляются клиентом);
  // надёжность JSON обеспечивает chatJSON → extractJSON ниже по стеку.
  if (PROVIDER === 'claude-cli') {
    return callClaudeCli(messages);
  }
  if (PROVIDER === 'openmodel') {
    return callOpenModel(messages, { temperature: opts.temperature });
  }

  const { apiKey, models } = getConfig();
  const body: Record<string, unknown> = {
    messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const errors: string[] = [];
  for (const model of models) {
    const r = await callModel(apiKey, model, body);
    if (r.ok) return r.content;
    errors.push(`${model} → ${r.status}: ${r.text}`);
    if (!r.retryable) break; // фатальная ошибка (ключ/кредиты) — нет смысла продолжать
  }
  throw new Error(`OpenRouter: ни одна модель не ответила. ${errors.join(' | ')}`);
}

/** Достаёт первый сбалансированный JSON-объект/массив из текста модели. */
export function extractJSON(raw: string): unknown {
  let s = raw.trim();
  // Снять markdown-обёртки ```json ... ```
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Прямая попытка
  try {
    return JSON.parse(s);
  } catch {
    /* ниже — поиск сбалансированного фрагмента */
  }
  const start = s.search(/[[{]/);
  if (start === -1) throw new Error('JSON не найден в ответе модели');
  const open = s[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const frag = s.slice(start, i + 1);
        return JSON.parse(frag);
      }
    }
  }
  throw new Error('Не удалось извлечь сбалансированный JSON');
}

/**
 * Запросить у модели JSON с авто-ретраем.
 * validate() может бросить ошибку — тогда модели передаётся замечание и она повторяет.
 */
export async function chatJSON<T = unknown>(
  messages: ChatMessage[],
  opts: { temperature?: number; retries?: number; validate?: (v: unknown) => T } = {}
): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  const convo = [...messages];

  for (let attempt = 0; attempt <= retries; attempt++) {
    let raw = '';
    try {
      raw = await chat(convo, { temperature: opts.temperature ?? 0.6, jsonMode: true });
      const parsed = extractJSON(raw);
      return opts.validate ? opts.validate(parsed) : (parsed as T);
    } catch (err) {
      lastErr = err;
      // Подсунуть модели её ответ + замечание и попросить исправить
      convo.push({ role: 'assistant', content: raw.slice(0, 4000) });
      convo.push({
        role: 'user',
        content:
          'Твой ответ не прошёл проверку: ' +
          (err instanceof Error ? err.message : String(err)) +
          '. Верни ИСПРАВЛЕННЫЙ ответ — строго валидный JSON, без markdown-обёрток и текста вокруг.',
      });
    }
  }
  throw new Error(
    'chatJSON не дал валидный результат после ретраев: ' +
      (lastErr instanceof Error ? lastErr.message : String(lastErr))
  );
}
