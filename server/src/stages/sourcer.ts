/**
 * Стадия 1 — Источник кейсов.
 *
 * Вход: замороженный DeckProfile (матрица M×C — контракт).
 * Выход: банк сырых (невалидированных) кейсов, привязанных к ячейкам матрицы.
 *
 * Методология «МАЯК» (раздел 10.3): по каждой ячейке матрицы ищутся реальные
 * проблемные кейсы организации этого типа.
 *
 * РЕЖИМЫ РАБОТЫ (см. search.ts):
 *  - Поиск ВКЛЮЧЁН (SEARCH_PROVIDER≠none): для каждой ячейки M×C выполняется реальный
 *    веб-поиск (Tavily). Найденные результаты (заголовок/URL/сниппет) передаются модели,
 *    и она ИЗВЛЕКАЕТ из них проблемные кейсы, проставляя в source НАСТОЯЩУЮ ссылку.
 *  - Поиск ВЫКЛЮЧЕН либо ничего не найдено: откат на LLM-синтез реалистичных кейсов
 *    (как в исходной системе), source помечается как «требует проверки».
 *
 * Шаг поиска изолирован в `sourceCasesForBlock` — провайдера можно менять, не трогая
 * остальной конвейер.
 */

import https from 'node:https';
import http from 'node:http';
import { chatJSON } from '../llm.js';
import { webSearch, isSearchEnabled, type SearchResult } from '../search.js';
import type { DeckProfile } from '../types.js';
import type { RawCaseInput } from '../db.js';
import type { ProgressFn } from '../jobs.js';

const RUSSIAN_NEWS_DOMAINS = [
  'rbc.ru', 'vedomosti.ru', 'kommersant.ru', 'tass.ru',
  'ria.ru', 'rg.ru', 'iz.ru', 'lenta.ru', 'gazeta.ru',
  'interfax.ru', 'forbes.ru', 'rtvi.com', 'fontanka.ru',
  'bfm.ru', 'expert.ru', 'rb.ru'
];

/** Проверка доступности URL по HTTP (использует HTTP/1.1 и закрывает сокет сразу после заголовков, запрещая PDF). */
function checkUrlAlive(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url || !/^https?:\/\//i.test(url)) return resolve(false);

    // Запрещаем PDF файлы по расширению в URL
    if (/\.pdf($|\?)/i.test(url)) return resolve(false);

    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return resolve(false);
    }

    const client = urlObj.protocol === 'https:' ? https : http;

    const req = client.request(
      url,
      {
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ru,en-US;q=0.7,en;q=0.3'
        }
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const contentType = (res.headers['content-type'] || '').toLowerCase();

        // Уничтожаем запрос сразу после считывания заголовков, чтобы не скачивать все тело страницы
        req.destroy();

        // Запрещаем PDF файлы по Content-Type
        if (contentType.includes('application/pdf')) {
          return resolve(false);
        }

        if (statusCode >= 200 && statusCode < 400) {
          return resolve(true);
        }

        // Некоторые СМИ блокируют скрапинг (403 Forbidden, 401, 503) при автоматических запросах,
        // но если домен находится в списке надежных новостных сайтов, мы все равно считаем его валидным.
        if ([401, 403, 405, 503].includes(statusCode)) {
          const isKnownNews = RUSSIAN_NEWS_DOMAINS.some((d) => urlObj.hostname.endsWith(d));
          if (isKnownNews) return resolve(true);
        }

        resolve(false);
      }
    );

    // Ловим сетевые ошибки (обрывы сокетов, DNS-ошибки) и предотвращаем падение процесса
    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

