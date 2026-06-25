import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { MediaStatus, ImageAction } from './api';
import type { Card, Case, Deck, DeckProfile, Job, StageKey, StagePrompt } from './types';
import { ProfileEditor } from './ProfileEditor';
import { PromptPanel } from './PromptPanel';
import { CasesView } from './CasesView';
import { CardsView } from './CardsView';
import { Button, Lighthouse, StatusBadge, CheckIcon, AlertIcon, Tabs, Spinner } from './ui';
import type { TabItem } from './ui';

type TabKey = 'profile' | 'cases' | 'cards';

/** Стартовая вкладка по статусу колоды — открываем актуальный артефакт сразу. */
function defaultTab(status: string): TabKey {
  if (status === 'cards') return 'cards';
  if (status === 'sourced' || status === 'validated') return 'cases';
  return 'profile';
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  profiled: 'Профиль готов',
  sourced: 'Кейсы найдены',
  validated: 'Кейсы отобраны',
  cards: 'Карты готовы',
  error: 'Ошибка',
};

const STAGE_LABEL: Record<StageKey, string> = {
  profiler: 'Профайлер',
  sourcer: 'Источник кейсов',
  validator: 'Валидация',
  generator: 'Генерация карт',
};

/** Прогресс-бар фоновой задачи стадии: «3/12 · подпись» + полоса. */
function JobProgress({ job }: { job: Job }) {
  const { current, total, label } = job.progress;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="mt-3 animate-fade-in">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-navy-600 font-medium truncate pr-2">{label}</span>
        <span className="text-navy-400 font-semibold tabular-nums shrink-0">
          {current}/{total}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-beam-500 to-sea-400 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
    </div>
  );
}

