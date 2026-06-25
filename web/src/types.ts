export interface FunctionalBlock {
  id: string;
  name: string;
  focus: string;
}
export interface StakeholderCluster {
  id: string;
  name: string;
  question: string;
}
export interface MatrixCell {
  m: string;
  c: string;
  seedThemes: string[];
}
export interface DeckProfile {
  theme: string;
  audience: { name: string; description: string; segments: string[] };
  functionalBlocks: FunctionalBlock[];
  stakeholderClusters: StakeholderCluster[];
  matrix: MatrixCell[];
  rayExamples?: Record<string, string>;
  contentExamples?: Record<string, string>;
  tabooList: string[];
  toneRules: string;
  terminologyNotes: string;
  painProfile: string;
}
export type StageKey = 'profiler' | 'sourcer' | 'validator' | 'generator';

/** Снимок фоновой задачи стадии (опрашивается поллингом). */
export interface Job {
  deckId: number;
  stage: StageKey;
  status: 'running' | 'done' | 'error';
  progress: { current: number; total: number; label: string };
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface Deck {
  id: number;
  theme: string;
  notes: string;
  status: string;
  profile: DeckProfile | null;
  promptOverrides: Partial<Record<StageKey, { system: string }>>;
  createdAt: string;
  updatedAt: string;
}

/** Промпт стадии для UI-панели (дефолт + текущий system + пример user). */
export interface StagePrompt {
  key: StageKey;
  title: string;
  defaultSystem: string;
  system: string;
  userExample: string;
}

export interface Case {
  id: number;
  deckId: number;
  title: string;
  summary: string;
  source: string;
  problemType: string;
  matrixCell: string; // "M1×C2"
  score?: number;
  scoreBreakdown?: Record<string, number>;
  group?: 'Я' | 'МЫ' | null;
  status?: 'active' | 'duplicate' | 'rejected';
  analytics?: string;
}

export interface Quota {
  threshold: number;
  target: number;
  yaActive: number;
  weActive: number;
  met: boolean;
  duplicates: number;
}

export interface CardVerdict {
  passed: boolean;
  painScore?: number;
  constraintIssues?: string[];
  judgeNotes?: string;
}

export interface Card {
  id: number;
  deckId: number;
  axis: 'Я' | 'МЫ';
  sourceCaseId: number | null;
  cardNumber: number;
  name: string;
  category: string;
  patternName: string;
  description: string;
  task: string;
  extraMaterialType: 'Генерация' | 'Трансформация';
  qualityVerdict?: CardVerdict;
  /** Промпт для генерации изображения карты (Стадия 4). */
  imagePrompt?: string;
  /** Метаданные готовой картинки (Стадия 5); файл — по /api/decks/:id/cards/:cardId/image. */
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

export interface CardsSummary {
  total: number;
  passed: number;
  withSource: number;
  yaCount: number;
  weCount: number;
}
