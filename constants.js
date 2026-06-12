/**
 * constants.js
 * アプリケーション全体で使用する定数定義
 */

const CONSTANTS = window.CONSTANTS = Object.freeze({

  APP_NAME: 'ShiftPlan',
  APP_VERSION: '2.0.0',

  STORAGE_KEYS: {
    STAFF:   'sp_staff',
    STEP1:   'sp_step1',
    STEP2:   'sp_step2',
    STEP3:   'sp_step3',
    STEP4:   'sp_step4',
    STEP5:   'sp_step5',
    RESULT:  'sp_result',
    UI:      'sp_ui',
  },

  CATEGORY: {
    EMPLOYEE:  'employee',
    COMMUNITY: 'community',
  },

  CATEGORY_LABEL: {
    employee:  '社員',
    community: 'コミュニティ',
  },

  SHIFT_STATE: {
    WORK:       'work',
    OFF:        'off',
    WISH_OFF:   'wishOff',
    PAID:       'paid',
    PREFER_OFF: 'preferOff',
    FORCED_OFF: 'forcedOff', // 最大人数超過による強制休み
  },

  SHIFT_STATE_LABEL: {
    work:      '出勤',
    off:       '休',
    wishOff:   '希',
    paid:      '有',
    preferOff: '青',
    forcedOff: '強制休',
  },

  // STEP2 セルクリックで循環する状態
  STEP2_CYCLE: ['', 'wishOff', 'paid', 'preferOff'],
  STEP2_DISPLAY: {
    '':          { text: '',   cls: 'cell-available' },
    wishOff:     { text: '希', cls: 'cell-wish-off'  },
    paid:        { text: '有', cls: 'cell-paid'      },
    preferOff:   { text: '青', cls: 'cell-prefer-off' },
  },

  PRIORITY: {
    HARD_EX: 'HARD_EX',
    HARD:    'HARD',
    SOFT:    'SOFT',
  },

  // 制約ルール名（優先度順）
  RULE: {
    EXCEPTION:    'STEP4例外シフト',    // 優先度1
    WISH_OFF:     '希望休',            // 優先度2
    PAID:         '有給',              // 優先度3
    MIN_STAFF:    '最低出勤人数',       // 優先度4
    MIN_EMPLOYEE: '最低出勤人数（社員）', // 優先度4
    MAX_STAFF:    '最大出勤人数',       // 優先度5
    MAX_EMPLOYEE: '最大出勤人数（社員）', // 優先度5
    MIN_COMMUNITY:  'min_community',
    MAX_COMMUNITY:  'max_community',
    MAX_CONSEC:   '最大5連勤',         // 優先度6
    MONTHLY_HRS:  '月所定労働時間',     // 優先度7
    REST_DAYS:    '最低休日数',         // 優先度8
    PREV_MONTH:   '前月シフト考慮',
    EARLY_SHIFT:  '早番人数',
    LATE_SHIFT:   '遅番人数',
    PREFER_OFF:   'なるべく休み（青）',  // 優先度9（唯一の妥協可能ルール）
    BALANCE:      '出勤バランス',
    FAIRNESS:     '公平性',
    FORCED_OFF:   '最大人数超過による強制休み',
  },

  MAX_CONSECUTIVE: 5,

  DEFAULT_MONTHLY_HOURS: 160,
  DEFAULT_DAILY_HOURS:   8,
  DEFAULT_MIN_REST_DAYS: 8, // デフォルト最低休日数

  WEEKDAY_SHORT: ['日', '月', '火', '水', '木', '金', '土'],

  YEAR_MIN: new Date().getFullYear(),
  YEAR_MAX: 2040,

  SHIFT_TYPE: {
    NORMAL: 'normal',
    EARLY:  'early',
    LATE:   'late',
  },

  GENERATE_MAX_ATTEMPTS: 200,

  CSV_DELIMITER: ',',
  CSV_NEWLINE:   '\r\n',

  STAFF_CSV_HEADER: [
    'スタッフ名', '区分', '月所定(h)', '1日(h)',
    '5h休憩', '始業AmPm', '始業時間', '終業AmPm', '終業時間',
    '最低休日数',
  ],

  STEP5_CSV_STAFF_COL: 'スタッフ名',
});