/** Интерактивный Степпер стадий разработки колоды */
function StageStepper({ status }: { status: string }) {
  const stages = [
    { id: 1, label: 'Инициация' },
    { id: 2, label: 'Ядро (Профиль)' },
    { id: 3, label: 'Поиск кейсов' },
    { id: 4, label: 'Валидация' },
    { id: 5, label: 'Карты готовы' },
  ];

  let currentStepIndex = 0;
  if (status === 'draft') currentStepIndex = 0;
  else if (status === 'profiled') currentStepIndex = 1;
  else if (status === 'sourced') currentStepIndex = 2;
  else if (status === 'validated') currentStepIndex = 3;
  else if (status === 'cards') currentStepIndex = 4;
  else if (status === 'error') currentStepIndex = 1;

  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 mb-5">
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2 sm:pb-0">
        {stages.map((stage, idx) => {
          const isCompleted = idx < currentStepIndex;
          const isActive = idx === currentStepIndex;
          const isLast = idx === stages.length - 1;

          let badgeColor = 'bg-slate-100 text-slate-400 border border-slate-200/60';
          let textColor = 'text-slate-400';

          if (isCompleted) {
            badgeColor = 'bg-sea-500 text-white shadow-sm shadow-sea-500/20';
            textColor = 'text-sea-700 font-medium';
          } else if (isActive) {
            badgeColor = 'bg-beam-500 text-navy-950 ring-4 ring-beam-100 font-bold';
            textColor = 'text-navy-950 font-bold';
          }

          return (
            <div key={stage.id} className="flex-1 flex items-center min-w-[110px]">
              <div className="flex flex-col items-center text-center relative mx-auto">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${badgeColor}`}
                >
                  {isCompleted ? <CheckIcon className="w-3.5 h-3.5" /> : stage.id}
                </div>
                <span className={`text-[10px] sm:text-[11px] mt-1.5 whitespace-nowrap transition-colors duration-300 ${textColor}`}>
                  {stage.label}
                </span>
              </div>

              {!isLast && (
                <div className="flex-1 h-[2px] mx-1 sm:mx-3 -mt-5 bg-slate-100 rounded-full relative min-w-[20px]">
                  <div
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-sea-500 to-sea-400 transition-all duration-500 rounded-full"
                    style={{ width: isCompleted ? '100%' : isActive ? '50%' : '0%' }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selected, setSelected] = useState<Deck | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [prompts, setPrompts] = useState<StagePrompt[]>([]);
  const [theme, setTheme] = useState('');
  const [notes, setNotes] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [tab, setTab] = useState<TabKey>('profile');
  const [media, setMedia] = useState<MediaStatus>({ generate: false, stock: false, stylize: false });
  // Ключ уже обработанной терминальной задачи — чтобы дозагрузка результата сработала один раз.
  const handledJobRef = useRef<string | null>(null);

  async function refresh() {
    setDecks(await api.listDecks());
  }
  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    api.mediaStatus().then(setMedia).catch(() => {});
  }, []);

  async function loadPrompts(id: number) {
    setPrompts(await api.getPrompts(id).catch(() => []));
  }

  async function selectDeck(id: number) {
    setError(null);
    const deck = await api.getDeck(id);
    setSelected(deck);
    setTab(defaultTab(deck.status));
    setCases(deck.profile ? await api.listCases(id).catch(() => []) : []);
    setCards(deck.profile ? await api.listCards(id).catch(() => []) : []);
    await loadPrompts(id);
    // Подхватываем уже идущую (или последнюю) задачу — на случай перезахода в колоду.
    const j = await api.getJob(id).catch(() => null);
    if (j && j.status === 'running') {
      handledJobRef.current = `${j.deckId}:${j.stage}:${j.startedAt}`; // не до-перезагружать прошлый результат
      setJob(j);
    } else {
      setJob(null);
    }
  }

  // Поллинг прогресса, пока задача выполняется.
  useEffect(() => {
    if (!selected || !job || job.status !== 'running') return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const j = await api.getJob(selected.id);
        if (alive) setJob(j);
      } catch {
        /* транзиентная ошибка сети — следующий тик повторит */
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected?.id, job?.status]);

  // Реакция на завершение задачи: один раз дозагрузить deck/cases/cards/prompts.
  useEffect(() => {
    if (!selected || !job || job.status === 'running') return;
    const key = `${job.deckId}:${job.stage}:${job.startedAt}`;
    if (handledJobRef.current === key) return;
    handledJobRef.current = key;
    const stage = job.stage;
    const errMsg = job.status === 'error' ? job.error : null;
    (async () => {
      if (errMsg) setError(STAGE_LABEL[stage] + ': ' + errMsg);
      const deck = await api.getDeck(selected.id);
      setSelected(deck);
      setCases(deck.profile ? await api.listCases(selected.id).catch(() => []) : []);
      setCards(deck.profile ? await api.listCards(selected.id).catch(() => []) : []);
      await loadPrompts(selected.id);
      await refresh();
    })().catch((e) => setError(String(e)));
  }, [job?.status, job?.startedAt]);

  /** Запускает фоновую стадию: POST → снимок задачи; дальше прогресс подхватывает поллинг. */
  async function startStage(starter: (id: number) => Promise<{ job: Job }>, stage: StageKey) {
    if (!selected) return;
    setError(null);
    try {
      const { job: started } = await starter(selected.id);
      handledJobRef.current = null; // новый запуск — разрешаем дозагрузку по завершении
      setJob(started);
    } catch (e) {
      setError(STAGE_LABEL[stage] + ': ' + String(e));
    }
  }

  const runSourcer = () => startStage(api.startSourcer, 'sourcer');
  const runValidator = () => startStage(api.startValidator, 'validator');
  const generateCards = () => startStage(api.startGenerator, 'generator');
  // Точечная доводка слабых карт — переиспользует слот задачи стадии «generator».
  const doctorWeak = () => startStage(api.startDoctor, 'generator');
  // Стадия 4 — промпты изображений (тоже через слот «generator»).
  const genImagePrompts = () => startStage(api.startImagePrompts, 'generator');
  // Стадия 5 — картинки карт пакетно (фоном), по действию.
  const genImages = (action: ImageAction) =>
    startStage((id) => api.startImages(id, action), 'generator');

  /** Картинка одной карты (синхронно) по действию. Обновляет карту в состоянии. */
  async function makeCardImage(cardId: number, action: ImageAction) {
    if (!selected) return;
    const updated = await api.makeCardImage(selected.id, cardId, action);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }
  async function dropCardImage(cardId: number, slot: 'stock' | 'final') {
    if (!selected) return;
    const updated = await api.deleteCardImage(selected.id, cardId, slot);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  /** true, если для текущей колоды выполняется именно эта стадия. */
  const stageRunning = (stage: StageKey) =>
    job?.deckId === selected?.id && job?.stage === stage && job?.status === 'running';

  async function create() {
    if (!theme.trim()) return;
    setError(null);
    try {
      const deck = await api.createDeck(theme, notes);
      setTheme('');
      setNotes('');
      setShowCreate(false);
      await refresh();
      await selectDeck(deck.id);
    } catch (e) {
      setError(String(e));
    }
  }

  const runProfiler = () => startStage(api.startProfiler, 'profiler');

  /** Ручная правка карты: PATCH на сервер, затем точечное обновление в состоянии. */
  async function updateCard(
    cardId: number,
    fields: { name?: string; description?: string; task?: string; imagePrompt?: string; stockQuery?: string }
  ) {
    if (!selected) return;
    const updated = await api.updateCard(selected.id, cardId, fields);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function saveProfile(profile: DeckProfile) {
    if (!selected) return;
    setBusy('save');
    setError(null);
    try {
      const deck = await api.saveProfile(selected.id, profile);
      setSelected(deck);
      await refresh();
      await loadPrompts(deck.id);
    } catch (e) {
      setError('Сохранение: ' + String(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePrompt(stage: StageKey, system: string) {
    if (!selected) return;
    setBusy('prompt:' + stage);
    setError(null);
    try {
      await api.savePrompt(selected.id, stage, system);
      await loadPrompts(selected.id);
    } catch (e) {
      setError('Сохранение промпта: ' + String(e));
    } finally {
      setBusy(null);
    }
  }

  const promptFor = (key: StageKey) => prompts.find((p) => p.key === key);
  const PromptFor = ({ stage }: { stage: StageKey }) => (
    <PromptPanel
      prompt={promptFor(stage)}
      busy={busy === 'prompt:' + stage}
      onSave={(system) => savePrompt(stage, system)}
    />
  );

  return (
    <div className="min-h-screen bg-navy-50/50 text-navy-900 font-sans antialiased relative overflow-hidden">
      {/* Декоративные размытые фоны */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-beam-100/30 blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-sea-100/20 blur-[130px] pointer-events-none z-0" />

      {/* Хедер с тулбаром выбора колоды */}
      <header className="sticky top-0 z-30 glass-header shadow-sm shadow-navy-100/30">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <Lighthouse className="w-9 h-9 shrink-0" />
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-navy-950">Carty</span>
              <span className="text-navy-500 text-[10px] font-medium uppercase tracking-wider hidden sm:inline -mt-0.5">
                Фабрика учебных колод
              </span>
            </div>
          </div>

          {/* Выбор колоды */}
          <div className="flex items-center gap-2 ml-auto">
            <select
              className="min-w-[200px] max-w-[320px] border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 font-medium text-navy-800"
              value={selected?.id ?? ''}
              onChange={(e) => e.target.value && selectDeck(Number(e.target.value))}
            >
              <option value="" disabled>
                {decks.length ? 'Выберите колоду…' : 'Колод пока нет'}
              </option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.theme} · {STATUS_LABEL[d.status] || d.status}
                </option>
              ))}
            </select>
            <Button variant="primary" className="px-4 py-2.5 shrink-0" onClick={() => setShowCreate((s) => !s)}>
              ＋ Новая колода
            </Button>
          </div>
        </div>

        {/* Inline-форма создания колоды */}
        {showCreate && (
          <div className="border-t border-slate-200/60 bg-white/70 backdrop-blur">
            <div className="max-w-[1600px] mx-auto px-6 py-4 flex flex-wrap items-end gap-3 animate-fade-in">
              <label className="flex-1 min-w-[220px]">
                <span className="text-xs font-bold text-navy-500">Тема</span>
                <input
                  autoFocus
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50/50 outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 focus:bg-white"
                  placeholder="напр. «Школы»"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
              </label>
              <label className="flex-[2] min-w-[260px]">
                <span className="text-xs font-bold text-navy-500">Уточнения (опционально)</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50/50 outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 focus:bg-white"
                  placeholder="контекст, нюансы аудитории…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
              </label>
              <Button variant="primary" className="px-6 py-2.5" onClick={create} disabled={!theme.trim()}>
                Создать
              </Button>
              <Button variant="ghost" className="px-4 py-2.5" onClick={() => setShowCreate(false)}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </header>

      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto relative z-10">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3.5 mb-6 text-sm flex items-start gap-2.5 whitespace-pre-wrap animate-fade-in">
            <AlertIcon className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Ошибка: </span>
              {error}
            </div>
          </div>
        )}

        {!selected && (
          <div className="flex flex-col items-center justify-center text-center py-28 bg-white/60 backdrop-blur rounded-3xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.01)] animate-fade-in">
            <Lighthouse className="w-24 h-24 mb-6" />
            <p className="text-navy-950 font-bold text-lg">Выберите колоду сверху или создайте новую</p>
            <p className="text-navy-500 text-sm mt-1 max-w-sm">
              Маяк Carty подсветит путь от абстрактной идеи до готовой методической колоды
            </p>
          </div>
        )}

        {selected && (() => {
          const hasProfile = !!selected.profile;
          const hasActiveCases = cases.some((c) => c.status === 'active');
          const jobRunning = job?.deckId === selected.id && job?.status === 'running';

          const tabs: TabItem<TabKey>[] = [
            { key: 'profile', label: 'Профиль' },
            { key: 'cases', label: 'Кейсы', count: cases.length || undefined, disabled: !hasProfile },
            {
              key: 'cards',
              label: 'Карты',
              count: cards.length || undefined,
              disabled: !hasProfile || (!hasActiveCases && cards.length === 0),
            },
          ];
          // Если активная вкладка вдруг заблокирована — откатываемся на «Профиль».
          const activeTab = tabs.find((t) => t.key === tab && !t.disabled) ? tab : 'profile';

          return (
          <div className="space-y-5 animate-fade-in">
            {/* Постоянная шапка колоды */}
            <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-6">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-navy-950 tracking-tight">{selected.theme}</h1>
                {selected.notes && (
                  <p className="text-navy-500 text-sm mt-2 leading-relaxed max-w-3xl">{selected.notes}</p>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <StatusBadge
                    status={selected.status}
                    label={STATUS_LABEL[selected.status] || selected.status}
                  />
                </div>
              </div>
            </div>

            <StageStepper status={selected.status} />

            {/* Глобальный прогресс фоновой задачи — виден на любой вкладке */}
            {jobRunning && job && (
              <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] px-5 py-4">
                <div className="text-xs font-bold text-navy-700 flex items-center gap-2">
                  <Spinner className="w-3.5 h-3.5 text-beam-600" />
                  {STAGE_LABEL[job.stage]} · выполняется…
                </div>
                <JobProgress job={job} />
              </div>
            )}

            <Tabs tabs={tabs} active={activeTab} onChange={setTab} />

            {/* ── Вкладка «Профиль» ── */}
            {activeTab === 'profile' && (
              <div className="space-y-5">
                {!hasProfile && (
                  <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-6">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-navy-950 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-beam-500" />
                          Шаг 1 · Доменное ядро
                        </h3>
                        <p className="text-xs text-navy-500 mt-1 leading-relaxed">
                          Профайлер построит профиль аудитории, смысловое ядро и матрицу M×C.
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        onClick={runProfiler}
                        loading={stageRunning('profiler')}
                        className="px-6 py-3 shrink-0"
                      >
                        {stageRunning('profiler') ? 'Генерация ядра…' : 'Сгенерировать профиль'}
                      </Button>
                    </div>
                    <PromptFor stage="profiler" />
                  </div>
                )}

                {hasProfile && (
                  <ProfileEditor
                    profile={selected.profile!}
                    busy={busy === 'save' ? 'save' : stageRunning('profiler') ? 'profiler' : null}
                    onSave={saveProfile}
                    onRegenerate={runProfiler}
                  />
                )}
              </div>
            )}

            {/* ── Вкладка «Кейсы» ── */}
            {activeTab === 'cases' && hasProfile && (
              <div className="space-y-5">
                {/* Стадия 1 · Сбор */}
                <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-navy-950 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-beam-500" />
                        Стадия 1 · Сбор банка кейсов
                      </h3>
                      <p className="text-xs text-navy-500 mt-1 leading-relaxed">
                        {cases.length > 0
                          ? `Собрано ${cases.length} проблемных кейсов по матрице. Можно пересобрать.`
                          : 'Сбор банка реальных проблемных кейсов на базе матрицы M×C.'}
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      className="px-6 py-2.5 shrink-0"
                      onClick={runSourcer}
                      loading={stageRunning('sourcer')}
                    >
                      {stageRunning('sourcer')
                        ? 'Поиск кейсов…'
                        : cases.length > 0
                        ? '↻ Пересобрать кейсы'
                        : 'Найти кейсы'}
                    </Button>
                  </div>
                  <PromptFor stage="sourcer" />
                </div>

                {/* Стадия 2 · Валидация */}
                {cases.length > 0 && (
                  <Stage2Panel
                    cases={cases}
                    running={stageRunning('validator')}
                    onValidate={runValidator}
                    prompt={<PromptFor stage="validator" />}
                  />
                )}

                <CasesView cases={cases} />
              </div>
            )}

            {/* ── Вкладка «Карты» ── */}
            {activeTab === 'cards' && hasProfile && (
              <div className="space-y-5">
                {(hasActiveCases || cards.length > 0) && (
                  <Stage3Panel
                    cards={cards}
                    running={stageRunning('generator')}
                    onGenerate={generateCards}
                    onDoctor={doctorWeak}
                    prompt={<PromptFor stage="generator" />}
                  />
                )}
                {cards.length > 0 && (
                  <Stage4Panel
                    cards={cards}
                    running={stageRunning('generator')}
                    onGenerate={genImagePrompts}
                  />
                )}
                {cards.some((c) => c.imagePrompt) && (
                  <Stage5Panel
                    cards={cards}
                    media={media}
                    running={stageRunning('generator')}
                    onGenerate={genImages}
                  />
                )}
                <CardsView
                  cards={cards}
                  deckId={selected.id}
                  media={media}
                  onUpdateCard={updateCard}
                  onMakeImage={makeCardImage}
                  onDropImage={dropCardImage}
                />
              </div>
            )}
          </div>
          );
        })()}
      </div>
    </div>
  );
}

function Stage2Panel({
  cases,
  running,
  onValidate,
  prompt,
}: {
  cases: Case[];
  running: boolean;
  onValidate: () => void;
  prompt: React.ReactNode;
}) {
  const THRESHOLD = 80;
  const TARGET = 16;
  const validated = cases.some((c) => c.score != null);
  const count = (g: 'Я' | 'МЫ') =>
    cases.filter((c) => c.status === 'active' && c.group === g && (c.score ?? 0) >= THRESHOLD).length;
  const ya = count('Я');
  const we = count('МЫ');
  const dups = cases.filter((c) => c.status === 'duplicate').length;

  const Quota = ({ label, n }: { label: string; n: number }) => {
    const ok = n >= TARGET;
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
          ok ? 'bg-sea-50 text-sea-700 ring-sea-200/50' : 'bg-beam-50 text-beam-700 ring-beam-200/40'
        }`}
      >
        {ok ? '✓' : '○'} {label}: {n}/{TARGET}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-navy-950 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-beam-500" />
            Стадия 2 · Валидация и скоринг
          </h3>
          <p className="text-xs text-navy-500 mt-1 leading-relaxed">
            {validated
              ? 'Кейсы оценены. Ниже квоты с баллом 80+ по осям:'
              : 'Дедупликация, скоринг 0–100 по 5 критериям и разделение по осям «Я» и «МЫ».'}
          </p>
          {validated && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Quota label="Я (Индивидуальные)" n={ya} />
              <Quota label="МЫ (Командные)" n={we} />
              {dups > 0 && (
                <span className="text-xs text-navy-400 font-medium ml-1">· дубликатов: {dups}</span>
              )}
            </div>
          )}
        </div>
        <Button variant="primary" className="px-6 py-2.5 shrink-0" onClick={onValidate} loading={running}>
          {running ? 'Оценка кейсов…' : validated ? '↻ Переоценить' : 'Оценить кейсы'}
        </Button>
      </div>
      {prompt}
    </div>
  );
}

function Stage5Panel({
  cards,
  media,
  running,
  onGenerate,
}: {
  cards: Card[];
  media: MediaStatus;
  running: boolean;
  onGenerate: (action: ImageAction) => void;
}) {
  const named = cards.filter((c) => c.name);
  const withPrompt = named.filter((c) => c.imagePrompt).length;
  const withStock = named.filter((c) => c.stockMeta).length;
  const withFinal = named.filter((c) => c.imageMeta).length;
  const anyProvider = media.generate || media.stock;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-navy-950 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sea-500" />
            Стадия 5 · Картинки карт
          </h3>
          <p className="text-xs text-navy-500 mt-1 leading-relaxed">
            Сначала <b>подбираем стоковое фото</b> (Pexels по запросу карты), затем из него делаем
            итог: взять как есть, стилизовать (img2img) или сгенерировать заново (FLUX).
          </p>
          <p className="text-[11px] text-navy-400 mt-1.5">
            Промпт: {withPrompt}/{named.length} · сток: {withStock}/{named.length} · итог: {withFinal}/{named.length}
          </p>
          {!anyProvider && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/40 px-2.5 py-1.5 rounded-lg mt-2 font-medium inline-block">
              ⚠ Ключи не заданы. Генерация/стилизация — Cloudflare (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN), сток — PEXELS_API_KEY в server/.env.
            </p>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-2 shrink-0 w-[230px]">
          <Button
            variant="navy"
            className="px-4 py-2.5"
            onClick={() => onGenerate('stock')}
            loading={running}
            disabled={running || !media.stock || withPrompt === 0}
            title={media.stock ? '' : 'Нужен PEXELS_API_KEY'}
          >
            {running ? 'Производство…' : `① 🔍 Найти сток (${withPrompt})`}
          </Button>
          <Button
            variant="ghost"
            className="px-4 py-2"
            onClick={() => onGenerate('stock-as-final')}
            loading={running}
            disabled={running || withStock === 0}
            title="Перенести стоковые фото в итог как есть"
          >
            {running ? '…' : `② ↙ Итог = сток (${withStock})`}
          </Button>
          <Button
            variant="ghost"
            className="px-4 py-2"
            onClick={() => onGenerate('stylize')}
            loading={running}
            disabled={running || !media.stylize || withStock === 0}
            title={media.stylize ? 'Стилизовать сток под карту (img2img)' : 'Нужны ключи Cloudflare'}
          >
            {running ? '…' : `② 🖌 Итог = стилизация (${withStock})`}
          </Button>
          <div className="h-px bg-slate-100 my-0.5" />
          <Button
            variant="primary"
            className="px-4 py-2.5"
            onClick={() => onGenerate('generate')}
            loading={running}
            disabled={running || !media.generate || withPrompt === 0}
            title={media.generate ? 'Сгенерировать с нуля (без стока)' : 'Нужны ключи Cloudflare'}
          >
            {running ? 'Производство…' : `🎨 Итог = генерация (${withPrompt})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stage4Panel({
  cards,
  running,
  onGenerate,
}: {
  cards: Card[];
  running: boolean;
  onGenerate: () => void;
}) {
  const withPrompt = cards.filter((c) => c.imagePrompt && c.name).length;
  const total = cards.filter((c) => c.name).length;
  const has = withPrompt > 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-navy-950 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sea-500" />
            Стадия 4 · Промпты изображений
          </h3>
          <p className="text-xs text-navy-500 mt-1 leading-relaxed">
            {has
              ? `Промпты собраны для ${withPrompt} из ${total} карт (шаблон «МАЯК/LIGHTHOUSE»: фон + гамма по типу + образ + настроение).`
              : 'Сборка промптов изображений по карточному шаблону: фон-константа + цветовая гамма по типу/лучу + центральный образ (модель) + настроение.'}
          </p>
          <p className="text-[10px] text-sea-700 bg-sea-50 border border-sea-200/40 px-2.5 py-1.5 rounded-lg mt-2 font-medium inline-block">
            🖼 Промпт — вход для медиа-продакшена (Pexels-референс → Cloudflare img2img). Сама генерация фото подключается отдельно по ключам.
          </p>
        </div>
        <Button variant="primary" className="px-6 py-2.5 shrink-0" onClick={onGenerate} loading={running} disabled={running}>
          {running ? 'Сборка промптов…' : has ? '↻ Перегенерировать промпты' : 'Сгенерировать промпты'}
        </Button>
      </div>
    </div>
  );
}

function Stage3Panel({
  cards,
  running,
  onGenerate,
  onDoctor,
  prompt,
}: {
  cards: Card[];
  running: boolean;
  onGenerate: () => void;
  onDoctor: () => void;
  prompt: React.ReactNode;
}) {
  const has = cards.length > 0;
  const passed = cards.filter((c) => c.qualityVerdict?.passed).length;
  // Карты с контентом и отклонением длины — кандидаты на точечную доводку.
  const weakLen = cards.filter(
    (c) => c.name && (c.qualityVerdict?.constraintIssues ?? []).some((i) => i.includes('симв.'))
  ).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-navy-950 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-beam-500" />
            Стадия 3 · Генерация карт
          </h3>
          <p className="text-xs text-navy-500 mt-1 leading-relaxed">
            {has
              ? `Сгенерировано ${cards.length} карт, прошли верификацию ${passed}.`
              : 'Генерация 36 индивидуальных карт «Я» и 36 командных карт «МЫ» на базе отобранных кейсов.'}
          </p>
          {!has && (
            <p className="text-[10px] text-beam-700 bg-beam-50 border border-beam-200/30 px-2.5 py-1.5 rounded-lg mt-2 font-medium inline-block">
              ⚠ Долгая операция (12 запросов к модели) — не закрывайте вкладку.
            </p>
          )}
          {has && weakLen > 0 && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/40 px-2.5 py-1.5 rounded-lg mt-2 font-medium inline-block">
              ⚠ Карт с отклонением длины: {weakLen}. «Довести слабые» правит только их — без полной перегенерации.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {has && weakLen > 0 && (
            <Button variant="navy" className="px-4 py-2.5" onClick={onDoctor} loading={running} disabled={running}>
              {running ? 'Доводка…' : `Довести слабые (${weakLen})`}
            </Button>
          )}
          <Button variant="primary" className="px-6 py-2.5" onClick={onGenerate} loading={running} disabled={running}>
            {running ? 'Генерация карт…' : has ? '↻ Перегенерировать' : 'Сгенерировать карты'}
          </Button>
        </div>
      </div>
      {prompt}
    </div>
  );
}