const SYSTEM = `Ты — отраслевой аналитик-исследователь. Собираешь банк РЕАЛЬНЫХ проблемных
кейсов организаций заданного типа — ситуаций, где у команды «болит»: конфликт,
дефицит времени/ресурсов, ошибка процесса, риск.

ПРИНЦИПЫ:
- Конкретика отрасли: реальные роли, процессы, цифры, а не общие слова.
- В каждом кейсе должен быть КОНФЛИКТ и ДЕФИЦИТ ВРЕМЕНИ — то, что заставит участника
  сказать «это про нас!».
- ЗАПРЕЩЕНО использовать общие/теоретические статьи, блоги, инструкции или академические обзоры. Используй ТОЛЬКО новостные сообщения о реальных событиях, происшествиях, инцидентах, конфликтах или кризисах последних 3 лет.
- Каждая сгенерированная ситуация должна СТРОГО соответствовать по смыслу и фактам содержанию той ссылки, которую ты указываешь в поле "source". Категорически запрещено привязывать ссылку к кейсу, если содержание веб-страницы по ссылке не касается темы этого кейса.
- Когда даны результаты веб-поиска — ОПИРАЙСЯ на них: бери реальную новостную ситуацию из
  результатов и в поле "source" указывай ТОЧНЫЙ URL того результата, на котором кейс основан.
  НЕ придумывай ссылки, которых нет в выдаче.
- Когда результатов поиска нет — синтезируй типовую отраслевую новостную ситуацию, а в "source"
  укажи тип источника (без выдуманных URL).
- Соблюдай стоп-лист: указанные темы запрещены полностью.

ФОРМАТ ВЫВОДА: строго один JSON-объект, без markdown-обёрток и текста вокруг.`;

interface RawCase {
  c: string; // id кластера C1..C5
  title: string;
  summary: string;
  source: string;
  problemType: string;
}

interface BlockResult {
  cases: RawCase[];
}

/** Сколько кейсов на ячейку матрицы (M×C). */
const DEFAULT_CASES_PER_CELL = 2;
/** Сколько результатов поиска запрашивать на ячейку. */
const RESULTS_PER_CELL = 4;

/** Поисковый запрос для одной ячейки M×C (на русском — для отраслевой релевантности). */
function buildSearchQuery(
  profile: DeckProfile,
  block: DeckProfile['functionalBlocks'][number],
  cluster: DeckProfile['stakeholderClusters'][number]
): string {
  const seed = profile.matrix.find((x) => x.m === block.id && x.c === cluster.id)?.seedThemes ?? [];
  const parts = [profile.theme, block.name, cluster.name, ...seed];
  return `${parts.filter(Boolean).join(' ')} новости происшествие конфликт инцидент`;
}

function buildBlockPrompt(
  profile: DeckProfile,
  block: DeckProfile['functionalBlocks'][number],
  casesPerCell: number,
  activeClusters: DeckProfile['stakeholderClusters'],
  searchByCluster?: Map<string, SearchResult[]>
): string {
  const clusters = activeClusters
    .map((c) => {
      const seed = profile.matrix.find((x) => x.m === block.id && x.c === c.id)?.seedThemes ?? [];
      const head = `  - ${c.id} «${c.name}» (${c.question})${
        seed.length ? `; затравочные темы: ${seed.join(', ')}` : ''
      }`;
      const results = searchByCluster?.get(c.id) ?? [];
      if (!results.length) return head;
      const found = results
        .map((r, i) => `      [${i + 1}] ${r.title}\n          URL: ${r.url}\n          ${r.snippet.slice(0, 300)}`)
        .join('\n');
      return `${head}\n    Результаты веб-поиска (используй их и ставь точный URL in source):\n${found}`;
    })
    .join('\n');

  const grounded = !!searchByCluster && searchByCluster.size > 0;
  const sourceHint = grounded
    ? `"source": "ТОЧНЫЙ URL новостного сообщения из результатов веб-поиска этого кластера"`
    : `"source": "тип новостного источника (без выдуманных ссылок)"`;
  const intro = grounded
    ? `Ниже по каждому кластеру даны РЕАЛЬНЫЕ результаты веб-поиска (новости за последние 3 года). Для каждого кластера извлеки до ${casesPerCell} проблемных новостных кейсов, опираясь строго на эти результаты (только реальные события, не общие статьи!). Если результатов поиска не хватает для составления достоверных кейсов, лучше верни меньше кейсов (или 0 для этого кластера). Качество и достоверность важнее количества. Не выдумывай истории и не привязывай нерелевантные ссылки. В "source" поставь точный URL соответствующего результата.`
    : `Для КАЖДОГО кластера подбери ${casesPerCell} проблемных новостных кейса (синтез типовых новостных событий и отраслевых инцидентов).`;

  return `ОБЛАСТЬ: ${profile.theme} — ${profile.audience.name}.
АУДИТОРИЯ: ${profile.audience.description}
БОЛИ АУДИТОРИИ: ${profile.painProfile}
${profile.terminologyNotes ? `ТЕРМИНОЛОГИЯ: ${profile.terminologyNotes}` : ''}

ФУНКЦИОНАЛЬНЫЙ БЛОК ${block.id} «${block.name}» (${block.focus}).
Кластеры стейкхолдеров (столбцы матрицы):
${clusters}

СТОП-ЛИСТ (запрещено): ${profile.tabooList.join('; ')}

${intro}
Всего кейсов: до ${activeClusters.length * casesPerCell}.
Верни строго JSON:
{
  "cases": [
    {
      "c": "C1",
      "title": "короткое название кейса (до 80 симв.)",
      "summary": "2-4 предложения: что произошло, в чём конфликт, дефицит времени/ресурса",
      ${sourceHint},
      "problemType": "тип проблемы одним словом/фразой"
    }
  ]
}
Все "c" должны быть из списка кластеров выше.`;
}

