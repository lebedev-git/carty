/**
 * Медиа-провайдер для Стадии 5 (картинки карт) — изолирован от LLM, как search.ts.
 * Две независимые ветки, обе бесплатные:
 *
 *  1. ГЕНЕРАЦИЯ по промпту — Cloudflare Workers AI, FLUX.1 schnell (text2img).
 *     Возвращает JPEG. Идеально под стиль «МАЯК» (фон мазками + объект + настроение).
 *
 *  2. СТОК по запросу — Pexels Search API: подбираем реальную фотографию.
 *     Опционально стилизуем её под карту через Cloudflare SD v1.5 img2img (PNG).
 *
 * Выбор провайдера генерации — MEDIA_PROVIDER: cloudflare | none.
 * Сток включается наличием PEXELS_API_KEY (иначе ветка стока недоступна).
 * Любой сбой/отсутствие ключа — мягкая деградация (исключение с понятным текстом,
 * стадия ловит его и помечает карту как «без картинки», не валя весь прогон).
 */

const CF_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const CF_FLUX = '@cf/black-forest-labs/flux-1-schnell';
const CF_IMG2IMG = '@cf/runwayml/stable-diffusion-v1-5-img2img';
const PEXELS_URL = 'https://api.pexels.com/v1/search';

/** Что НЕ должно попадать в кадр (img2img negative_prompt): люди, текст, водяные знаки. */
const NEGATIVE_PROMPT =
  'people, person, face, hands, crowd, text, letters, words, numbers, caption, watermark, logo, signature, ui, interface';

/** Готовое изображение: байты + mime + расширение файла. */
export interface ImageResult {
  bytes: Buffer;
  mime: string;
  ext: string;
}

/** Метаданные подобранной стоковой фотографии (для атрибуции Pexels — требование лицензии). */
export interface StockPhoto {
  bytes: Buffer;
  mime: string;
  ext: string;
  credit: string; // «Имя автора / Pexels»
  pageUrl: string; // страница фото на Pexels
}

function cfCreds(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) return null;
  return { accountId, token };
}

/** true, если ветка ГЕНЕРАЦИИ (Cloudflare) настроена. */
export function isGenerateEnabled(): boolean {
  return (process.env.MEDIA_PROVIDER || 'cloudflare').toLowerCase() !== 'none' && !!cfCreds();
}

/** true, если ветка СТОКА (Pexels) настроена. */
export function isStockEnabled(): boolean {
  return !!process.env.PEXELS_API_KEY?.trim();
}

/** true, если доступна img2img-стилизация (нужны те же Cloudflare-креды). */
export function isStylizeEnabled(): boolean {
  return !!cfCreds();
}

// --- Ветка 1: генерация по промпту (FLUX schnell) ---

/**
 * Генерирует изображение по текстовому промпту через Cloudflare FLUX.1 schnell.
 * Ответ — base64-JPEG внутри JSON ({ result: { image } }).
 */
export async function generateImage(prompt: string): Promise<ImageResult> {
  const creds = cfCreds();
  if (!creds) throw new Error('Cloudflare не настроен (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)');

  const url = `${CF_BASE}/${creds.accountId}/ai/run/${CF_FLUX}`;
  // FLUX-схема без negative_prompt — запрет текста/людей дописываем в сам промпт.
  const guardedPrompt = `${prompt} No text, no words, no letters, no people.`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: guardedPrompt, steps: 6 }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Cloudflare FLUX ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { result?: { image?: string } };
  const b64 = data?.result?.image;
  if (!b64) throw new Error('Cloudflare FLUX вернул пустой ответ');
  return { bytes: Buffer.from(b64, 'base64'), mime: 'image/jpeg', ext: 'jpg' };
}

// --- Ветка 2: сток по запросу (Pexels) + опц. стилизация (img2img) ---

/** Ищет подходящую стоковую фотографию по запросу и скачивает её байты. */
export async function searchStock(query: string): Promise<StockPhoto> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new Error('Pexels не настроен (PEXELS_API_KEY)');

  const u = `${PEXELS_URL}?query=${encodeURIComponent(query)}&per_page=5&orientation=square`;
  const res = await fetch(u, { headers: { Authorization: key } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Pexels ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    photos?: { src?: { large?: string; medium?: string }; photographer?: string; url?: string }[];
  };
  const photo = data?.photos?.[0];
  const src = photo?.src?.large || photo?.src?.medium;
  if (!src) throw new Error(`Pexels: ничего не найдено по запросу «${query}»`);

  const imgRes = await fetch(src);
  if (!imgRes.ok) throw new Error(`Pexels: не удалось скачать фото (${imgRes.status})`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : 'jpg';
  return {
    bytes,
    mime,
    ext,
    credit: `${photo?.photographer ?? 'Pexels'} / Pexels`,
    pageUrl: photo?.url ?? '',
  };
}

/**
 * Стилизует фотографию под стиль карты через Cloudflare SD v1.5 img2img.
 * strength 0–1: чем выше, тем сильнее уходим от исходника к промпту.
 * Ответ — бинарный PNG.
 */
export async function stylize(
  photo: Buffer,
  prompt: string,
  strength = 0.65
): Promise<ImageResult> {
  const creds = cfCreds();
  if (!creds) throw new Error('Cloudflare не настроен для стилизации');

  const url = `${CF_BASE}/${creds.accountId}/ai/run/${CF_IMG2IMG}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      negative_prompt: NEGATIVE_PROMPT,
      image_b64: photo.toString('base64'),
      strength,
      guidance: 7.5,
      num_steps: 20,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Cloudflare img2img ${res.status}: ${txt.slice(0, 200)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, mime: 'image/png', ext: 'png' };
}
