/**
 * ФИКСИРОВАННЫЙ КАРКАС системы «МАЯК».
 *
 * Это стабильная часть методологии, НЕ генерируется под аудиторию.
 * Извлечено из рабочих промптов (_promts_bazovye.txt): 6 типов контента «Я»
 * и 6 лучей ЗВЕЗДА «МЫ», по 6 паттернов на каждую ось (с типом задачи),
 * цветовые гаммы для изображений и размерные лимиты карт.
 *
 * Профиль колоды (генерируемая часть) наследует этот каркас и дописывает
 * к нему доменную часть (матрица M×C, примеры, тон, стоп-листы).
 */

export type TaskType = 'Генерация' | 'Трансформация';

export interface Pattern {
  /** Название паттерна (что создаётся) */
  name: string;
  /** Тип задачи: создать с нуля или преобразовать имеющееся */
  taskType: TaskType;
}

export interface ContentType {
  /** Машинный код типа */
  id: 'TEXT' | 'AUDIO' | 'IMAGE' | 'VIDEO' | 'INTERACTIVE' | 'DATA';
  /** Отображаемое имя (как в картах) */
  title: string;
  /** Фиксированная цветовая гамма для изображения карты (shades of ...) */
  palette: string;
  /** Пример настроения для промпта изображения */
  moodExample: string;
  /** 6 паттернов этого типа */
  patterns: Pattern[];
}

export interface Ray {
  /** Канонический код луча */
  id: 'KNOWLEDGE' | 'EXTERNAL' | 'DIGITAL_ENV' | 'DATA_PROTECTION' | 'ANALYTICS' | 'AUTOMATION';
  /** Каноническое имя луча (как в «Генерация карт МЫ») */
  title: string;
  /** Цветовая гамма для изображения */
  palette: string;
  moodExample: string;
  patterns: Pattern[];
}

const G: TaskType = 'Генерация';
const T: TaskType = 'Трансформация';

/** Ось «Я» — 6 типов контента, индивидуальные карты. */
export const CONTENT_TYPES: ContentType[] = [
  {
    id: 'TEXT',
    title: 'ТЕКСТ',
    palette: 'gray, blue and green',
    moodExample: 'Challenging and evaluative',
    patterns: [
      { name: 'Многоканальная адаптация', taskType: T },
      { name: 'Критический анализ', taskType: T },
      { name: 'Мнемонизация сложного', taskType: T },
      { name: 'Эмоциональное письмо', taskType: G },
      { name: 'База знаний из хаоса', taskType: T },
      { name: 'Структурирование потока', taskType: T },
    ],
  },
  {
    id: 'AUDIO',
    title: 'АУДИО',
    palette: 'orange, purple and yellow',
    moodExample: 'Uplifting and inspiring',
    patterns: [
      { name: 'Создание фоновой музыки', taskType: G },
      { name: 'Транскрипция + структуризация', taskType: T },
      { name: 'Музыкальная адаптация документа (песня)', taskType: T },
      { name: 'Техническая очистка звука', taskType: T },
      { name: 'Создание гимна организации', taskType: G },
      { name: 'Озвучить текст руководителя', taskType: T },
    ],
  },
  {
    id: 'IMAGE',
    title: 'ИЗОБРАЖЕНИЕ',
    palette: 'blue, green and brown',
    moodExample: 'Creative and expressive',
    patterns: [
      { name: 'Визуализация концепции', taskType: G },
      { name: 'Серийный стиль', taskType: G },
      { name: 'Замена фона', taskType: T },
      { name: 'Визуализация трансформации', taskType: T },
      { name: 'Вирусный контент (мем)', taskType: G },
      { name: 'Реставрация', taskType: T },
    ],
  },
  {
    id: 'VIDEO',
    title: 'ВИДЕО',
    palette: 'red, yellow and orange',
    moodExample: 'Concise and impactful',
    patterns: [
      { name: 'Анимация портрета', taskType: T },
      { name: 'Атмосферный ролик', taskType: G },
      { name: 'Оживить фото', taskType: T },
      { name: 'Мем-видео', taskType: G },
      { name: 'Объясняющий ролик', taskType: G },
      { name: 'Транскрипция видео', taskType: T },
    ],
  },
  {
    id: 'INTERACTIVE',
    title: 'ИНТЕРАКТИВ',
    palette: 'green, light green and dark green',
    moodExample: 'Informative and engaging',
    patterns: [
      { name: 'Экспресс-презентация', taskType: T },
      { name: 'Актуализация дизайна', taskType: T },
      { name: 'Создание прототипа сайта организации', taskType: G },
      { name: 'Обучающая платформа для персонала', taskType: G },
      { name: 'Презентация для партнеров', taskType: T },
      { name: 'Презентация для руководителя', taskType: T },
    ],
  },
  {
    id: 'DATA',
    title: 'ДАННЫЕ',
    palette: 'purple, pink and light blue',
    moodExample: 'Analytical and revealing',
    patterns: [
      { name: 'Сегментация массива', taskType: T },
      { name: 'Поиск аномалий', taskType: T },
      { name: 'Портретирование объекта', taskType: T },
      { name: 'Исследование потенциала', taskType: T },
      { name: 'Экспресс-записка', taskType: T },
      { name: 'Инфографика', taskType: T },
    ],
  },
];

