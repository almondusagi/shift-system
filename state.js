/**
 * state.js
 * アプリケーション状態の一元管理
 */

const State = window.State = (() => {

  const _initial = () => ({

    // スタッフ一覧
    // [{id, name, category, monthlyHours, dailyHours,
    //   hasBreak5h, workStartAmPm, workStartTime, workEndAmPm, workEndTime,
    //   minRestDays}]
    // ※ canEarlyShift / canLateShift は廃止（勤務時間帯から自動判定）
    staff: [],

    // STEP1 基本設定
    step1: {
      year:        new Date().getFullYear(),
      month:       new Date().getMonth() + 1,
      startDay:    1,
      bizStartAmPm: 'am',
      bizStartTime: '09:00',
      bizEndAmPm:   'pm',
      bizEndTime:   '18:00',
      // 最低・最大出勤人数（全体）
      minStaff:     1,
      maxStaff:     null, // null = 指定なし
      // 最低・最大社員出勤人数
      minEmployee:  0,
      maxEmployee:  null,
      // 早番・遅番人数（最低〜最大）
      earlyCountMin: 0,
      earlyCountMax: null,
      lateCountMin:  0,
      lateCountMax:  null,
    },

    // STEP2 希望休 { staffId: { 'YYYY-MM-DD': '' | 'wishOff' | 'paid' | 'preferOff' } }
    step2: {},

    // STEP3 今月限定上書き
    step3: {},

    // STEP4 例外シフト
    step4: [],

    // STEP5 前月シフト
    step5: {},

    result: null,

    ui: {
      activeTab:          'staff',
      step2SelectedStaff: null,
      step2Draft:         {},
      step3Draft:         {},  // STEP3 の未保存の上書きデータ
      step4Dates:         [],
      zoomLevel:          100,
      resultActiveTab:    'planA', // 案A/B切り替え
    },
  });

  let _state = _initial();

  // ===== ゲッター =====
  const get            = () => _state;
  const getStaff       = ()   => _state.staff;
  const getStaffById   = (id) => _state.staff.find(s => s.id === id) || null;
  const getStep1       = ()   => _state.step1;
  const getStep2       = ()   => _state.step2;
  const getStep2For    = (id) => _state.step2[id] || {};
  const getStep3       = ()   => _state.step3;
  const getStep3For    = (id) => _state.step3[id] || null;
  const getStep3DraftFor = (id) => _state.ui.step3Draft[id];
  const setStep3Draft = (staffId, data) => {
    _state = { ..._state, ui: { ..._state.ui, step3Draft: { ..._state.ui.step3Draft, [staffId]: data } } };
  };
  const resetStep3Draft = () => {
    _state = { ..._state, ui: { ..._state.ui, step3Draft: {} } };
  };
  const getStep4       = ()   => _state.step4;
  const getStep5       = ()   => _state.step5;
  const getStep5For    = (id) => _state.step5[id] || {};
  const getResult      = ()   => _state.result;
  const getUI          = ()   => _state.ui;

  // スタッフの実効設定を取得（STEP3上書き考慮）
  const getEffectiveStaff = (staffId) => {
    const base = getStaffById(staffId);
    if (!base) return null;
    const over = getStep3For(staffId);
    if (!over) return { ...base };
    return {
      ...base,
      monthlyHours:   over.monthlyHours   ?? base.monthlyHours,
      dailyHours:     over.dailyHours     ?? base.dailyHours,
      workStartAmPm:  over.workStartAmPm  ?? base.workStartAmPm,
      workStartTime:  over.workStartTime  ?? base.workStartTime,
      workEndAmPm:    over.workEndAmPm    ?? base.workEndAmPm,
      workEndTime:    over.workEndTime    ?? base.workEndTime,
      hasBreak5h:     over.hasBreak5h     ?? base.hasBreak5h,
      minRestDays:    over.minRestDays    ?? base.minRestDays,
    };
  };

  // 期間の日付配列を取得
  const getPeriodDates = () => {
    const s1 = _state.step1;
    if (!s1.year || !s1.month) return [];
    const start = new Date(s1.year, s1.month - 1, s1.startDay);
    const end   = new Date(s1.year, s1.month, s1.startDay - 1);
    const dates = [];
    const cur   = new Date(start);
    while (cur <= end) {
      dates.push(formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  // 前月期間の日付配列（STEP5用）
  const getPrevPeriodDates = () => {
    const s1 = _state.step1;
    if (!s1.year || !s1.month) return [];
    const periodStart = new Date(s1.year, s1.month - 1, s1.startDay);
    const prevEnd     = new Date(periodStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart   = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);
    const dates = [];
    const cur   = new Date(prevStart);
    while (cur <= prevEnd) {
      dates.push(formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  /**
   * スタッフの早番・遅番可否を勤務可能時間帯から自動判定
   * 早番: 勤務可能開始時刻 <= 就業開始時刻
   * 遅番: 勤務可能終了時刻 >= 就業終了時刻
   */
  const canEarlyShift = (staffId) => {
    const eff = getEffectiveStaff(staffId);
    if (!eff) return false;
    const bizStart = getStep1().bizStartTime || '09:00';
    const staffStart = eff.workStartTime;
    if (!staffStart) return true; // 未設定なら常に可
    return _timeToMin(staffStart) <= _timeToMin(bizStart);
  };

  const canLateShift = (staffId) => {
    const eff = getEffectiveStaff(staffId);
    if (!eff) return false;
    const bizEnd = getStep1().bizEndTime || '18:00';
    const staffEnd = eff.workEndTime;
    if (!staffEnd) return true; // 未設定なら常に可
    return _timeToMin(staffEnd) >= _timeToMin(bizEnd);
  };

  const _timeToMin = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  // ===== セッター =====
  const setStaff = (list) => { _state = { ..._state, staff: list }; };

  const addStaff = (member) => {
    _state = { ..._state, staff: [..._state.staff, member] };
  };

  const updateStaff = (id, changes) => {
    _state = {
      ..._state,
      staff: _state.staff.map(s => s.id === id ? { ...s, ...changes } : s),
    };
  };

  const removeStaff = (id) => {
    _state = { ..._state, staff: _state.staff.filter(s => s.id !== id) };
    const step2 = { ..._state.step2 }; delete step2[id];
    const step3 = { ..._state.step3 }; delete step3[id];
    const step3Draft = { ..._state.ui.step3Draft }; delete step3Draft[id];
    _state = { ..._state, step2, step3, ui: { ..._state.ui, step3Draft } };
  };

  const setStep1 = (data) => {
    _state = { ..._state, step1: { ..._state.step1, ...data } };
  };

  const setStep2ForStaff = (staffId, dayMap) => {
    _state = { ..._state, step2: { ..._state.step2, [staffId]: dayMap } };
  };

  const removeStep2ForStaff = (staffId) => {
    const step2 = { ..._state.step2 }; delete step2[staffId];
    _state = { ..._state, step2 };
  };

  const setStep3ForStaff = (staffId, data) => {
    _state = { ..._state, step3: { ..._state.step3, [staffId]: data } };
  };

  const setStep4    = (list) => { _state = { ..._state, step4: list }; };
  const addStep4    = (item) => { _state = { ..._state, step4: [..._state.step4, item] }; };
  const removeStep4 = (id)   => { _state = { ..._state, step4: _state.step4.filter(e => e.id !== id) }; };

  const setStep5ForStaff = (staffId, dayMap) => {
    _state = { ..._state, step5: { ..._state.step5, [staffId]: dayMap } };
  };
  const setStep5 = (data) => { _state = { ..._state, step5: data }; };

  const setResult = (result) => { _state = { ..._state, result }; };

  const setUI = (changes) => { _state = { ..._state, ui: { ..._state.ui, ...changes } }; };

  const resetAll = () => { _state = _initial(); };

  // ===== ユーティリティ =====
  const formatDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const generateId = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    get, getStaff, getStaffById, getStep1, getStep2, getStep2For,
    getStep3, getStep3For, getStep3DraftFor, getStep4, getStep5, getStep5For,
    getResult, getUI, getEffectiveStaff, getPeriodDates, getPrevPeriodDates,
    canEarlyShift, canLateShift,
    setStaff, addStaff, updateStaff, removeStaff,
    setStep1, setStep2ForStaff, removeStep2ForStaff,
    setStep3ForStaff, setStep3Draft, resetStep3Draft,
    setStep4, addStep4, removeStep4,
    setStep5ForStaff, setStep5, setResult, setUI, resetAll,
    formatDate, generateId
  };
})();