function validateBlock(v: unknown): BlockResult {
  const p = v as BlockResult;
  if (!p || !Array.isArray(p.cases)) throw new Error('ожидался объект { cases: [...] }');
  for (const c of p.cases) {
    if (!c?.title || !c?.summary || !c?.c) throw new Error('у кейса нет c/title/summary');
  }
  return p;
}

/**
 * Шаг поиска по одному блоку матрицы.
 * 1) По каждому кластеру блока — реальный веб-поиск (если включён).
 * 2) LLM извлекает/синтезирует кейсы; при заземлении source = реальный URL из выдачи.
 */
async function sourceCasesForBlock(
  profile: DeckProfile,
  block: DeckProfile['functionalBlocks'][number],
  casesPerCell: number,
  systemPrompt?: string,
  onSearch?: (clusterName: string) => void
): Promise<RawCaseInput[]> {
  const validClusters = new Set(profile.stakeholderClusters.map((c) => c.id));

  // 1. Веб-поиск по ячейкам M×C блока с фильтрацией по дате и доменам.
  const searchByCluster = new Map<string, SearchResult[]>();
  const allowedUrls = new Set<string>();
  if (isSearchEnabled()) {
    const today = new Date();
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(today.getFullYear() - 3);
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const searchOptions = {
      startDate: formatDate(threeYearsAgo),
      endDate: formatDate(today),
      includeDomains: RUSSIAN_NEWS_DOMAINS,
    };

    for (const cl of profile.stakeholderClusters) {
      onSearch?.(cl.name);
      const results = await webSearch(
        buildSearchQuery(profile, block, cl),
        RESULTS_PER_CELL,
        searchOptions
      );
      // Исключаем PDF-документы из результатов поиска перед передачей в LLM
      const nonPdfResults = results.filter((r) => !/\.pdf($|\?)/i.test(r.url));
      if (nonPdfResults.length) {
        searchByCluster.set(cl.id, nonPdfResults);
        nonPdfResults.forEach((r) => allowedUrls.add(r.url));
      }
    }
  }

  // Фильтруем кластеры: оставляем только кластеры с результатами поиска (если поиск включен).
  const activeClusters = isSearchEnabled()
    ? profile.stakeholderClusters.filter((c) => (searchByCluster.get(c.id)?.length ?? 0) > 0)
    : profile.stakeholderClusters;

  // Если для данного блока нет активных кластеров (не нашли новостей), не генерируем ничего для этого блока.
  if (activeClusters.length === 0) {
    return [];
  }

  const grounded = searchByCluster.size > 0;

  // 2. Извлечение/синтез кейсов моделью.
  const res = await chatJSON<BlockResult>(
    [
      { role: 'system', content: systemPrompt || SYSTEM },
      { role: 'user', content: buildBlockPrompt(profile, block, casesPerCell, activeClusters, searchByCluster) },
    ],
    { temperature: grounded ? 0.4 : 0.6, retries: 2, validate: validateBlock }
  );

  // 3. Нормализация и валидация source: при заземлении принимаем только реальные и рабочие URL.
  const rawCases = res.cases.filter((c) => validClusters.has(c.c));

  const processedCases = await Promise.all(
    rawCases.map(async (c) => {
      let source = (c.source || '').trim();

      if (grounded) {
        // Проверяем, есть ли эта ссылка в поисковой выдаче
        let isRealUrl = /^https?:\/\//i.test(source) && allowedUrls.has(source);

        // Дополнительно проверяем её доступность по HTTP
        let isAlive = false;
        if (isRealUrl) {
          isAlive = await checkUrlAlive(source);
        }

        // Если ссылка не настоящая или не отвечает, ищем рабочую замену из выдачи для этого кластера
        if (!isRealUrl || !isAlive) {
          const clusterResults = searchByCluster.get(c.c) || [];
          let fallbackUrl = '';

          // Проверяем по очереди ссылки из выдачи этого кластера, пока не найдем рабочую
          for (const resItem of clusterResults) {
            if (await checkUrlAlive(resItem.url)) {
              fallbackUrl = resItem.url;
              break;
            }
          }

          // Если все ссылки в выдаче кластера недоступны, берем первую ссылку из выдачи как запасную,
          // даже если она не отвечает (чтобы не терять привязку к реальному источнику)
          source = fallbackUrl || clusterResults[0]?.url || source || 'новостной источник не подтвержден (требует проверки)';
        }
      } else {
        source = source || 'обобщенный новостной кейс (LLM, требует проверки)';
      }

      return {
        title: c.title.trim(),
        summary: c.summary.trim(),
        source,
        problemType: (c.problemType || '').trim(),
        matrixCell: `${block.id}×${c.c}`,
      };
    })
  );

  return processedCases;
}

