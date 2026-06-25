/**
 * Веб-поиск для Стадии 1 (источник кейсов) — провайдер-независимый шаг,
 * отделённый от LLM-клиента (llm.ts). Текущая модель (openmodel и пр.) остаётся
 * без изменений: поиск даёт РЕАЛЬНЫЕ результаты (заголовок/URL/сниппет), а модель
 * уже извлекает из них кейсы и проставляет настоящую ссылку в source.
 *
 * Провайдер выбирается через SEARCH_PROVIDER:
 *  - 'tavily' (по умолчанию) — Tavily Search API (https://api.tavily.com/search).
 *    Ключ TAVILY_API_KEY (Bearer). Если ключа нет — пробуем keyless-режим Tavily
 *    (заголовок X-Tavily-Access-Mode: keyless) — для быстрого старта без регистрации.
 *  - 'none' — поиск выключен; Стадия 1 откатывается на LLM-синтез (как было раньше).
 */

const TAVILY_URL = 'https://api.tavily.com/search';

/** Единый результат поиска, который видит стадия. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getProvider(): 'tavily' | 'none' {
  const p = (process.env.SEARCH_PROVIDER || 'tavily').toLowerCase();
  return p === 'none' ? 'none' : 'tavily';
}

/** true, если веб-поиск включён (провайдер не 'none'). */
export function isSearchEnabled(): boolean {
  return getProvider() !== 'none';
}

/** Нормализует разнобой полей ответа Tavily (url/link, content/snippet/raw_content). */
function normalize(r: any): SearchResult | null {
  const url = (r?.url ?? r?.link ?? '').toString().trim();
  const title = (r?.title ?? '').toString().trim();
  const snippet = (r?.content ?? r?.snippet ?? r?.raw_content ?? '').toString().trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { title: title || url, url, snippet };
}

export interface SearchOptions {
  startDate?: string;
  endDate?: string;
  includeDomains?: string[];
}

/** Один запрос к Tavily с мягким бэкоффом на 429. Ошибки не валят стадию — возвращаем []. */
async function tavilySearch(
  query: string,
  maxResults: number,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  else headers['X-Tavily-Access-Mode'] = 'keyless'; // старт без ключа (ограниченный режим)

  const bodyParams: Record<string, any> = {
    query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
  };

  if (options?.startDate) bodyParams.start_date = options.startDate;
  if (options?.endDate) bodyParams.end_date = options.endDate;
  if (options?.includeDomains && options.includeDomains.length > 0) {
    bodyParams.include_domains = options.includeDomains;
  }

  const body = JSON.stringify(bodyParams);

  const RETRIES = 2;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(TAVILY_URL, { method: 'POST', headers, body });
    } catch {
      return []; // сеть недоступна — мягкая деградация
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      const list = Array.isArray(data?.results) ? data.results : [];
      return list.map(normalize).filter((x: SearchResult | null): x is SearchResult => x != null);
    }
    if (res.status === 429 && attempt < RETRIES) {
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
      continue;
    }
    return []; // прочие ошибки/исчерпанные ретраи — мягко возвращаем пусто
  }
}

/**
 * Поиск по запросу. Возвращает до maxResults реальных результатов.
 * При выключенном провайдере или сбое — пустой массив (стадия решает, что делать).
 */
export async function webSearch(
  query: string,
  maxResults = 4,
  options?: SearchOptions
): Promise<SearchResult[]> {
  if (getProvider() === 'none') return [];
  return tavilySearch(query, maxResults, options);
}
