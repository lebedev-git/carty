/**
 * Реестр фоновых задач стадий — in-memory.
 *
 * Стадии конвейера выполняются минутами (десятки последовательных вызовов LLM),
 * а синхронный HTTP-запрос на это время упирается в таймауты прокси/браузера.
 * Поэтому POST-стадии стартуют работу здесь и сразу возвращают снимок задачи,
 * а фронт опрашивает прогресс через GET /api/decks/:id/job.
 *
 * Хранилище — Map по deckId: одна активная (или последняя завершённая) задача на
 * колоду. Состояние живёт только в памяти процесса: при рестарте сервера (в т.ч.
 * `tsx watch` на правке файла) активная задача теряется — это осознанный компромисс,
 * фактический результат всё равно лежит в БД, и UI перезапросит факт по колоде.
 */

import type { StageKey } from './types.js';

export interface JobProgress {
  current: number;
  total: number;
  label: string;
}

export interface Job {
  deckId: number;
  stage: StageKey;
  status: 'running' | 'done' | 'error';
  progress: JobProgress;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** Колбэк прогресса, который стадия дёргает по ходу работы. */
export type ProgressFn = (current: number, total: number, label: string) => void;

const jobs = new Map<number, Job>();

export function getJob(deckId: number): Job | null {
  return jobs.get(deckId) ?? null;
}

export function isRunning(deckId: number): boolean {
  return jobs.get(deckId)?.status === 'running';
}

/**
 * Запускает фоновую стадию и СРАЗУ возвращает снимок созданной задачи.
 * `runner` получает onProgress; его промис выполняется в фоне (fire-and-forget),
 * а его завершение/ошибка переводят задачу в 'done'/'error'.
 *
 * Вызывающий ДОЛЖЕН заранее проверить isRunning(deckId) и вернуть 409 — здесь
 * повторный старт молча перезапишет предыдущую задачу.
 */
export function startJob(
  deckId: number,
  stage: StageKey,
  total: number,
  runner: (onProgress: ProgressFn) => Promise<void>
): Job {
  const job: Job = {
    deckId,
    stage,
    status: 'running',
    progress: { current: 0, total: Math.max(1, total), label: 'Запуск…' },
    startedAt: Date.now(),
  };
  jobs.set(deckId, job);

  const onProgress: ProgressFn = (current, t, label) => {
    job.progress = { current, total: Math.max(1, t), label };
  };

  runner(onProgress)
    .then(() => {
      job.status = 'done';
      job.progress = { ...job.progress, current: job.progress.total };
      job.finishedAt = Date.now();
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = Date.now();
    });

  return job;
}