/** Ось «МЫ» — 6 лучей ЗВЕЗДА, командные карты. */
export const RAYS: Ray[] = [
  {
    id: 'KNOWLEDGE',
    title: 'Знание и навыки',
    palette: 'dark blue, light blue and gray',
    moodExample: 'Focused and prioritized',
    patterns: [
      { name: 'Матрица компетенций', taskType: T },
      { name: 'Персональный план развития', taskType: G },
      { name: 'Должностная инструкция', taskType: G },
      { name: 'Методичка', taskType: G },
      { name: 'Анализ трендов', taskType: T },
      { name: 'Стратегическая презентация', taskType: T },
    ],
  },
  {
    id: 'EXTERNAL',
    title: 'Внешнее взаимодействие',
    palette: 'green, light green and brown',
    moodExample: 'Exploratory and directional',
    patterns: [
      { name: 'Концепция мероприятия', taskType: G },
      { name: 'Профилирование ЦА', taskType: T },
      { name: 'Персонализированное предложение', taskType: T },
      { name: 'Анализ потребностей', taskType: T },
      { name: 'Удержание партнера', taskType: T },
      { name: 'Контент-стратегия', taskType: T },
    ],
  },
  {
    id: 'DIGITAL_ENV',
    title: 'Единая образовательная среда',
    palette: 'light blue, white and gray',
    moodExample: 'Informative and supportive',
    patterns: [
      { name: 'SWOT выбора решения', taskType: G },
      { name: 'Инвентаризация ИТ', taskType: T },
      { name: 'Аудит цифрового актива', taskType: T },
      { name: 'Прототип суперприложения', taskType: G },
      { name: 'Разработка бренда', taskType: T },
      { name: 'Анализ обратной связи', taskType: T },
    ],
  },
  {
    id: 'DATA_PROTECTION',
    title: 'Защита данных',
    palette: 'gray, dark gray and black',
    moodExample: 'Secure and evaluative',
    patterns: [
      { name: 'Сценарии реагирования', taskType: T },
      { name: 'Экспресс-аудит ИБ', taskType: T },
      { name: 'Обучающая платформа ИБ', taskType: G },
      { name: 'Анализ кейсов инцидентов', taskType: T },
      { name: 'Сравнение решений ИБ', taskType: T },
      { name: 'Compliance-проверка', taskType: T },
    ],
  },
  {
    id: 'ANALYTICS',
    title: 'Данные и аналитика',
    palette: 'purple, pink and light blue',
    moodExample: 'Transformative and insightful',
    patterns: [
      { name: 'Предиктивный прогноз', taskType: T },
      { name: 'Инвентаризация источников данных', taskType: T },
      { name: 'Управленческий дашборд', taskType: T },
      { name: 'Прогнозирование нагрузок', taskType: T },
      { name: 'Объективизация выбора', taskType: T },
      { name: 'Анализ обращений', taskType: T },
    ],
  },
  {
    id: 'AUTOMATION',
    title: 'Автоматизация',
    palette: 'orange, yellow and light gray',
    moodExample: 'Accessible and concise',
    patterns: [
      { name: 'Проектирование чат-бота', taskType: G },
      { name: 'Поиск точек автоматизации', taskType: T },
      { name: 'Метрики эффективности', taskType: T },
      { name: 'Персонализированные сценарии коммуникации', taskType: T },
      { name: 'Дорожная карта проекта', taskType: G },
      { name: 'RPA-сценарий', taskType: T },
    ],
  },
];

/** Константа фона для всех промптов изображений (LIGHTHOUSE). */
export const IMAGE_BG_CONSTANT =
  'Abstract textured surface with rough brushstrokes';

/** Размерные лимиты карты (символы). */
export const CARD_CONSTRAINTS = {
  nameMin: 15,
  nameMax: 20,
  descriptionMin: 300,
  descriptionMax: 350,
  taskMin: 180,
  taskMax: 220,
} as const;

/** Целевые показатели готовности колоды по умолчанию. */
export const DEFAULT_QUALITY_TARGETS = {
  minScore: 80,
  minCardsPerAxis: 16,
  cardsPerAxis: 36, // 6 осей × 6 паттернов
} as const;

/** Этический стоп-лист по умолчанию (база, профиль может расширить). */
export const DEFAULT_TABOO = [
  'Нарушения законодательства РФ',
  'Острые политические, религиозные или социальные конфликты',
  'Критика государственных институтов',
  'Человеческие жертвы, катастрофы, трагедии',
  'Общественно-резонансные скандалы',
  'Унижение профессионального достоинства специалистов',
  'Боевая лексика (бойцы, герои, победы)',
];

/** Запрещённые англицизмы (заменять русскими эквивалентами). */
export const BANNED_ANGLICISMS = ['KPI', 'ROI', 'AI', 'CEO', 'HR', 'CRM', 'SWOT'];

export const TASK_TYPES: TaskType[] = ['Генерация', 'Трансформация'];

/** Все ячейки осей в виде плоского плана (6 паттернов × 6 осей = 36 на ось). */
export function contentSlots() {
  return CONTENT_TYPES.flatMap((ct) =>
    ct.patterns.map((p, i) => ({ axis: 'Я' as const, typeId: ct.id, typeTitle: ct.title, patternIndex: i, pattern: p }))
  );
}

export function raySlots() {
  return RAYS.flatMap((r) =>
    r.patterns.map((p, i) => ({ axis: 'МЫ' as const, rayId: r.id, rayTitle: r.title, patternIndex: i, pattern: p }))
  );
}