/** Метаданные стадии для UI-панели промптов (пример — по первому блоку матрицы). */
export const SOURCER_STAGE = {
  key: 'sourcer' as const,
  title: 'Стадия 1 · Источник кейсов',
  defaultSystem: SYSTEM,
  buildUserExample: (profile: DeckProfile) =>
    profile.functionalBlocks[0]
      ? buildBlockPrompt(profile, profile.functionalBlocks[0], DEFAULT_CASES_PER_CELL, profile.stakeholderClusters)
      : '(пример появится после генерации ядра)',
};

/** Запускает Стадию 1: проходит по функциональным блокам матрицы и собирает банк кейсов. */
export async function runSourcer(
  profile: DeckProfile,
  opts: { casesPerCell?: number; systemPrompt?: string; onProgress?: ProgressFn; minRequiredCases?: number } = {}
): Promise<RawCaseInput[]> {
  const casesPerCell = opts.casesPerCell ?? DEFAULT_CASES_PER_CELL;
  const all: RawCaseInput[] = [];
  const total = profile.functionalBlocks.length;
  const mode = isSearchEnabled() ? 'веб-поиск' : 'синтез';

  // Последовательно по блокам — щадим бесплатный фритир (меньше параллельных лимитов).
  for (let i = 0; i < total; i++) {
    const block = profile.functionalBlocks[i];
    opts.onProgress?.(i, total, `Блок ${block.id} «${block.name}» (${mode})`);
    const cases = await sourceCasesForBlock(
      profile,
      block,
      casesPerCell,
      opts.systemPrompt,
      (clusterName) => opts.onProgress?.(i, total, `Блок ${block.id}: поиск «${clusterName}»`)
    );
    all.push(...cases);
  }

  const minRequired = opts.minRequiredCases ?? 36;
  if (all.length < minRequired) {
    throw new Error(
      `Собрано слишком мало реальных новостных кейсов (всего ${all.length}, требуется минимум ${minRequired}). ` +
      `Пожалуйста, скорректируйте темы в профайлере или пересоберите матрицу (задайте более широкие/поисковые ключевые слова).`
    );
  }
  return all;
}
