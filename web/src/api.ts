import type { Card, Case, Deck, DeckProfile, Job, StageKey, StagePrompt } from './types';

export interface MediaStatus {
  generate: boolean;
  stock: boolean;
  stylize: boolean;
}

/** Действие производства картинки карты (Стадия 5). */
export type ImageAction = 'stock' | 'stock-as-final' | 'stylize' | 'generate';

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  // JSON-заголовок ставим ТОЛЬКО при наличии тела. Иначе body-less POST
  // (профайлер, заморозка) отвергается Fastify с FST_ERR_CTP_EMPTY_JSON_BODY,
  // и фронт показывает невнятное «Bad Request» вместо запуска стадии.
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body != null && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listDecks: () => req<Deck[]>('/api/decks'),
  getDeck: (id: number) => req<Deck>(`/api/decks/${id}`),
  createDeck: (theme: string, notes: string) =>
    req<Deck>('/api/decks', { method: 'POST', body: JSON.stringify({ theme, notes }) }),
  saveProfile: (id: number, profile: DeckProfile) =>
    req<Deck>(`/api/decks/${id}/profile`, { method: 'PUT', body: JSON.stringify({ profile }) }),
  getPrompts: (id: number) => req<StagePrompt[]>(`/api/decks/${id}/prompts`),
  savePrompt: (id: number, stage: StageKey, system: string) =>
    req<Deck>(`/api/decks/${id}/prompts/${stage}`, {
      method: 'PUT',
      body: JSON.stringify({ system }),
    }),
  listCases: (id: number) => req<Case[]>(`/api/decks/${id}/cases`),
  listCards: (id: number) => req<Card[]>(`/api/decks/${id}/cards`),
  updateCard: (
    id: number,
    cardId: number,
    fields: { name?: string; description?: string; task?: string; imagePrompt?: string; stockQuery?: string }
  ) =>
    req<Card>(`/api/decks/${id}/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),

  // --- Фоновые стадии: старт возвращает снимок задачи, прогресс опрашивается getJob ---
  getJob: (id: number) => req<Job | null>(`/api/decks/${id}/job`),
  startProfiler: (id: number) =>
    req<{ job: Job }>(`/api/decks/${id}/profile`, { method: 'POST' }),
  startSourcer: (id: number) =>
    req<{ job: Job }>(`/api/decks/${id}/cases`, { method: 'POST' }),
  startValidator: (id: number) =>
    req<{ job: Job }>(`/api/decks/${id}/validate`, { method: 'POST' }),
  startGenerator: (id: number) =>
    req<{ job: Job }>(`/api/decks/${id}/cards/generate`, { method: 'POST' }),
  startDoctor: (id: number) =>
    req<{ job: Job }>(`/api/decks/${id}/cards/doctor`, { method: 'POST' }),
  startImagePrompts: (id: number) =>
    req<{ job: Job }>(`/api/decks/${id}/cards/image-prompts`, { method: 'POST' }),

  // --- Стадия 5: картинки карт ---
  mediaStatus: () => req<MediaStatus>('/api/media/status'),
  /** Производство картинки одной карты (синхронно): action — что именно делаем. */
  makeCardImage: (id: number, cardId: number, action: ImageAction) =>
    req<Card>(`/api/decks/${id}/cards/${cardId}/image`, { method: 'POST', body: JSON.stringify({ action }) }),
  deleteCardImage: (id: number, cardId: number, slot: 'stock' | 'final') =>
    req<Card>(`/api/decks/${id}/cards/${cardId}/image?slot=${slot}`, { method: 'DELETE' }),
  /** Путь к файлу итоговой картинки (для <img src>); cache-buster по времени меты. */
  cardImageUrl: (id: number, cardId: number, at: number) =>
    `/api/decks/${id}/cards/${cardId}/image?t=${at}`,
  /** Путь к файлу стокового фото (слот stock). */
  cardStockUrl: (id: number, cardId: number, at: number) =>
    `/api/decks/${id}/cards/${cardId}/image/stock?t=${at}`,
  startImages: (id: number, action: ImageAction) =>
    req<{ job: Job }>(`/api/decks/${id}/cards/images`, { method: 'POST', body: JSON.stringify({ action }) }),
};
