/** Доменные типы данных конвейера. */

export type DeckStatus =
  | 'draft' // создана, профиль ещё не сгенерирован
  | 'profiled' // профиль сгенерирован/отредактирован
  | 'sourced' // кейсы найдены
  | 'validated' // кейсы отобраны/оценены
  | 'cards' // карты сгенерированы
  | 'error';

/** Ключ стадии конвейера (для оверрайдов промптов). */
export type StageKey = 'profiler' | 'sourcer' | 'validator' | 'generator';

/** Функциональный блок матрицы (строка M). */
export interface FunctionalBlock {
  id: string; // M1..M6
  name: string;
  focus: string; // короткое описание фокуса блока
}

/** Кластер стейкхолдеров (столбец C). */
export interface StakeholderCluster {
  id: string; // C1..C6
  name: string;
  question: string; // "Для кого?", "Что предлагаем?" ...
}

/** Ячейка матрицы M×C с засеянными темами для поиска кейсов. */
export interface MatrixCell {
  m: string; // id блока
  c: string; // id кластера
  seedThemes: string[]; // 1-3 затравочные темы для поиска
}

/** Профиль колоды — центральный артефакт (генерируемая доменная часть). */
export interface DeckProfile {
  audience: {
    name: string;
    description: string;
    segments: string[];
  };
  theme: string;
  functionalBlocks: FunctionalBlock[];
  stakeholderClusters: StakeholderCluster[];
  matrix: MatrixCell[];
  /** Адаптированные под домен примеры для лучей «МЫ» (по id луча). */
  rayExamples?: Record<string, string>;
  /** Адаптированные примеры для типов «Я» (по id типа). */
  contentExamples?: Record<string, string>;
  tabooList: string[];
  toneRules: string;
  terminologyNotes: string;
  /** Профиль боли аудитории — что делает карту «попавшей». */
  painProfile: string;
}

export interface Case {
  id: number;
  deckId: number;
  title: string;
  summary: string;
  source: string; // ссылка/источник
  problemType: string;
  matrixCell: string; // "M1×C2"
  // заполняется на стадии валидации:
  score?: number;
  scoreBreakdown?: Record<string, number>;
  group?: 'Я' | 'МЫ' | null;
  status?: 'active' | 'duplicate' | 'rejected';
  analytics?: string;
}

export interface Card {
  id: number;
  deckId: number;
  axis: 'Я' | 'МЫ';
  sourceCaseId: number | null;
  cardNumber: number;
  name: string;
  /** Тип контента (для «Я») или код луча (для «МЫ»). */
  category: string;
  patternName: string;
  description: string;
  task: string;
  extraMaterialType: 'Генерация' | 'Трансформация';
  qualityVerdict?: {
    passed: boolean;
    painScore?: number;
    constraintIssues?: string[];
    judgeNotes?: string;
  };
  /** Промпт для генерации изображения карты (Стадия 4, «МАЯК/LIGHTHOUSE»). */
  imagePrompt?: string;
  /** Метаданные готовой картинки карты (Стадия 5); файл отдаётся по /api/.../image. */
  imageMeta?: {
    kind: 'generate' | 'stock' | 'stylize';
    ext: string;
    credit?: string;
    pageUrl?: string;
    at: number;
  };
  /** Поисковый запрос для подбора стокового фото (Стадия 4). */
  stockQuery?: string;
  /** Метаданные сырого стокового фото (слот stock); файл — по /api/.../image/stock. */
  stockMeta?: {
    kind: 'stock';
    ext: string;
    credit?: string;
    pageUrl?: string;
    at: number;
  };
}

export interface Deck {
  id: number;
  theme: string;
  notes: string;
  status: DeckStatus;
  profile: DeckProfile | null;
  /** Пользовательские оверрайды system-промптов по ключу стадии. */
  promptOverrides: Partial<Record<StageKey, { system: string }>>;
  createdAt: string;
  updatedAt: string;
}
