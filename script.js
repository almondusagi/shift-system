/**
 * ============================================================
 * シフト表作成システム - script.js
 * ============================================================
 * 機能概要:
 *   1. Excelファイル（xlsx/xls）を複数読み込みパース
 *   2. スタッフ登録・管理（localStorage永続化）
 *   3. ファイル名からスタッフ自動紐づけ
 *   4. 勤務条件（基本時間・早番遅番・最低人数等）設定
 *   5. 制約条件に基づきシフトを自動生成（21日起算）
 *   6. 結果を表形式で表示 + CSVエクスポート
 *
 * シフト期間: 当月21日〜翌月20日
 *
 * シフト生成ロジック（優先順位）:
 *   ① 赤休（絶対条件）- 必ず休み
 *   ② 週6連勤禁止（最大5連勤）
 *   ③ 月所定時間に近づける
 *      ※ 区分「コミュニティ」は月所定時間 ±0 を厳守
 *         グローバル制約・平準化処理でも出勤日数を増減させない
 *   ④ 青休（弱い制約）- できるだけ反映
 *   ⑤ 最低出勤人数（全体・社員）
 *   ⑥ 早番・遅番の人数確保
 * ============================================================
 */

'use strict';

/* ============================================================
 * グローバル状態管理
 * ============================================================ */
const AppState = {
  /**
   * アップロード済みスタッフ一覧
   * @type {Array<{
   *   name: string,
   *   matchedRegistered: Object|null,
   *   requests: Object.<number, 'red'|'blue'>,
   *   settings: {
   *     category: 'employee'|'community'|'',
   *     monthlyHours: number,
   *     weeklyHours: number,
   *     dailyHours: number,
   *     availableStart: number|null,
   *     availableEnd: number|null
   *   }
   * }>}
   */
  staffList: [],

  /** 対象年 */
  year: new Date().getFullYear(),
  /** 対象月（1〜12） */
  month: new Date().getMonth() + 1,

  /** 基本勤務時間 */
  baseWorkStart: 9,
  baseWorkEnd: 21,

  /** 
   * 個別シフト設定（STEP5）
   * @type {Array<Object>}
   */
  individualSettings: [],

  /** 最低出勤人数 */
  minStaffPerDay: 1,
  /** 最低出勤人数（社員） */
  minEmployeePerDay: 1,

  /** 早番人数 */
  earlyShiftCount: 1,
  /** 遅番人数 */
  lateShiftCount: 1,

  /**
   * 登録済みスタッフ（localStorageで永続化）
   * @type {Array<{
   *   name: string,
   *   category: 'employee'|'community',
   *   monthlyHours: number|null,
   *   weeklyHours: number|null,
   *   dailyHours: number|null,
   *   availableStart: number|null,
   *   availableEnd: number|null
   * }>}
   */
  registeredStaff: [],

  /** 生成結果 */
  results: [],

  /**
   * 手入力セクションの作業中データ
   * @type {{ staffName: string, requests: Object.<number,'red'|'blue'> }}
   */
  manualInput: {
    staffName: '',
    requests:  {}
  },

  /** 現在のシフト期間キャッシュ */
  _periodCache: null
};

/* ============================================================
 * 定数
 * ============================================================ */
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_CONSECUTIVE = 5;
const LS_KEY_STAFF = 'shiftSystem_registeredStaff';

/* ============================================================
 * 初期化
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  loadRegisteredStaff();
  initYearMonthSelectors();
  initTimeSelectors();
  setupDropzone();
  setupActionButtons();
  setupSettingsListeners();
  setupStaffRegistration();
  renderRegisteredStaffList();
  checkXLSXLibrary();
  setupCollapsibleCards();
  setupMobileBottomNav();
  initManualInputSection();
});

/* ============================================================
 * シフト期間計算
 * ============================================================ */

/**
 * 対象月のシフト期間を取得（21日起算）
 * @param {number} year
 * @param {number} month - 1〜12
 * @returns {{ startMonth, endMonth, startYear, endYear, days: Array, totalDays, label }}
 */
function getShiftPeriod(year, month) {
  const startYear = year;
  const startMonth = month;   // 1-indexed
  let endYear = year;
  let endMonth = month + 1;
  if (endMonth > 12) {
    endMonth = 1;
    endYear = year + 1;
  }

  const startDate = new Date(startYear, startMonth - 1, 21);
  const endDate   = new Date(endYear, endMonth - 1, 20);

  const days = [];
  const current = new Date(startDate);
  let idx = 0;
  while (current <= endDate) {
    days.push({
      index: idx,
      date:  new Date(current),
      day:   current.getDate(),
      month: current.getMonth() + 1,
      year:  current.getFullYear(),
      dow:   current.getDay()
    });
    idx++;
    current.setDate(current.getDate() + 1);
  }

  return {
    startMonth, endMonth, startYear, endYear,
    days,
    totalDays: days.length,
    label: `${startMonth}月21日〜${endMonth}月20日（${days.length}日間）`
  };
}

/** キャッシュ付き期間取得 */
function getCurrentPeriod() {
  if (!AppState._periodCache ||
      AppState._periodCache._y !== AppState.year ||
      AppState._periodCache._m !== AppState.month) {
    AppState._periodCache = getShiftPeriod(AppState.year, AppState.month);
    AppState._periodCache._y = AppState.year;
    AppState._periodCache._m = AppState.month;
  }
  return AppState._periodCache;
}

/* ============================================================
 * 初期化: 年月セレクタ
 * ============================================================ */
function initYearMonthSelectors() {
  const yearSel  = document.getElementById('yearSelect');
  const monthSel = document.getElementById('monthSelect');

  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 1; y <= currentYear + 2; y++) {
    const opt = document.createElement('option');
    opt.value       = y;
    opt.textContent = y + '年';
    if (y === AppState.year) opt.selected = true;
    yearSel.appendChild(opt);
  }

  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value       = m;
    opt.textContent = m + '月';
    if (m === AppState.month) opt.selected = true;
    monthSel.appendChild(opt);
  }

  const updateLabel = () => {
    AppState._periodCache = null;
    const period = getCurrentPeriod();
    const label = document.getElementById('monthPeriodLabel');
    if (label) label.textContent = period.label;
  };

  yearSel.addEventListener('change', () => {
    AppState.year = parseInt(yearSel.value);
    updateLabel();
  });
  monthSel.addEventListener('change', () => {
    AppState.month = parseInt(monthSel.value);
    updateLabel();
  });

  updateLabel();
}

/* ============================================================
 * 初期化: 時間セレクタ
 * ============================================================ */
function initTimeSelectors() {
  // 基本勤務時間セレクタ
  populateTimeSelect('baseWorkStart', 5, 26, AppState.baseWorkStart);
  populateTimeSelect('baseWorkEnd',   5, 26, AppState.baseWorkEnd);

  // スタッフ登録用セレクタ
  populateTimeSelect('regAvailStart', 5, 26, null);
  populateTimeSelect('regAvailEnd',   5, 26, null);

  // 基本勤務時間の変更イベント
  document.getElementById('baseWorkStart').addEventListener('change', (e) => {
    AppState.baseWorkStart = parseFloat(e.target.value);
  });
  document.getElementById('baseWorkEnd').addEventListener('change', (e) => {
    AppState.baseWorkEnd = parseFloat(e.target.value);
  });
}

/**
 * 時間セレクタにオプションを追加
 * @param {string} selectId
 * @param {number} minHour
 * @param {number} maxHour - 24超で翌日扱い
 * @param {number|null} selectedValue
 */
function populateTimeSelect(selectId, minHour, maxHour, selectedValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  // プレースホルダ
  if (selectedValue === null) {
    const optDefault = document.createElement('option');
    optDefault.value = '';
    optDefault.textContent = '---';
    sel.appendChild(optDefault);
  }

  for (let h = minHour; h <= maxHour; h += 0.25) {
    const opt = document.createElement('option');
    opt.value = h;
    const isNextDay = h >= 24;
    const displayH = isNextDay ? Math.floor(h - 24) : Math.floor(h);
    const mStr = String(Math.round((h % 1) * 60)).padStart(2, '0');
    const suffix = isNextDay ? '（翌）' : '';
    opt.textContent = `${displayH}時${mStr}分${suffix}`;
    if (selectedValue !== null && h === selectedValue) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* ============================================================
 * 設定UI: その他勤務時間 / 早番遅番日別設定
 * ============================================================ */
function setupSettingsListeners() {
  // 人数設定のリスナー
  document.getElementById('minStaffPerDay').addEventListener('change', (e) => {
    AppState.minStaffPerDay = parseInt(e.target.value) || 0;
  });
  document.getElementById('minEmployeePerDay').addEventListener('change', (e) => {
    AppState.minEmployeePerDay = parseInt(e.target.value) || 0;
  });
  document.getElementById('earlyShiftCount').addEventListener('change', (e) => {
    AppState.earlyShiftCount = parseInt(e.target.value) || 0;
  });
  document.getElementById('lateShiftCount').addEventListener('change', (e) => {
    AppState.lateShiftCount = parseInt(e.target.value) || 0;
  });

  // 個別シフト設定: ＋ボタン
  const addBtn = document.getElementById('addIndividualSettingBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addIndividualSettingRow();
    });
  }
}

/* ============================================================
 * 個別シフト設定（STEP 5）の管理ロジック
 * ============================================================ */

function addIndividualSettingRow() {
  AppState.individualSettings.push({
    dates: [],
    timeType: 'basic',
    workStart: AppState.baseWorkStart,
    workEnd: AppState.baseWorkEnd,
    countType: 'basic',
    minStaff: AppState.minStaffPerDay,
    minEmployee: AppState.minEmployeePerDay,
    earlyCount: AppState.earlyShiftCount,
    lateCount: AppState.lateShiftCount,
    staffAssignmentType: 'none',
    assignedStaff: []
  });
  renderIndividualSettings();
}

function removeIndividualSettingRow(idx) {
  AppState.individualSettings.splice(idx, 1);
  renderIndividualSettings();
}

function renderIndividualSettings() {
  const container = document.getElementById('individualSettingsContainer');
  if (!container) return;
  container.innerHTML = '';
  const period = getCurrentPeriod();

  AppState.individualSettings.forEach((setting, idx) => {
    const card = document.createElement('div');
    card.className = 'is-card';

    // ヘッダー部
    const header = document.createElement('div');
    header.className = 'is-header';
    header.innerHTML = `
      <div style="font-weight:bold; color:var(--color-primary);">設定 ${idx + 1}</div>
      <button class="btn-remove-row" style="width:auto; margin:0;" type="button" onclick="removeIndividualSettingRow(${idx})">削除</button>
    `;
    card.appendChild(header);

    // ─── 日付選択 ───
    const secDates = document.createElement('div');
    secDates.className = 'is-section';
    
    let datesHtml = `<div class="is-section-title">📅 対象日付（複数選択可）</div>`;
    datesHtml += `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">`;
    datesHtml += `<select class="select-input sm" id="is-date-sel-${idx}">`;
    datesHtml += `<option value="">-- 日付を選択して追加 --</option>`;
    period.days.forEach((d, dIdx) => {
      if (!setting.dates.includes(dIdx)) {
        datesHtml += `<option value="${dIdx}">${d.month}/${d.day}(${DAY_NAMES[d.dow]})</option>`;
      }
    });
    datesHtml += `</select>`;
    datesHtml += `<button class="btn btn-secondary btn-sm" type="button" onclick="addDateToSetting(${idx})">追加</button>`;
    datesHtml += `</div>`;
    
    datesHtml += `<div class="is-dates-container">`;
    if (setting.dates.length === 0) {
      datesHtml += `<span style="font-size:12px; color:var(--color-text-muted);">対象日付が設定されていません</span>`;
    }
    setting.dates.sort((a,b)=>a-b).forEach(dIdx => {
      const pd = period.days[dIdx];
      datesHtml += `
        <div class="is-date-badge">
          ${pd.month}/${pd.day}(${DAY_NAMES[pd.dow]})
          <span class="is-date-remove" onclick="removeDateFromSetting(${idx}, ${dIdx})">✕</span>
        </div>
      `;
    });
    datesHtml += `</div>`;
    secDates.innerHTML = datesHtml;
    card.appendChild(secDates);

    // ─── 勤務時間 ───
    const secTime = document.createElement('div');
    secTime.className = 'is-section';
    let timeHtml = `<div class="is-section-title">🕐 勤務時間</div>`;
    timeHtml += `
      <div class="is-radio-group">
        <label><input type="radio" name="is-time-${idx}" value="basic" ${setting.timeType==='basic'?'checked':''} onchange="updateSettingTimeType(${idx}, 'basic')">基本と同じ</label>
        <label><input type="radio" name="is-time-${idx}" value="custom" ${setting.timeType==='custom'?'checked':''} onchange="updateSettingTimeType(${idx}, 'custom')">個別設定</label>
      </div>
    `;
    if (setting.timeType === 'custom') {
      timeHtml += `<div class="is-details"><div class="time-range-row compact">`;
      timeHtml += `<select class="select-input time-select sm" onchange="updateSettingTime(${idx}, 'workStart', parseFloat(this.value))">`;
      timeHtml += generateTimeOptions(setting.workStart);
      timeHtml += `</select><span class="time-separator">〜</span>`;
      timeHtml += `<select class="select-input time-select sm" onchange="updateSettingTime(${idx}, 'workEnd', parseFloat(this.value))">`;
      timeHtml += generateTimeOptions(setting.workEnd);
      timeHtml += `</select></div></div>`;
    }
    secTime.innerHTML = timeHtml;
    card.appendChild(secTime);

    // ─── 人数設定 ───
    const secCount = document.createElement('div');
    secCount.className = 'is-section';
    let countHtml = `<div class="is-section-title">👥 人数設定</div>`;
    countHtml += `
      <div class="is-radio-group">
        <label><input type="radio" name="is-count-${idx}" value="basic" ${setting.countType==='basic'?'checked':''} onchange="updateSettingCountType(${idx}, 'basic')">基本と同じ</label>
        <label><input type="radio" name="is-count-${idx}" value="custom" ${setting.countType==='custom'?'checked':''} onchange="updateSettingCountType(${idx}, 'custom')">個別設定</label>
      </div>
    `;
    if (setting.countType === 'custom') {
      countHtml += `
        <div class="is-details">
          <div class="setting-item"><label>最低出勤人数</label><div class="setting-field"><input type="number" class="setting-input xs" value="${setting.minStaff}" onchange="updateSettingCount(${idx}, 'minStaff', parseInt(this.value))"></div></div>
          <div class="setting-item"><label>社員</label><div class="setting-field"><input type="number" class="setting-input xs" value="${setting.minEmployee}" onchange="updateSettingCount(${idx}, 'minEmployee', parseInt(this.value))"></div></div>
          <div class="setting-item"><label>早番</label><div class="setting-field"><input type="number" class="setting-input xs" value="${setting.earlyCount}" onchange="updateSettingCount(${idx}, 'earlyCount', parseInt(this.value))"></div></div>
          <div class="setting-item"><label>遅番</label><div class="setting-field"><input type="number" class="setting-input xs" value="${setting.lateCount}" onchange="updateSettingCount(${idx}, 'lateCount', parseInt(this.value))"></div></div>
        </div>
      `;
    }
    secCount.innerHTML = countHtml;
    card.appendChild(secCount);

    // ─── スタッフ割り当て ───
    const secStaff = document.createElement('div');
    secStaff.className = 'is-section';
    let staffHtml = `<div class="is-section-title">👤 出勤となるスタッフ（強制割り当て）</div>`;
    staffHtml += `
      <div class="is-radio-group">
        <label><input type="radio" name="is-staff-${idx}" value="none" ${setting.staffAssignmentType==='none'?'checked':''} onchange="updateSettingStaffType(${idx}, 'none')">特になし</label>
        <label><input type="radio" name="is-staff-${idx}" value="specific" ${setting.staffAssignmentType==='specific'?'checked':''} onchange="updateSettingStaffType(${idx}, 'specific')">指定する</label>
      </div>
    `;
    
    if (setting.staffAssignmentType === 'specific') {
      staffHtml += `<div class="is-details" style="flex-direction:column; align-items:stretch;">`;
      staffHtml += `<div class="is-staff-select-container">`;
      staffHtml += `<select class="select-input sm" id="is-staff-sel-${idx}">`;
      staffHtml += `<option value="">-- 追加するスタッフを選択 --</option>`;
      AppState.staffList.forEach(st => {
        if (!setting.assignedStaff.find(as => as.name === st.name)) {
          staffHtml += `<option value="${escapeHtml(st.name)}">${escapeHtml(st.name)}</option>`;
        }
      });
      staffHtml += `</select>`;
      staffHtml += `<button class="btn btn-secondary btn-sm" type="button" onclick="addStaffToSetting(${idx})">追加</button>`;
      staffHtml += `</div>`;
      
      staffHtml += `<div class="is-staff-list">`;
      setting.assignedStaff.forEach((ast, aIdx) => {
        staffHtml += `
          <div class="is-staff-item">
            <span class="is-staff-name">${escapeHtml(ast.name)}</span>
            <div class="is-radio-group" style="margin:0;">
              <label><input type="radio" name="is-stafftime-${idx}-${aIdx}" value="usual" ${ast.timeType==='usual'?'checked':''} onchange="updateAssignedStaffTimeType(${idx}, ${aIdx}, 'usual')">いつも通り</label>
              <label><input type="radio" name="is-stafftime-${idx}-${aIdx}" value="custom" ${ast.timeType==='custom'?'checked':''} onchange="updateAssignedStaffTimeType(${idx}, ${aIdx}, 'custom')">個別設定</label>
            </div>
        `;
        if (ast.timeType === 'custom') {
           staffHtml += `<div class="time-range-row compact" style="margin-left:10px;">`;
           staffHtml += `<select class="select-input time-select xs" onchange="updateAssignedStaffTime(${idx}, ${aIdx}, 'customStart', parseFloat(this.value))">`;
           staffHtml += generateTimeOptions(ast.customStart);
           staffHtml += `</select><span class="time-separator">〜</span>`;
           staffHtml += `<select class="select-input time-select xs" onchange="updateAssignedStaffTime(${idx}, ${aIdx}, 'customEnd', parseFloat(this.value))">`;
           staffHtml += generateTimeOptions(ast.customEnd);
           staffHtml += `</select></div>`;
        }
        staffHtml += `<button class="btn-remove-row" style="margin-left:auto; width:auto;" type="button" onclick="removeStaffFromSetting(${idx}, ${aIdx})">✕</button>`;
        staffHtml += `</div>`;
      });
      staffHtml += `</div>`;
      staffHtml += `</div>`;
    }
    secStaff.innerHTML = staffHtml;
    card.appendChild(secStaff);

    container.appendChild(card);
  });

  const badge = document.getElementById('individualSettingsCount');
  if (badge) {
    badge.textContent = AppState.individualSettings.length > 0 ? `${AppState.individualSettings.length}件` : '';
  }
}

function generateTimeOptions(selectedVal) {
  let html = '';
  for (let h = 5; h <= 26; h += 0.25) {
    const isNextDay = h >= 24;
    const dh = isNextDay ? Math.floor(h - 24) : Math.floor(h);
    const mStr = String(Math.round((h % 1) * 60)).padStart(2, '0');
    const suffix = isNextDay ? '(翌)' : '';
    const sel = (h === selectedVal) ? 'selected' : '';
    html += `<option value="${h}" ${sel}>${dh}時${mStr}分${suffix}</option>`;
  }
  return html;
}

function addDateToSetting(idx) {
  const sel = document.getElementById(`is-date-sel-${idx}`);
  if (!sel || !sel.value) return;
  const dIdx = parseInt(sel.value);
  if (!AppState.individualSettings[idx].dates.includes(dIdx)) {
    AppState.individualSettings[idx].dates.push(dIdx);
    renderIndividualSettings();
  }
}
function removeDateFromSetting(idx, dIdx) {
  AppState.individualSettings[idx].dates = AppState.individualSettings[idx].dates.filter(d => d !== dIdx);
  renderIndividualSettings();
}
function updateSettingTimeType(idx, type) {
  AppState.individualSettings[idx].timeType = type;
  renderIndividualSettings();
}
function updateSettingTime(idx, field, val) {
  AppState.individualSettings[idx][field] = val;
}
function updateSettingCountType(idx, type) {
  AppState.individualSettings[idx].countType = type;
  renderIndividualSettings();
}
function updateSettingCount(idx, field, val) {
  AppState.individualSettings[idx][field] = val || 0;
}
function updateSettingStaffType(idx, type) {
  AppState.individualSettings[idx].staffAssignmentType = type;
  renderIndividualSettings();
}
function addStaffToSetting(idx) {
  const sel = document.getElementById(`is-staff-sel-${idx}`);
  if (!sel || !sel.value) return;
  const name = sel.value;
  AppState.individualSettings[idx].assignedStaff.push({
    name: name,
    timeType: 'usual',
    customStart: AppState.baseWorkStart,
    customEnd: AppState.baseWorkEnd
  });
  renderIndividualSettings();
}
function removeStaffFromSetting(idx, aIdx) {
  AppState.individualSettings[idx].assignedStaff.splice(aIdx, 1);
  renderIndividualSettings();
}
function updateAssignedStaffTimeType(idx, aIdx, type) {
  AppState.individualSettings[idx].assignedStaff[aIdx].timeType = type;
  renderIndividualSettings();
}
function updateAssignedStaffTime(idx, aIdx, field, val) {
  AppState.individualSettings[idx].assignedStaff[aIdx][field] = val;
}

/* ============================================================
 * スタッフ登録管理（localStorage永続化）
 * ============================================================ */
function loadRegisteredStaff() {
  try {
    const data = localStorage.getItem(LS_KEY_STAFF);
    if (data) {
      AppState.registeredStaff = JSON.parse(data);
    }
  } catch (e) {
    console.warn('スタッフデータの読み込みに失敗:', e);
  }
}

function saveRegisteredStaff() {
  localStorage.setItem(LS_KEY_STAFF, JSON.stringify(AppState.registeredStaff));
}

/**
 * 登録済みスタッフデータをJSONファイルとしてダウンロードする
 */
function backupStaffData() {
  if (AppState.registeredStaff.length === 0) {
    showToast('バックアップするスタッフデータがありません。', 'error');
    return;
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    staff: AppState.registeredStaff
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const anchor    = document.createElement('a');
  anchor.href     = url;
  anchor.download = `スタッフデータ_${dateStr}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  showToast(`スタッフデータ（${AppState.registeredStaff.length}名）をバックアップしました。`, 'success');
}

/**
 * JSONファイルから登録済みスタッフデータを復元する
 * @param {HTMLInputElement} input
 */
function restoreStaffData(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = ''; // 同じファイルを再選択できるようリセット

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);

      // バージョン1形式 { version, staff: [...] } または旧形式の配列 [...] に対応
      let staffArray;
      if (Array.isArray(parsed)) {
        staffArray = parsed;
      } else if (parsed && Array.isArray(parsed.staff)) {
        staffArray = parsed.staff;
      } else {
        throw new Error('スタッフ配列が見つかりません。');
      }

      // 最低限のバリデーション
      for (const s of staffArray) {
        if (typeof s.name !== 'string' || !s.name.trim()) {
          throw new Error('スタッフ名が不正なデータが含まれています。');
        }
      }

      const existingCount = AppState.registeredStaff.length;
      if (existingCount > 0) {
        const mode = confirm(
          `現在${existingCount}名のスタッフが登録されています。\n\n` +
          `【OK】既存データを上書きして復元\n` +
          `【キャンセル】既存データに追記して復元`
        );
        if (mode) {
          // 上書き
          AppState.registeredStaff = staffArray;
        } else {
          // 追記（重複名はスキップ）
          let added = 0;
          for (const s of staffArray) {
            if (!AppState.registeredStaff.some(r => r.name === s.name)) {
              AppState.registeredStaff.push(s);
              added++;
            }
          }
          showToast(`${added}名を追記しました（重複スキップ: ${staffArray.length - added}名）。`, 'info');
          saveRegisteredStaff();
          renderRegisteredStaffList();
          return;
        }
      } else {
        AppState.registeredStaff = staffArray;
      }

      saveRegisteredStaff();
      renderRegisteredStaffList();
      showToast(`${staffArray.length}名のスタッフデータを復元しました。`, 'success');

    } catch (err) {
      showToast('復元に失敗しました：' + err.message, 'error');
    }
  };
  reader.onerror = () => showToast('ファイルの読み込みに失敗しました。', 'error');
  reader.readAsText(file, 'utf-8');
}

function setupStaffRegistration() {
  document.getElementById('registerStaffBtn').addEventListener('click', registerNewStaff);
}

function registerNewStaff() {
  const name     = document.getElementById('regStaffName').value.trim();
  const category = document.getElementById('regStaffCategory').value;

  if (!name) {
    showToast('スタッフ名を入力してください。', 'error');
    return;
  }
  if (!category) {
    showToast('区分を選択してください。', 'error');
    return;
  }

  // 重複チェック
  if (AppState.registeredStaff.some(s => s.name === name)) {
    showToast(`「${name}」は既に登録されています。`, 'error');
    return;
  }

  const monthlyRaw = document.getElementById('regMonthlyHours').value;
  const weeklyRaw  = document.getElementById('regWeeklyHours').value;
  const dailyRaw   = document.getElementById('regDailyHours').value;
  const startRaw   = document.getElementById('regAvailStart').value;
  const endRaw     = document.getElementById('regAvailEnd').value;

  const staff = {
    name,
    category,
    monthlyHours:   monthlyRaw ? parseFloat(monthlyRaw) : null,
    weeklyHours:    weeklyRaw  ? parseFloat(weeklyRaw)  : null,
    dailyHours:     dailyRaw   ? parseFloat(dailyRaw)   : null,
    availableStart: startRaw   ? parseFloat(startRaw)     : null,
    availableEnd:   endRaw     ? parseFloat(endRaw)       : null
  };

  AppState.registeredStaff.push(staff);
  saveRegisteredStaff();
  renderRegisteredStaffList();

  // フォームリセット
  document.getElementById('regStaffName').value     = '';
  document.getElementById('regStaffCategory').value = '';
  document.getElementById('regMonthlyHours').value  = '';
  document.getElementById('regWeeklyHours').value   = '';
  document.getElementById('regDailyHours').value    = '';
  document.getElementById('regAvailStart').value    = '';
  document.getElementById('regAvailEnd').value      = '';

  showToast(`「${name}」を登録しました。`, 'success');
}

function removeRegisteredStaff(idx) {
  const name = AppState.registeredStaff[idx].name;
  AppState.registeredStaff.splice(idx, 1);
  saveRegisteredStaff();
  renderRegisteredStaffList();
  showToast(`「${name}」を削除しました。`, 'info');
}

/**
 * 登録済みスタッフの編集モードに切り替える
 */
function editRegisteredStaff(idx) {
  const container = document.getElementById('registeredStaffList');
  const cards = container.querySelectorAll('.reg-staff-card');
  const card = cards[idx];
  if (!card) return;

  const staff = AppState.registeredStaff[idx];

  // 時間セレクト用オプション生成
  function timeOptions(selected) {
    let html = '<option value="">---</option>';
    for (let h = 5; h <= 26; h += 0.25) {
      const isNextDay = h >= 24;
      const dh = isNextDay ? Math.floor(h - 24) : Math.floor(h);
      const mStr = String(Math.round((h % 1) * 60)).padStart(2, '0');
      const suffix = isNextDay ? '(翌)' : '';
      const sel = (selected !== null && h === selected) ? ' selected' : '';
      html += `<option value="${h}"${sel}>${dh}時${mStr}分${suffix}</option>`;
    }
    return html;
  }

  card.className = 'reg-staff-card editing';
  card.innerHTML = `
    <div class="edit-row">
      <div class="edit-field">
        <label>スタッフ名</label>
        <input type="text" class="form-input sm edit-name" value="${escapeHtml(staff.name)}">
      </div>
      <div class="edit-field">
        <label>区分</label>
        <select class="select-input sm edit-category">
          <option value="employee" ${staff.category === 'employee' ? 'selected' : ''}>社員</option>
          <option value="community" ${staff.category === 'community' ? 'selected' : ''}>コミュニティ</option>
        </select>
      </div>
      <div class="edit-field">
        <label>月所定</label>
        <div class="setting-field">
          <input type="number" class="form-input sm edit-monthly" value="${staff.monthlyHours ?? ''}" placeholder="160" min="0" max="400">
          <span class="setting-unit">h</span>
        </div>
      </div>
      <div class="edit-field">
        <label>週所定</label>
        <div class="setting-field">
          <input type="number" class="form-input sm edit-weekly" value="${staff.weeklyHours ?? ''}" placeholder="40" min="0" max="168">
          <span class="setting-unit">h</span>
        </div>
      </div>
      <div class="edit-field">
        <label>1日</label>
        <div class="setting-field">
          <input type="number" class="form-input sm edit-daily" value="${staff.dailyHours ?? ''}" placeholder="8" min="0" max="24" step="0.5">
          <span class="setting-unit">h</span>
        </div>
      </div>
      <div class="edit-field">
        <label>勤務可能</label>
        <div class="time-range-row compact">
          <select class="select-input time-select sm edit-avail-start">${timeOptions(staff.availableStart)}</select>
          <span class="time-separator">〜</span>
          <select class="select-input time-select sm edit-avail-end">${timeOptions(staff.availableEnd)}</select>
        </div>
      </div>
    </div>
    <div class="edit-actions">
      <button class="btn btn-primary btn-sm" type="button" onclick="saveEditRegisteredStaff(${idx})">保存</button>
      <button class="btn btn-secondary btn-sm" type="button" onclick="renderRegisteredStaffList()">キャンセル</button>
    </div>
  `;
}

/**
 * 編集内容を保存する
 */
function saveEditRegisteredStaff(idx) {
  const container = document.getElementById('registeredStaffList');
  const cards = container.querySelectorAll('.reg-staff-card');
  const card = cards[idx];
  if (!card) return;

  const name     = card.querySelector('.edit-name').value.trim();
  const category = card.querySelector('.edit-category').value;

  if (!name) {
    showToast('スタッフ名を入力してください。', 'error');
    return;
  }
  if (!category) {
    showToast('区分を選択してください。', 'error');
    return;
  }

  // 名前変更時の重複チェック（自分以外）
  const duplicate = AppState.registeredStaff.some((s, i) => i !== idx && s.name === name);
  if (duplicate) {
    showToast(`「${name}」は既に登録されています。`, 'error');
    return;
  }

  const monthlyRaw = card.querySelector('.edit-monthly').value;
  const weeklyRaw  = card.querySelector('.edit-weekly').value;
  const dailyRaw   = card.querySelector('.edit-daily').value;
  const startRaw   = card.querySelector('.edit-avail-start').value;
  const endRaw     = card.querySelector('.edit-avail-end').value;

  AppState.registeredStaff[idx] = {
    name,
    category,
    monthlyHours:   monthlyRaw ? parseFloat(monthlyRaw) : null,
    weeklyHours:    weeklyRaw  ? parseFloat(weeklyRaw)  : null,
    dailyHours:     dailyRaw   ? parseFloat(dailyRaw)   : null,
    availableStart: startRaw   ? parseFloat(startRaw)     : null,
    availableEnd:   endRaw     ? parseFloat(endRaw)       : null
  };

  saveRegisteredStaff();
  renderRegisteredStaffList();
  showToast(`「${name}」の情報を更新しました。`, 'success');
}

function renderRegisteredStaffList() {
  const container = document.getElementById('registeredStaffList');
  container.innerHTML = '';

  const badge = document.getElementById('registeredStaffCount');
  if (badge) {
    badge.textContent = AppState.registeredStaff.length > 0
      ? `${AppState.registeredStaff.length}名登録済み`
      : '';
  }

  if (AppState.registeredStaff.length === 0) {
    container.innerHTML = '<p class="empty-message">登録済みスタッフはいません</p>';
    return;
  }

  AppState.registeredStaff.forEach((staff, idx) => {
    const card = document.createElement('div');
    card.className = 'reg-staff-card';

    const catLabel = staff.category === 'employee' ? '社員' : 'コミュニティ';
    const catClass = staff.category === 'employee' ? 'cat-employee' : 'cat-community';

    const mh = staff.monthlyHours !== null ? `${staff.monthlyHours}h/月` : '-';
    const wh = staff.weeklyHours  !== null ? `${staff.weeklyHours}h/週`  : '-';
    const dh = staff.dailyHours   !== null ? `${staff.dailyHours}h/日`   : '-';

    let avail = '-';
    if (staff.availableStart !== null && staff.availableEnd !== null) {
      avail = `${formatHour(staff.availableStart)}〜${formatHour(staff.availableEnd)}`;
    }

    card.innerHTML = `
      <span class="reg-name">${escapeHtml(staff.name)}</span>
      <span class="reg-cat ${catClass}">${catLabel}</span>
      <span class="reg-info">${mh}</span>
      <span class="reg-info">${wh}</span>
      <span class="reg-info">${dh}</span>
      <span class="reg-info">${avail}</span>
      <div class="reg-actions">
        <button class="btn-edit" type="button" onclick="editRegisteredStaff(${idx})" title="編集">✏️</button>
        <button class="btn-remove" type="button" onclick="removeRegisteredStaff(${idx})">削除</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function formatHour(h) {
  if (h === null || h === undefined || h === '') return '';
  const isNextDay = h >= 24;
  const displayH = isNextDay ? Math.floor(h - 24) : Math.floor(h);
  const mStr = String(Math.round((h % 1) * 60)).padStart(2, '0');
  const suffix = isNextDay ? '翌' : '';
  // コンパクト形式：「9:00」「21:00翌」
  return `${displayH}:${mStr}${suffix}`;
}

/* ============================================================
 * ドラッグ＆ドロップとファイル選択
 * ============================================================ */
function setupDropzone() {
  const dropzone  = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');

  uploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target !== uploadBtn) {
      fileInput.click();
    }
  });
}

function setupActionButtons() {
  document.getElementById('generateBtn').addEventListener('click', generateAllShifts);
  document.getElementById('resetBtn').addEventListener('click', resetAll);
  document.getElementById('exportBtn').addEventListener('click', exportCSV);
}

function checkXLSXLibrary() {
  setTimeout(() => {
    if (typeof XLSX === 'undefined') {
      const warn = document.getElementById('xlsxWarning');
      if (warn) warn.style.display = 'flex';
      console.error('SheetJS (xlsx.js) が読み込まれていません。');
    }
  }, 1500);
}

/* ============================================================
 * ファイル処理
 * ============================================================ */

/**
 * 複数ファイルの読み込みと処理
 */
async function handleFiles(files) {
  if (!files || files.length === 0) return;

  if (typeof XLSX === 'undefined') {
    showToast('SheetJSライブラリが読み込まれていません。\nxlsx.full.min.jsをダウンロードして同じフォルダに配置してください。', 'error');
    return;
  }

  const successes = [];
  const errors    = [];
  const updated   = [];

  for (const file of Array.from(files)) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      errors.push(`"${file.name}": .xlsx または .xls ファイルではありません`);
      continue;
    }

    try {
      const staff = await parseExcelFile(file);

      // 同名スタッフが既存なら更新、なければ追加
      const existingIdx = AppState.staffList.findIndex(s => s.name === staff.name);
      if (existingIdx >= 0) {
        AppState.staffList[existingIdx].requests = staff.requests;
        updated.push(staff.name);
      } else {
        AppState.staffList.push(staff);
        successes.push(staff.name);
      }
    } catch (err) {
      errors.push(`"${file.name}": ${err.message}`);
    }
  }

  // 通知メッセージ
  if (successes.length > 0) {
    showToast(`読み込み完了：${successes.join('、')}`, 'success');
  }
  if (updated.length > 0) {
    showToast(`データ更新：${updated.join('、')}`, 'info');
  }
  if (errors.length > 0) {
    showToast('エラー:\n' + errors.join('\n'), 'error');
  }

  // UIを更新
  if (AppState.staffList.length > 0) {
    renderStaffList();
    document.getElementById('section-staff').style.display   = '';
    document.getElementById('section-individual-settings').style.display = '';
    document.getElementById('section-actions').style.display = '';
    updateManualRegisteredList();
    // Excelアップロード後の警告チェックボックスを描画
    renderExcelUploadWarnings();
  }

  document.getElementById('fileInput').value = '';
}

/**
 * Excelアップロード済みスタッフの希望休に対する警告を描画する
 */
function renderExcelUploadWarnings() {
  const container = document.getElementById('excelWarnings');
  if (!container) return;

  let html = '';
  for (const s of AppState.staffList) {
    const redCount  = Object.values(s.requests).filter(v => v === 'red').length;
    const blueCount = Object.values(s.requests).filter(v => v === 'blue').length;
    const safeName  = s.name.replace(/\s/g, '_');

    if (redCount >= 3) {
      const key = `warn-toomanyred-excelWarnings-${safeName}`;
      const checked = document.getElementById(key)?.checked ? 'checked' : '';
      html += `
        <div class="req-warning">
          <label>
            <input type="checkbox" id="${key}" ${checked}>
            ⚠️ 「${escapeHtml(s.name)}」の希望休が${redCount}つ以上選択されていますがよろしいですか？
          </label>
        </div>
      `;
    }
    if (redCount <= 1 && blueCount >= 1) {
      const key = `warn-fewred-excelWarnings-${safeName}`;
      const checked = document.getElementById(key)?.checked ? 'checked' : '';
      html += `
        <div class="req-warning">
          <label>
            <input type="checkbox" id="${key}" ${checked}>
            ⚠️ 「${escapeHtml(s.name)}」の希望休が2つ未満で休日が入力されていますがよろしいですか？
          </label>
        </div>
      `;
    }
  }
  container.innerHTML = html;
}

/**
 * Excelファイルを読み込んでスタッフデータに変換
 */
function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const uint8Data = new Uint8Array(e.target.result);
        const workbook  = XLSX.read(uint8Data, {
          type:       'array',
          cellDates:  false,
          cellNF:     false,
          cellText:   true
        });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('シートが見つかりません');
        }

        const sheetName = workbook.SheetNames[0];
        const sheet     = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(sheet, {
          header:  1,
          defval:  '',
          raw:     false
        });

        if (!rows || rows.length === 0) {
          throw new Error('シートにデータがありません');
        }

        // シフト期間を取得
        const period = getCurrentPeriod();

        // ファイル名からスタッフ名のヒントを取得
        const rawName = file.name.replace(/\.(xlsx|xls)$/i, '').trim();

        // ヘッダー行（1行目）からスタッフの列を自動検出
        let staffColIndex = 1; // デフォルトはB列
        const headerRow = rows[0] || [];

        // デバッグ: ヘッダー行を出力
        console.log(`[Excel生データ] ${file.name}: 全${rows.length}行`);
        console.log(`  ヘッダー: [${headerRow.map((c, ci) => `col${ci}="${c}"`).join(', ')}]`);

        // ヘッダー内でファイル名に含まれるスタッフ名を探す
        // 登録済みスタッフとの照合も試みる
        const matchedStaff = findMatchingRegisteredStaff(rawName);
        const searchName = matchedStaff ? matchedStaff.name : rawName;

        let foundCol = false;
        for (let ci = 1; ci < headerRow.length; ci++) {
          const colHeader = String(headerRow[ci] || '').trim();
          if (!colHeader) continue;

          // ヘッダーのスタッフ名がファイル名に含まれている、
          // またはファイル名がヘッダーのスタッフ名を含んでいる
          if (rawName.includes(colHeader) || colHeader.includes(searchName)) {
            staffColIndex = ci;
            foundCol = true;
            console.log(`[列検出] ${file.name}: ヘッダー"${colHeader}" → col${ci}に一致`);
            break;
          }
        }

        if (!foundCol) {
          // フォールバック: ファイルに1列しかデータがなければアイル（A列=日付, B列=希望）
          if (headerRow.length <= 2) {
            staffColIndex = 1;
            console.log(`[列検出] ${file.name}: 2列構成のためcol1をそのまま使用`);
          } else {
            console.warn(`[列検出] ${file.name}: ヘッダーにスタッフ名"${searchName}"が見つかりません。col1(${headerRow[1]})を使用します`);
          }
        }

        // 希望情報を解析
        const requests     = {};
        let   validRowCount = 0;

        for (let ri = 1; ri < rows.length; ri++) {  // ヘッダー行はスキップ
          const row = rows[ri];
          if (!row || row.length === 0) continue;

          const dayCell = row[0];
          const dayNum = parseDay(dayCell);
          if (dayNum === null) continue;

          // 日番号をperiodのインデックスにマッピング
          const dayIndex = mapDayToPeriodIndex(dayNum, period);
          if (dayIndex < 0) continue;

          validRowCount++;

          // 検出したスタッフ列を読み取る
          const reqCell = row[staffColIndex];
          const reqType = detectRequestType(reqCell);

          if (reqType) {
            requests[dayIndex] = reqType;
          }
        }

        if (validRowCount === 0) {
          throw new Error(
            '有効なデータ行が見つかりません。\n' +
            'A列に日付（21〜翌月20の数値）、希望内容のある列に「休（赤）」「休（青）」を入力してください。'
          );
        }

        // rawName, matchedStaff は上方で取得済み
        // 設定を構築
        let settings;
        if (matchedStaff) {
          settings = {
            category:       matchedStaff.category,
            monthlyHours:   matchedStaff.monthlyHours   ?? 160,
            weeklyHours:    matchedStaff.weeklyHours    ?? 40,
            dailyHours:     matchedStaff.dailyHours     ?? 8,
            availableStart: matchedStaff.availableStart  ?? null,
            availableEnd:   matchedStaff.availableEnd    ?? null
          };
        } else {
          settings = {
            category:       '',
            monthlyHours:   160,
            weeklyHours:    40,
            dailyHours:     8,
            availableStart: null,
            availableEnd:   null
          };
        }

        // デバッグ: 読み取り結果のサマリを出力
        const staffName = matchedStaff ? matchedStaff.name : rawName;
        const reqEntries = Object.entries(requests);
        console.log(`[Excel解析完了] "${staffName}" (file: ${file.name}): 有効行=${validRowCount}, 希望休=${reqEntries.length}件`);
        reqEntries.forEach(([idx, type]) => {
          const pd = period.days[idx];
          console.log(`  ${pd ? pd.month + '/' + pd.day : '?'}(idx=${idx}) → ${type}`);
        });

        resolve({
          name: staffName,
          matchedRegistered: matchedStaff,
          requests,
          settings
        });

      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 日の数値をperiodのインデックスにマッピング
 * day >= 21 → 開始月の日
 * day <= 20 → 翌月の日
 */
function mapDayToPeriodIndex(dayNum, period) {
  for (let i = 0; i < period.days.length; i++) {
    const pd = period.days[i];
    if (pd.day === dayNum) {
      if (dayNum >= 21 && pd.month === period.startMonth) return i;
      if (dayNum <= 20 && pd.month === period.endMonth) return i;
    }
  }
  return -1;
}

/**
 * ファイル名に含まれる登録済みスタッフを検索（最長一致）
 */
function findMatchingRegisteredStaff(filename) {
  let bestMatch  = null;
  let bestLength = 0;

  for (const staff of AppState.registeredStaff) {
    if (filename.includes(staff.name) && staff.name.length > bestLength) {
      bestMatch  = staff;
      bestLength = staff.name.length;
    }
  }
  return bestMatch;
}

/**
 * セル値から日付（1〜31）を解析
 */
function parseDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();

  // "4/22" または "2024/4/22"
  const slashMatch = str.match(/(?:\d{1,4}\/)?\d{1,2}\/(\d{1,2})/);
  if (slashMatch) return parseInt(slashMatch[1], 10);

  // "4月22日" または "4月22"
  const jpMatch = str.match(/\d{1,2}月(\d{1,2})日?/);
  if (jpMatch) return parseInt(jpMatch[1], 10);

  // その他の数字始まり（"22" など）
  const match = str.match(/^(\d{1,2})/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 31) return n;
  }

  return null;
}

/**
 * セル値から希望タイプを判定
 */
function detectRequestType(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';

  // 希望休 → red（絶対休み）
  if (
    str.includes('希望休') ||
    str.includes('赤') ||
    str === '×' ||
    str.toUpperCase() === 'R' ||
    str === '■'
  ) {
    return 'red';
  }

  // 休日 → blue（できれば休み）
  if (
    str.includes('休日') ||
    str.includes('青') ||
    str.toUpperCase() === 'B' ||
    str === '△'
  ) {
    return 'blue';
  }

  // 単独「休」はblueとして扱う（後方互換）
  if (str === '休' || str.includes('やすみ') || str.includes('ヤスミ')) {
    return 'blue';
  }

  return '';
}

/* ============================================================
 * UIレンダリング: スタッフ設定リスト（STEP 4）
 * ============================================================ */

function renderStaffList() {
  const container = document.getElementById('staffList');
  container.innerHTML = '';

  const badge = document.getElementById('staffCount');
  if (badge) badge.textContent = `${AppState.staffList.length}名`;

  const period = getCurrentPeriod();

  AppState.staffList.forEach((staff, idx) => {
    const redDays  = Object.values(staff.requests).filter(v => v === 'red').length;
    const blueDays = Object.values(staff.requests).filter(v => v === 'blue').length;

    const card = document.createElement('div');
    card.className = 'staff-card-v2';
    card.dataset.idx = idx;

    const catLabel = staff.settings.category === 'employee' ? '社員' :
                     staff.settings.category === 'community' ? 'コミュニティ' : '未設定';
    const catClass = staff.settings.category === 'employee' ? 'cat-employee' :
                     staff.settings.category === 'community' ? 'cat-community' : 'cat-unknown';

    let availHtml = '';
    if (staff.settings.availableStart !== null && staff.settings.availableEnd !== null) {
      // コンパクト形式：「9:00〜21:00」
      availHtml = `${formatHour(staff.settings.availableStart)}〜${formatHour(staff.settings.availableEnd)}`;
    } else {
      availHtml = '制限なし';
    }

    // カテゴリセレクト
    const catSelectHtml = `
      <select class="select-input xs" data-idx="${idx}" data-field="category" onchange="updateStaffSetting(this)">
        <option value="" ${staff.settings.category === '' ? 'selected' : ''}>未設定</option>
        <option value="employee" ${staff.settings.category === 'employee' ? 'selected' : ''}>社員</option>
        <option value="community" ${staff.settings.category === 'community' ? 'selected' : ''}>コミュニティ</option>
      </select>
    `;

    card.innerHTML = `
      <!-- スタッフ名（1行目全幅） -->
      <div class="staff-name-v2">${escapeHtml(staff.name)}
        ${staff.matchedRegistered ? '<span class="match-badge">自動紐づけ</span>' : ''}
        ${staff.settings.category === 'community' ? '<span class="strict-badge">±0厳守</span>' : ''}
      </div>

      <!-- 区分 -->
      <div class="staff-cat-cell">${catSelectHtml}</div>

      <!-- 月所定 -->
      <div class="setting-field-labeled">
        <span class="field-label">月所定</span>
        <div class="setting-field">
          <input type="number" class="setting-input xs" value="${staff.settings.monthlyHours}"
                 min="0" max="400" step="1" data-idx="${idx}" data-field="monthlyHours"
                 onchange="updateStaffSetting(this)" oninput="updateStaffSetting(this)">
          <span class="setting-unit">h/月</span>
        </div>
      </div>

      <!-- 週所定 -->
      <div class="setting-field-labeled">
        <span class="field-label">週所定</span>
        <div class="setting-field">
          <input type="number" class="setting-input xs" value="${staff.settings.weeklyHours}"
                 min="0" max="168" step="1" data-idx="${idx}" data-field="weeklyHours"
                 onchange="updateStaffSetting(this)" oninput="updateStaffSetting(this)">
          <span class="setting-unit">h/週</span>
        </div>
      </div>

      <!-- 1日 -->
      <div class="setting-field-labeled">
        <span class="field-label">1日勤務</span>
        <div class="setting-field">
          <input type="number" class="setting-input xs" value="${staff.settings.dailyHours}"
                 min="1" max="24" step="0.5" data-idx="${idx}" data-field="dailyHours"
                 onchange="updateStaffSetting(this)" oninput="updateStaffSetting(this)">
          <span class="setting-unit">h/日</span>
        </div>
        <div class="break-toggle-container" id="break-toggle-${idx}"
             style="display: ${staff.settings.dailyHours === 5 ? 'block' : 'none'};">
          <label style="font-size:11px; color:#555; display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" data-idx="${idx}" data-field="hasBreak5h"
                   ${staff.settings.hasBreak5h !== false ? 'checked' : ''}
                   onchange="updateStaffSettingCheckbox(this)">
            休憩あり(1h)
          </label>
        </div>
      </div>

      <!-- 勤務可能時間 -->
      <div class="staff-avail-cell">
        <span class="staff-avail-value">${availHtml}</span>
      </div>

      <!-- 希望バッジ -->
      <div class="staff-badges-group">
        <div class="staff-badges">
          ${redDays  > 0 ? `<span class="badge badge-red">希望休:${redDays}日</span>` : ''}
          ${blueDays > 0 ? `<span class="badge badge-blue">休日:${blueDays}日</span>` : '<span class="badge-none">希望なし</span>'}
        </div>
      </div>

      <!-- 削除ボタン -->
      <button class="btn-remove" type="button" onclick="removeStaff(${idx})">削除</button>
    `;

    container.appendChild(card);
  });
}

/**
 * スタッフ設定の更新
 */
function updateStaffSetting(input) {
  const idx   = parseInt(input.dataset.idx);
  const field = input.dataset.field;

  if (idx < 0 || idx >= AppState.staffList.length) return;

  if (field === 'category') {
    AppState.staffList[idx].settings.category = input.value;
  } else {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) {
      AppState.staffList[idx].settings[field] = val;
      if (field === 'dailyHours') {
        const toggle = document.getElementById(`break-toggle-${idx}`);
        if (toggle) {
          toggle.style.display = val === 5 ? 'block' : 'none';
        }
      }
    }
  }
}

function updateStaffSettingCheckbox(input) {
  const idx = parseInt(input.dataset.idx);
  const field = input.dataset.field;
  if (idx < 0 || idx >= AppState.staffList.length) return;
  AppState.staffList[idx].settings[field] = input.checked;
}

/**
 * スタッフの削除
 */
function removeStaff(idx) {
  AppState.staffList.splice(idx, 1);

  if (AppState.staffList.length === 0) {
    document.getElementById('section-staff').style.display   = 'none';
    document.getElementById('section-actions').style.display = 'none';
    document.getElementById('section-result').style.display  = 'none';
  } else {
    renderStaffList();
  }
  showToast('スタッフを削除しました', 'info');
}

/* ============================================================
 * シフト生成 - メイン
 * ============================================================ */

/**
 * 全スタッフの未チェック警告を収集する
 * @returns {string[]} 未チェック警告メッセージの配列
 */
function collectUncheckedWarnings() {
  const msgs = [];
  for (const s of AppState.staffList) {
    const redCount  = Object.values(s.requests).filter(v => v === 'red').length;
    const blueCount = Object.values(s.requests).filter(v => v === 'blue').length;
    const safeName  = s.name.replace(/\s/g, '_');

    // Excel側とManual側の両方のキーを確認
    const sources = ['excelWarnings', `manualWarnings`];

    if (redCount >= 3) {
      let checked = false;
      for (const src of sources) {
        const cb = document.getElementById(`warn-toomanyred-${src}-${safeName}`);
        if (cb && cb.checked) { checked = true; break; }
      }
      if (!checked) {
        msgs.push(`「${s.name}」: 希望休が${redCount}つ以上選択されています`);
      }
    }

    if (redCount <= 1 && blueCount >= 1) {
      let checked = false;
      for (const src of sources) {
        const cb = document.getElementById(`warn-fewred-${src}-${safeName}`);
        if (cb && cb.checked) { checked = true; break; }
      }
      if (!checked) {
        msgs.push(`「${s.name}」: 希望休が2つ未満で休日が入力されています`);
      }
    }
  }
  return msgs;
}


function generateAllShifts() {
  if (AppState.staffList.length === 0) {
    showToast('スタッフデータがありません。Excelファイルを読み込んでください。', 'error');
    return;
  }

  // 未チェックの警告があればシフト生成を止める
  const uncheckedWarnings = collectUncheckedWarnings();
  if (uncheckedWarnings.length > 0) {
    showToast(
      '以下の項目を確認してチェックボックスにチェックを入れてください：\n' +
      uncheckedWarnings.join('\n'),
      'error',
      6000
    );
    return;
  }

  const period = getCurrentPeriod();
  const totalDays = period.totalDays;

  // Phase 1: 各スタッフの個別シフト生成
  AppState.results = AppState.staffList.map(staff =>
    generateShiftForStaff(staff, totalDays)
  );

  // Phase 2: グローバル制約の適用
  applyGlobalConstraints(totalDays, period);

  // Phase 3: 時間帯の計算
  calculateAllShiftTimes(period);

  // 結果を表示
  renderResults();

  const resultSection = document.getElementById('section-result');
  resultSection.style.display = '';
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const period2 = getCurrentPeriod();
  showToast(
    `シフト表を生成しました（${AppState.year}年 ${period2.label} / ${AppState.staffList.length}名）`,
    'success'
  );
}

/* ============================================================
 * シフト生成 - コアアルゴリズム（個別スタッフ）
 * ============================================================ */

/**
 * 1スタッフのシフトを生成する（均等配置版）
 */
function generateShiftForStaff(staff, totalDays) {
  const { name, requests, settings } = staff;
  const { monthlyHours, dailyHours } = settings;

  const requiredWorkDays = Math.round(monthlyHours / dailyHours);

  // 赤・青の集計
  const redDays  = [];
  const blueDays = [];
  const freeDays = []; // 制約なしの日
  const overrideDays = new Set();
  
  for (let d = 0; d < totalDays; d++) {
    const custom = AppState.individualSettings.find(s => s.staffAssignmentType === 'specific' && s.dates.includes(d) && s.assignedStaff.find(as => as.name === name));
    if (custom) {
      overrideDays.add(d);
    }
  }

  for (let d = 0; d < totalDays; d++) {
    if (overrideDays.has(d)) continue; // 強制出勤なので休みの候補から外す

    if (requests[d] === 'red') {
      redDays.push(d);
    } else if (requests[d] === 'blue') {
      blueDays.push(d);
    } else {
      freeDays.push(d);
    }
  }

  const availableDays = freeDays.length + blueDays.length;
  const targetWorkDays = Math.min(requiredWorkDays, availableDays);
  const neededOffDays  = availableDays - targetWorkDays;

  // ─ コミュニティスタッフの±0厳守チェック ─
  // 赤休が多すぎてどうしても達成不可能な場合のみ警告をコンソールへ出す
  if (settings.category === 'community' && requiredWorkDays > availableDays) {
    console.warn(
      `[±0厳守] "${name}": 赤休が多く目標${requiredWorkDays}日に対し` +
      `出勤可能日${availableDays}日しかないため上限で確定します`
    );
  }

  // Step 1: 赤は絶対休み、overrideは絶対出勤
  const shifts = {};
  for (let d = 0; d < totalDays; d++) {
    if (overrideDays.has(d)) {
      shifts[d] = 'work';
    } else if (requests[d] === 'red') {
      shifts[d] = 'off-red';
    } else {
      shifts[d] = 'work';
    }
  }

  // Step 2: 青希望休の優先処理（余裕がある分だけ）
  let offAssigned = 0;
  for (const d of blueDays) {
    if (offAssigned < neededOffDays) {
      shifts[d] = 'off-blue';
      offAssigned++;
    }
  }

  // Step 3: 残りの必要休日を free days に等間隔で配置
  if (offAssigned < neededOffDays) {
    const remainingOff = neededOffDays - offAssigned;
    // freeDays の中でまだ work な日を集計
    const workingFreeDays = freeDays.filter(d => shifts[d] === 'work');

    if (remainingOff > 0 && workingFreeDays.length > 0) {
      // 等間隔で選ぶ
      const offIndices = selectEvenlySpaced(workingFreeDays, remainingOff);
      for (const d of offIndices) {
        shifts[d] = 'off';
      }
    }
  }

  // Step 4: 6連勤を解消（override日は変更しない）
  fixConsecutiveRuns(shifts, requests, totalDays, overrideDays);

  // Step 5: 日数の微調整（連勤修正で数がズレた場合、override日は変更しない）
  adjustToTargetCount(shifts, requests, totalDays, targetWorkDays, overrideDays);

  const finalWorkDays = countWorkDays(shifts, totalDays);

  return {
    name,
    staff,
    category: settings.category,
    shifts,
    workDays:    finalWorkDays,
    totalHours:  finalWorkDays * dailyHours,
    targetHours: monthlyHours,
    dailyHours,
    weeklyHours: settings.weeklyHours,
    availableStart: settings.availableStart,
    availableEnd:   settings.availableEnd
  };
}

/**
 * 配列 candidates から count 個を等間隔に選ぶ
 */
function selectEvenlySpaced(candidates, count) {
  if (count >= candidates.length) return [...candidates];
  if (count <= 0) return [];

  const selected = [];
  const step = candidates.length / count;
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step + step / 2 - 0.5);
    selected.push(candidates[Math.min(idx, candidates.length - 1)]);
  }
  return selected;
}

/**
 * 6連勤以上の連続出勤を修正する
 */
function fixConsecutiveRuns(shifts, requests, totalDays, overrideDays = new Set()) {
  let changed  = true;
  let safetyCounter = 0;

  while (changed && safetyCounter < 300) {
    changed = false;
    safetyCounter++;

    let runStart  = -1;
    let runLength = 0;

    for (let d = 0; d < totalDays; d++) {
      if (shifts[d] === 'work') {
        if (runLength === 0) runStart = d;
        runLength++;

        if (runLength > MAX_CONSECUTIVE) {
          const targetDay = selectBreakDay(shifts, requests, runStart, d, overrideDays);

          if (targetDay < 0) {
            // override日ばかりで休めない場合はそのまま
            runStart  = -1;
            runLength = 0;
          } else {
            if (requests[targetDay] === 'blue') {
              shifts[targetDay] = 'off-blue';
            } else {
              shifts[targetDay] = 'off';
            }

            changed  = true;
            runStart  = -1;
            runLength = 0;
            d         = -1;
          }
        }
      } else {
        runStart  = -1;
        runLength = 0;
      }
    }
  }
}

function selectBreakDay(shifts, requests, runStart, runEnd, overrideDays = new Set()) {
  // 青の日を優先（override日以外）
  for (let d = runStart; d <= runEnd; d++) {
    if (requests[d] === 'blue' && shifts[d] === 'work' && !overrideDays.has(d)) {
      return d;
    }
  }
  // override でない work の中間を選ぶ
  const candidates = [];
  for (let d = runStart; d <= runEnd; d++) {
    if (!overrideDays.has(d) && shifts[d] === 'work') candidates.push(d);
  }
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(candidates.length / 2)];
}

/**
 * 目標出勤日数に合わせて微調整
 */
function adjustToTargetCount(shifts, requests, totalDays, target, overrideDays = new Set()) {
  for (let iter = 0; iter < 50; iter++) {
    const current = countWorkDays(shifts, totalDays);
    if (current === target) break;

    if (current > target) {
      // 最も連勤が長い区間の中間にある無制約日を休みにする（override日は除外）
      let bestDay = -1;
      let bestRun = 0;
      let runLen = 0;
      let rStart = -1;
      for (let d = 0; d < totalDays; d++) {
        if (shifts[d] === 'work') {
          if (runLen === 0) rStart = d;
          runLen++;
        } else {
          if (runLen > bestRun) {
            bestRun = runLen;
            const mid = rStart + Math.floor(runLen / 2);
            if (requests[mid] !== 'red' && !overrideDays.has(mid)) bestDay = mid;
          }
          runLen = 0;
        }
      }
      if (runLen > bestRun) {
        const mid = rStart + Math.floor(runLen / 2);
        if (requests[mid] !== 'red' && !overrideDays.has(mid)) bestDay = mid;
      }
      if (bestDay >= 0 && shifts[bestDay] === 'work') {
        shifts[bestDay] = requests[bestDay] === 'blue' ? 'off-blue' : 'off';
      } else {
        // フォールバック: 末尾から探す（override日は除外）
        for (let d = totalDays - 1; d >= 0; d--) {
          if (shifts[d] === 'work' && requests[d] !== 'red' && !overrideDays.has(d)) {
            shifts[d] = 'off';
            break;
          }
        }
      }
    } else {
      // 最も連休が長い区間の中間に出勤を入れる
      let bestDay = -1;
      let bestRun = 0;
      let runLen = 0;
      let rStart = -1;
      for (let d = 0; d < totalDays; d++) {
        if (shifts[d] !== 'work') {
          if (runLen === 0) rStart = d;
          runLen++;
        } else {
          if (runLen > bestRun) {
            for (let r = rStart; r < rStart + runLen; r++) {
              if (requests[r] !== 'red') {
                bestDay = r;
                bestRun = runLen;
                break;
              }
            }
          }
          runLen = 0;
        }
      }
      if (runLen > bestRun) {
        for (let r = rStart; r < rStart + runLen; r++) {
          if (requests[r] !== 'red') {
            bestDay = r;
            break;
          }
        }
      }
      if (bestDay >= 0) {
        shifts[bestDay] = 'work';
      } else {
        for (let d = 0; d < totalDays; d++) {
          if (shifts[d] !== 'work' && requests[d] !== 'red') {
            shifts[d] = 'work';
            break;
          }
        }
      }
    }
  }
}

function countWorkDays(shifts, totalDays) {
  let count = 0;
  for (let d = 0; d < totalDays; d++) {
    if (shifts[d] === 'work') count++;
  }
  return count;
}

/* ============================================================
 * シフト生成 - グローバル制約適用
 * ============================================================ */

/**
 * 最低出勤人数・社員人数・早番遅番の制約を適用
 */
function applyGlobalConstraints(totalDays, period) {
  const MAX_PASSES = 10;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let anyChanged = false;

    for (let d = 0; d < totalDays; d++) {
      // 日別の勤務時間を取得
      const dayWorkTimes = getDayWorkTimes(d);

      // ─ 最低出勤人数チェック ─
      const currentWorkers = AppState.results.filter(r => r.shifts[d] === 'work');
      const deficit = getMinStaffForDay(d) - currentWorkers.length;

      if (deficit > 0) {
        const added = tryAddWorkers(d, deficit, null, totalDays);
        if (added > 0) anyChanged = true;
      }

      // ─ 最低社員人数チェック ─
      const currentEmployees = AppState.results.filter(r =>
        r.shifts[d] === 'work' && r.category === 'employee'
      );
      const empDeficit = getMinEmployeeForDay(d) - currentEmployees.length;

      if (empDeficit > 0) {
        const added = tryAddWorkers(d, empDeficit, 'employee', totalDays);
        if (added > 0) anyChanged = true;
      }

      // ─ 早番チェック ─
      const earlyCount = getEarlyCountForDay(d);
      const earlyWorkers = AppState.results.filter(r =>
        r.shifts[d] === 'work' && canDoEarlyShift(r, dayWorkTimes.start)
      );
      const earlyDeficit = earlyCount - earlyWorkers.length;

      if (earlyDeficit > 0) {
        const added = tryAddEarlyLateWorkers(d, earlyDeficit, 'early', dayWorkTimes, totalDays);
        if (added > 0) anyChanged = true;
      }

      // ─ 遅番チェック ─
      const lateCount = getLateCountForDay(d);
      const lateWorkers = AppState.results.filter(r =>
        r.shifts[d] === 'work' && canDoLateShift(r, dayWorkTimes.end)
      );
      const lateDeficit = lateCount - lateWorkers.length;

      if (lateDeficit > 0) {
        const added = tryAddEarlyLateWorkers(d, lateDeficit, 'late', dayWorkTimes, totalDays);
        if (added > 0) anyChanged = true;
      }
    }

    if (!anyChanged) break;
  }

  // ─ Phase 2.5: 日別出勤人数の平準化 ─
  balanceDailyStaffing(totalDays);

  // 最終的な時間再計算
  AppState.results.forEach(result => {
    const staff = AppState.staffList.find(s => s.name === result.name);
    if (staff) {
      result.workDays   = countWorkDays(result.shifts, totalDays);
      result.totalHours = result.workDays * staff.settings.dailyHours;
    }
  });
}

/**
 * 日別出勤人数を平準化する
 * 出勤者が多い日→少ない日へ、スタッフの出勤/休みをスワップして均す
 */
function balanceDailyStaffing(totalDays) {
  const MAX_BALANCE_PASSES = 30;

  for (let pass = 0; pass < MAX_BALANCE_PASSES; pass++) {
    // 各日の出勤人数を集計
    const dailyCounts = [];
    for (let d = 0; d < totalDays; d++) {
      dailyCounts.push(AppState.results.filter(r => r.shifts[d] === 'work').length);
    }

    const avg = dailyCounts.reduce((a, b) => a + b, 0) / totalDays;
    const maxCount = Math.max(...dailyCounts);
    const minCount = Math.min(...dailyCounts);

    // 差が1以下になったら十分均等
    if (maxCount - minCount <= 1) break;

    // 最も多い日と最も少ない日を見つける
    const maxDay = dailyCounts.indexOf(maxCount);
    const minDay = dailyCounts.indexOf(minCount);

    // maxDayで出勤中 かつ minDayで休みのスタッフを探してスワップ
    let swapped = false;
    for (const result of AppState.results) {
      // コミュニティスタッフは±0厳守のため平準化スワップ対象外
      if (result.category === 'community') continue;

      if (result.shifts[maxDay] !== 'work') continue;
      if (result.shifts[minDay] === 'work') continue;

      // minDayが赤なら不可
      const staff = result.staff || AppState.staffList.find(s => s.name === result.name);
      if (staff && staff.requests[minDay] === 'red') continue;

      // maxDayの方を休みにしてminDayを出勤に
      // ただし6連勤にならないかチェック
      const testShifts = { ...result.shifts };
      testShifts[maxDay] = 'off';
      testShifts[minDay] = 'work';

      if (!wouldCause7Consecutive(testShifts, totalDays)) {
        result.shifts[maxDay] = 'off';
        result.shifts[minDay] = 'work';
        swapped = true;
        break;
      }
    }

    if (!swapped) break; // これ以上改善できない
  }
}

/**
 * 7連勤以上が発生するかチェック
 */
function wouldCause7Consecutive(shifts, totalDays) {
  let run = 0;
  for (let d = 0; d < totalDays; d++) {
    if (shifts[d] === 'work') {
      run++;
      if (run > MAX_CONSECUTIVE) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/**
 * 指定日の勤務時間を取得（基本 or カスタム）
 */
function getDayWorkTimes(dayIndex) {
  const custom = AppState.individualSettings.reverse().find(s => s.timeType === 'custom' && s.dates.includes(dayIndex));
  AppState.individualSettings.reverse(); // restore order
  if (custom) {
    return { start: custom.workStart, end: custom.workEnd };
  }
  return { start: AppState.baseWorkStart, end: AppState.baseWorkEnd };
}

function getEarlyCountForDay(dayIndex) {
  const custom = AppState.individualSettings.reverse().find(s => s.countType === 'custom' && s.dates.includes(dayIndex));
  AppState.individualSettings.reverse();
  return custom ? custom.earlyCount : AppState.earlyShiftCount;
}

function getLateCountForDay(dayIndex) {
  const custom = AppState.individualSettings.reverse().find(s => s.countType === 'custom' && s.dates.includes(dayIndex));
  AppState.individualSettings.reverse();
  return custom ? custom.lateCount : AppState.lateShiftCount;
}

function getMinStaffForDay(dayIndex) {
  const custom = AppState.individualSettings.reverse().find(s => s.countType === 'custom' && s.dates.includes(dayIndex));
  AppState.individualSettings.reverse();
  return custom ? custom.minStaff : AppState.minStaffPerDay;
}

function getMinEmployeeForDay(dayIndex) {
  const custom = AppState.individualSettings.reverse().find(s => s.countType === 'custom' && s.dates.includes(dayIndex));
  AppState.individualSettings.reverse();
  return custom ? custom.minEmployee : AppState.minEmployeePerDay;
}

function canDoEarlyShift(result, workStart) {
  if (result.availableStart === null) return true; // 未設定=制限なし
  return result.availableStart <= workStart;
}

function canDoLateShift(result, workEnd) {
  if (result.availableEnd === null) return true;
  return result.availableEnd >= workEnd;
}

/**
 * 指定日に追加で出勤させるスタッフを選ぶ
 * ※ コミュニティスタッフは目標時間に達している場合は追加しない（±0厳守）
 */
function tryAddWorkers(dayIndex, count, categoryFilter, totalDays) {
  let added = 0;
  const candidates = AppState.results.filter(r => {
    if (r.shifts[dayIndex] !== 'off' && r.shifts[dayIndex] !== 'off-blue') return false;
    // 赤休は対象外
    const staff = AppState.staffList.find(s => s.name === r.name);
    if (staff && staff.requests[dayIndex] === 'red') return false;
    // category filter
    if (categoryFilter && r.category !== categoryFilter) return false;
    // コミュニティスタッフ: ±0厳守 → 目標時間に達していたら追加しない
    if (r.category === 'community' && r.totalHours >= r.targetHours) return false;
    // 社員スタッフ: 大幅超過防止（目標+2日分まで許容）
    if (r.category !== 'community' && r.totalHours + r.dailyHours > r.targetHours + r.dailyHours * 2) return false;
    return true;
  });

  // 時間差分が小さい（余裕のある）スタッフを優先
  candidates.sort((a, b) => (a.totalHours - a.targetHours) - (b.totalHours - b.targetHours));

  for (const result of candidates) {
    if (added >= count) break;
    result.shifts[dayIndex] = 'work';
    result.workDays++;
    const staff = AppState.staffList.find(s => s.name === result.name);
    if (staff) result.totalHours += staff.settings.dailyHours;
    added++;
  }

  return added;
}

/**
 * 早番/遅番が可能なスタッフを追加出勤させる
 * ※ コミュニティスタッフは目標時間に達している場合は追加しない（±0厳守）
 */
function tryAddEarlyLateWorkers(dayIndex, count, type, dayWorkTimes, totalDays) {
  let added = 0;
  const candidates = AppState.results.filter(r => {
    if (r.shifts[dayIndex] !== 'off' && r.shifts[dayIndex] !== 'off-blue') return false;
    const staff = AppState.staffList.find(s => s.name === r.name);
    if (staff && staff.requests[dayIndex] === 'red') return false;
    if (type === 'early' && !canDoEarlyShift(r, dayWorkTimes.start)) return false;
    if (type === 'late'  && !canDoLateShift(r, dayWorkTimes.end)) return false;
    // コミュニティスタッフ: ±0厳守
    if (r.category === 'community' && r.totalHours >= r.targetHours) return false;
    // 社員スタッフ: 大幅超過防止
    if (r.category !== 'community' && r.totalHours + r.dailyHours > r.targetHours + r.dailyHours * 2) return false;
    return true;
  });

  candidates.sort((a, b) => (a.totalHours - a.targetHours) - (b.totalHours - b.targetHours));

  for (const result of candidates) {
    if (added >= count) break;
    result.shifts[dayIndex] = 'work';
    result.workDays++;
    const staff = AppState.staffList.find(s => s.name === result.name);
    if (staff) result.totalHours += staff.settings.dailyHours;
    added++;
  }

  return added;
}

/* ============================================================
 * 結果表示
 * ============================================================ */

function renderResults() {
  const container = document.getElementById('resultTable');
  container.innerHTML = '';

  const period = getCurrentPeriod();
  const totalDays = period.totalDays;

  // 結果ヘッダーの月表示
  const monthLabel = document.getElementById('resultMonthLabel');
  if (monthLabel) {
    monthLabel.textContent = `${AppState.year}年 ${period.label}`;
  }

  // テーブル構築
  const table = document.createElement('table');
  table.className = 'shift-table';

  // ── thead ──
  const thead = document.createElement('thead');
  const hRow  = document.createElement('tr');

  const thDate = document.createElement('th');
  thDate.className = 'th-name'; // width等のスタイル流用
  thDate.textContent = '日付';
  hRow.appendChild(thDate);

  const thStaffCount = document.createElement('th');
  thStaffCount.className = 'th-name';
  thStaffCount.innerHTML = '出勤<br>人数';
  hRow.appendChild(thStaffCount);

  const thEmpCount = document.createElement('th');
  thEmpCount.className = 'th-name';
  thEmpCount.innerHTML = '社員<br>人数';
  hRow.appendChild(thEmpCount);

  AppState.results.forEach(result => {
    const thName = document.createElement('th');
    thName.className = 'th-day'; // 縦幅・横幅合わせのため
    thName.textContent = result.name;
    hRow.appendChild(thName);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  // ── tbody (日付ごとの行) ──
  const tbody = document.createElement('tbody');

  for (let i = 0; i < totalDays; i++) {
    const tr = document.createElement('tr');
    const pd = period.days[i];
    const dow = pd.dow;

    // 日付セル
    const tdDate = document.createElement('td');
    tdDate.className = `tf-label${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`;
    tdDate.innerHTML = `<span class="th-month-num">${pd.month}/</span><span class="th-day-num">${pd.day}</span><span class="th-dow">(${DAY_NAMES[dow]})</span>`;
    tr.appendChild(tdDate);

    // 出勤人数セル
    const currentWorkersCount = AppState.results.filter(r => r.shifts[i] === 'work').length;
    const tdStaffCount = document.createElement('td');
    tdStaffCount.className = 'tf-day';
    if (currentWorkersCount < AppState.minStaffPerDay) {
      tdStaffCount.classList.add('tf-day-warning');
    }
    tdStaffCount.textContent = currentWorkersCount;
    tr.appendChild(tdStaffCount);

    // 社員人数セル
    const empCount = AppState.results.filter(r => r.shifts[i] === 'work' && r.category === 'employee').length;
    const tdEmpCount = document.createElement('td');
    tdEmpCount.className = 'tf-day';
    if (empCount < AppState.minEmployeePerDay) {
      tdEmpCount.classList.add('tf-day-warning');
    }
    tdEmpCount.textContent = empCount;
    tr.appendChild(tdEmpCount);

    AppState.results.forEach(result => {
      const shift = result.shifts[i] || 'off';
      const td    = document.createElement('td');
      td.className = `td-shift ${shift}`;
      
      let cellText = '休';
      if (shift === 'work') {
        if (result.shiftTimes && result.shiftTimes[i]) {
          const { start, end } = result.shiftTimes[i];
          cellText = `${formatTimeShort(start)}<br>〜${formatTimeShort(end)}`;
          td.style.fontSize = '10px';
          td.style.lineHeight = '1.2';
        } else {
          cellText = '出';
        }
      } else if (shift === 'off-red') {
        cellText = '希望休';
      } else if (shift === 'off-blue') {
        cellText = '休日';
      }
      
      td.innerHTML = cellText;

      const tipText = getShiftTooltip(shift, result.name, pd);
      if (tipText) td.title = tipText;

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // ── tfoot（集計行）──
  const tfoot = document.createElement('tfoot');

  // 勤務時間行
  const trTotal = document.createElement('tr');
  const tdTotalLabel = document.createElement('td');
  tdTotalLabel.colSpan = 3;
  tdTotalLabel.className = 'tf-label';
  tdTotalLabel.textContent = '勤務時間 (差分)';
  trTotal.appendChild(tdTotalLabel);

  AppState.results.forEach(result => {
    const diff    = result.totalHours - result.targetHours;
    const diffAbs = Math.abs(diff);

    const tdTotal = document.createElement('td');
    tdTotal.className = 'td-total';
    let diffHtml = '';
    if (diffAbs > 0) {
      const cls  = diff > 0 ? 'hours-diff-over' : 'hours-diff-under';
      const sign = diff > 0 ? '+' : '';
      diffHtml = `<br><span class="${cls}">${sign}${diff}h</span>`;
    } else {
      diffHtml = `<br><span class="hours-diff-ok">±0h</span>`;
    }
    tdTotal.innerHTML = `<strong>${result.totalHours}h</strong>${diffHtml}`;
    trTotal.appendChild(tdTotal);
  });
  tfoot.appendChild(trTotal);

  // 目標時間行
  const trTarget = document.createElement('tr');
  const tdTargetLabel = document.createElement('td');
  tdTargetLabel.colSpan = 3;
  tdTargetLabel.className = 'tf-label';
  tdTargetLabel.textContent = '目標時間';
  trTarget.appendChild(tdTargetLabel);

  AppState.results.forEach(result => {
    const tdTarget = document.createElement('td');
    tdTarget.className = 'td-total';
    tdTarget.textContent = `${result.targetHours}h`;
    trTarget.appendChild(tdTarget);
  });
  tfoot.appendChild(trTarget);

  table.appendChild(tfoot);

  container.appendChild(table);
}

function getShiftTooltip(shift, name, periodDay) {
  const dateStr = `${periodDay.month}/${periodDay.day}(${DAY_NAMES[periodDay.dow]})`;
  switch (shift) {
    case 'work':     return `${name} - ${dateStr}：出勤`;
    case 'off-red':  return `${name} - ${dateStr}：希望休`;
    case 'off-blue': return `${name} - ${dateStr}：休日`;
    case 'off':      return `${name} - ${dateStr}：休み（調整）`;
    default:         return '';
  }
}

/* ============================================================
 * 具体的な時間帯の計算
 * ─────────────────────────────────────────────────────────────
 * 早番・遅番の「担当回数カウンタ」を全期間にわたって累積し、
 * 各日の割り当て時に「その時点で累計が最も少ない人」を優先する。
 * → 早番/遅番ができる人が複数いる場合に偏りが出なくなる。
 * ============================================================ */

function formatTimeShort(h) {
  if (h === null || h === undefined || h === '') return '';
  const isNextDay = h >= 24;
  const displayH = isNextDay ? Math.floor(h - 24) : Math.floor(h);
  const mStr = String(Math.round((h % 1) * 60)).padStart(2, '0');
  const suffix = isNextDay ? '(翌)' : '';
  return `${displayH}:${mStr}${suffix}`;
}

function calculateAllShiftTimes(period) {
  const totalDays = period.totalDays;

  // ── 早番・遅番の累計カウンタ（期間を通じて積算）──
  // これを参照して「より少ない人」を優先することで偏りを防ぐ
  const earlyShiftCounts = {};
  const lateShiftCounts  = {};
  AppState.results.forEach(r => {
    earlyShiftCounts[r.name] = 0;
    lateShiftCounts[r.name]  = 0;
  });

  for (let d = 0; d < totalDays; d++) {
    const dayTimes = getDayWorkTimes(d);
    const dayStart = dayTimes.start;
    const dayEnd   = dayTimes.end;

    const earlyReq = getEarlyCountForDay(d);
    const lateReq  = getLateCountForDay(d);

    const working = AppState.results.filter(r => r.shifts[d] === 'work');
    
    // 個別時間指定のカスタム設定を取得
    const customAssignedSettings = AppState.individualSettings.filter(s => 
      s.staffAssignmentType === 'specific' && s.dates.includes(d)
    );

    // ── pool を構築 ──
    const pools = working.map(r => {
      const staffObj = AppState.staffList.find(s => s.name === r.name);
      
      // 個別設定に時間指定があれば優先
      let forcedStart = null;
      let forcedEnd   = null;
      for (let i = customAssignedSettings.length - 1; i >= 0; i--) {
        const as = customAssignedSettings[i].assignedStaff.find(a => a.name === r.name);
        if (as && as.timeType === 'custom') {
          forcedStart = as.customStart;
          forcedEnd   = as.customEnd;
          break;
        }
      }

      const dh = r.dailyHours;
      let breakH = 0;
      if (dh > 5) breakH = 1;
      else if (dh === 5 && (staffObj ? staffObj.settings.hasBreak5h !== false : true)) breakH = 1;
      
      const totalSpan = forcedStart !== null
        ? Math.round((forcedEnd - forcedStart) * 100) / 100
        : dh + breakH;

      const sStart = forcedStart !== null ? forcedStart
                   : (r.availableStart !== null ? r.availableStart : dayStart);
      const sEnd   = forcedEnd   !== null ? forcedEnd
                   : (r.availableEnd   !== null ? r.availableEnd   : dayEnd);

      const boundedStart = Math.max(sStart, dayStart);
      const boundedEnd   = Math.min(sEnd,   dayEnd);

      // 個別時間指定がある場合は早番/遅番の公平分散ロジックから除外
      const canEarly = forcedStart === null &&
                       (r.availableStart === null || r.availableStart <= dayStart);
      const canLate  = forcedEnd   === null &&
                       (r.availableEnd   === null || r.availableEnd   >= dayEnd);

      return {
        result:        r,
        totalSpan,
        canEarly,
        canLate,
        boundedStart,
        boundedEnd,
        assignedStart: forcedStart !== null ? forcedStart : null,
        assignedEnd:   forcedEnd   !== null ? forcedEnd   : null,
        role:          forcedStart !== null ? 'custom' : ''
      };
    });

    // ── 早番割り当て：累計が少ない人から優先、前日も早番だった人は後回し ──
    // 前日も早番だった人にはペナルティを加算して連続を抑制
    const earlyPool = pools
      .filter(p => p.canEarly && p.role === '')
      .sort((a, b) => {
        const aPrevEarly = d > 0 && a.result.shiftTimes && a.result.shiftTimes[d-1] && a.result.shiftTimes[d-1].role === 'early' ? 1 : 0;
        const bPrevEarly = d > 0 && b.result.shiftTimes && b.result.shiftTimes[d-1] && b.result.shiftTimes[d-1].role === 'early' ? 1 : 0;
        const aScore = (earlyShiftCounts[a.result.name] || 0) + aPrevEarly * 1000;
        const bScore = (earlyShiftCounts[b.result.name] || 0) + bPrevEarly * 1000;
        return aScore - bScore;
      });

    let assignedEarly = 0;
    for (const p of earlyPool) {
      if (assignedEarly >= earlyReq) break;
      p.role          = 'early';
      p.assignedStart = dayStart;
      p.assignedEnd   = dayStart + p.totalSpan;
      earlyShiftCounts[p.result.name] = (earlyShiftCounts[p.result.name] || 0) + 1;
      assignedEarly++;
    }

    // ── 遅番割り当て：累計が少ない人から優先、前日も遅番だった人は後回し ──
    const latePool = pools
      .filter(p => p.canLate && p.role === '')
      .sort((a, b) => {
        const aPrevLate = d > 0 && a.result.shiftTimes && a.result.shiftTimes[d-1] && a.result.shiftTimes[d-1].role === 'late' ? 1 : 0;
        const bPrevLate = d > 0 && b.result.shiftTimes && b.result.shiftTimes[d-1] && b.result.shiftTimes[d-1].role === 'late' ? 1 : 0;
        const aScore = (lateShiftCounts[a.result.name] || 0) + aPrevLate * 1000;
        const bScore = (lateShiftCounts[b.result.name] || 0) + bPrevLate * 1000;
        return aScore - bScore;
      });

    let assignedLate = 0;
    for (const p of latePool) {
      if (assignedLate >= lateReq) break;
      p.role          = 'late';
      p.assignedEnd   = dayEnd;
      p.assignedStart = dayEnd - p.totalSpan;
      lateShiftCounts[p.result.name] = (lateShiftCounts[p.result.name] || 0) + 1;
      assignedLate++;
    }

    // ── 通常（normal）割り当て ──
    for (const p of pools) {
      if (p.role === '') {
        p.role = 'normal';
        let st = p.boundedStart;
        let en = st + p.totalSpan;
        if (en > p.boundedEnd) {
          en = p.boundedEnd;
          st = en - p.totalSpan;
          if (st < p.boundedStart) {
            st = p.boundedStart;
            en = st + p.totalSpan;
          }
        }
        p.assignedStart = st;
        p.assignedEnd   = en;
      }
    }

    // 各スタッフの時間帯を result に保存（role も保存して結果表示で利用可能にする）
    for (const p of pools) {
      p.result.shiftTimes = p.result.shiftTimes || {};
      p.result.shiftTimes[d] = {
        start:     p.assignedStart,
        end:       p.assignedEnd,
        totalSpan: p.totalSpan,
        role:      p.role
      };
    }
  }

  // 集計した早番/遅番の回数を result に保存（将来的な表示やデバッグ用）
  AppState.results.forEach(r => {
    r.earlyShiftTotal = earlyShiftCounts[r.name] || 0;
    r.lateShiftTotal  = lateShiftCounts[r.name]  || 0;
  });
}

/* ============================================================
 * CSVエクスポート
 * ============================================================ */

function exportCSV() {
  if (!AppState.results || AppState.results.length === 0) {
    showToast('エクスポートするデータがありません。シフトを生成してください。', 'error');
    return;
  }

  const period = getCurrentPeriod();
  const totalDays = period.totalDays;
  const rows = [];

  // ─ ヘッダー行 (Transposed) ─
  const headerRow = ['日付', '出勤人数', '社員人数'];
  AppState.results.forEach(result => {
    headerRow.push(result.name);
  });
  rows.push(headerRow);

  // ─ データ行 (Transposed) ─
  for (let i = 0; i < totalDays; i++) {
    const pd = period.days[i];
    const dateStr = `${pd.month}/${pd.day}(${DAY_NAMES[pd.dow]})`;
    
    const count = AppState.results.filter(r => r.shifts[i] === 'work').length;
    const empCount = AppState.results.filter(r => r.shifts[i] === 'work' && r.category === 'employee').length;

    const row = [dateStr, count, empCount];

    AppState.results.forEach(result => {
      const shift = result.shifts[i] || 'off';
      let label = '休み';
      if (shift === 'work') {
        if (result.shiftTimes && result.shiftTimes[i]) {
          const { start, end } = result.shiftTimes[i];
          label = `${formatTimeShort(start)}〜${formatTimeShort(end)}`;
        } else {
          label = '出勤';
        }
      } else if (shift === 'off-red') {
        label = '希望休';
      } else if (shift === 'off-blue') {
        label = '休日';
      }
      row.push(label);
    });
    rows.push(row);
  }

  // ─ フッター行（勤務時間、目標時間、差分） ─
  rows.push([]);

  const totalHoursRow = ['勤務時間', '', ''];
  const targetHoursRow = ['目標時間', '', ''];
  const diffHoursRow = ['差分', '', ''];
  
  AppState.results.forEach(result => {
    totalHoursRow.push(`${result.totalHours}h`);
    targetHoursRow.push(`${result.targetHours}h`);
    
    const diff = result.totalHours - result.targetHours;
    const sign = diff > 0 ? '+' : '';
    diffHoursRow.push(`${sign}${diff}h`);
  });
  
  rows.push(totalHoursRow);
  rows.push(targetHoursRow);
  rows.push(diffHoursRow);

  // ─ CSV文字列に変換 ─
  const csvContent = rows.map(row =>
    row.map(cell => {
      const s = String(cell === null || cell === undefined ? '' : cell);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\r\n');

  // ─ BOM付きBlobを作成してダウンロード ─
  const BOM  = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  const anchor    = document.createElement('a');
  anchor.href     = url;
  anchor.download = `シフト表_${AppState.year}年${AppState.month}月21日_${period.endMonth}月20日.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  showToast('CSVをエクスポートしました', 'success');
}

/* ============================================================
 * リセット
 * ============================================================ */

function resetAll() {
  if (!confirm('全てのデータをリセットします。\n（読み込んだスタッフデータと生成結果が削除されます）\n※ 登録済みスタッフ情報は保持されます。\n\nよろしいですか？')) {
    return;
  }

  AppState.staffList = [];
  AppState.results   = [];
  AppState.customWorkTimes    = [];
  AppState.earlyLateOverrides = [];
  AppState.manualInput = { staffName: '', requests: {} };

  document.getElementById('section-staff').style.display   = 'none';
  document.getElementById('section-actions').style.display = 'none';
  document.getElementById('section-result').style.display  = 'none';

  document.getElementById('staffList').innerHTML   = '';
  document.getElementById('resultTable').innerHTML = '';
  document.getElementById('fileInput').value       = '';

  const ctc = document.getElementById('customTimesContainer');
  if (ctc) ctc.innerHTML = '';
  const soc = document.getElementById('shiftOverridesContainer');
  if (soc) soc.innerHTML = '';

  // 手入力エリアもリセット
  const sel = document.getElementById('manualStaffSelect');
  if (sel) sel.value = '';
  const ni = document.getElementById('manualStaffNameInput');
  if (ni) ni.value = '';
  AppState.manualInput.requests = {};
  renderManualDayGrid();
  updateManualRegisteredList();

  // 警告エリアもクリア
  const ew = document.getElementById('excelWarnings');
  if (ew) ew.innerHTML = '';
  const mw = document.getElementById('manualWarnings');
  if (mw) mw.innerHTML = '';

  showToast('リセットしました', 'info');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
 * アコーディオン（カードの折りたたみ）
 * ============================================================ */

/**
 * .step-header をクリックすると対応する .collapsible-body を開閉する
 * モバイルでは初期状態で全カードを折りたたむ
 */
function setupCollapsibleCards() {
  const isMobile = window.innerWidth <= 700;

  document.querySelectorAll('.step-header').forEach(header => {
    const targetId = header.dataset.target;
    const body     = document.getElementById(targetId);
    if (!body) return;

    // モバイルの場合は初期状態で折りたたむ（STEP1だけ開く）
    if (isMobile) {
      const card = header.closest('.collapsible-card');
      const isStep1 = card && card.id === 'section-settings';
      if (!isStep1) {
        body.classList.add('collapsed');
        header.classList.add('is-collapsed');
      }
    }

    header.addEventListener('click', () => {
      body.classList.toggle('collapsed');
      header.classList.toggle('is-collapsed');
    });
  });
}

/* ============================================================
 * モバイルボトムナビゲーション
 * ============================================================ */

/**
 * 画面下部のナビゲーションバー制御
 * - タップでそのセクションへスクロール
 * - スクロール位置に応じてアクティブアイテムを更新
 */
function setupMobileBottomNav() {
  const nav = document.getElementById('mobileBottomNav');
  if (!nav) return;

  // 各ナビアイテムのクリックでスクロール
  nav.querySelectorAll('.mob-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.dataset.target;
      const target   = document.getElementById(targetId);
      if (!target || target.style.display === 'none') return;

      // 折りたたまれていれば開く
      const body = target.querySelector('.collapsible-body');
      const hdr  = target.querySelector('.step-header');
      if (body && body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        if (hdr) hdr.classList.remove('is-collapsed');
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileNavActive(targetId);
    });
  });

  // スクロール追従でアクティブ更新（デスクトップでは不要だが副作用はない）
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(updateMobileNavOnScroll, 80);
  }, { passive: true });
}

/** ナビのアクティブ状態を指定IDに設定 */
function setMobileNavActive(targetId) {
  const nav = document.getElementById('mobileBottomNav');
  if (!nav) return;
  nav.querySelectorAll('.mob-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.target === targetId);
  });
}

/** スクロール位置に応じてアクティブ更新 */
function updateMobileNavOnScroll() {
  const sections = [
    'section-settings', 'section-staff-management', 'section-upload',
    'section-staff', 'section-individual-settings', 'section-result'
  ];
  let current = sections[0];
  for (const id of sections) {
    const el = document.getElementById(id);
    if (!el || el.style.display === 'none') continue;
    if (el.getBoundingClientRect().top <= 120) current = id;
  }
  setMobileNavActive(current);
}

/* ============================================================
 * 手入力セクション（STEP3 タブ）
 * ─────────────────────────────────────────────────────────────
 * Excelアップロードの代わりに、スタッフを選択して各日の希望を
 * 画面上で直接クリック入力できる機能。
 * ============================================================ */

/**
 * タブ切り替え（Excel / 手入力）
 * @param {'excel'|'manual'} tab
 */
function switchUploadTab(tab) {
  document.getElementById('panel-excel').style.display  = tab === 'excel'  ? '' : 'none';
  document.getElementById('panel-manual').style.display = tab === 'manual' ? '' : 'none';
  document.getElementById('tab-excel').classList.toggle('upload-tab-active',  tab === 'excel');
  document.getElementById('tab-manual').classList.toggle('upload-tab-active', tab === 'manual');

  if (tab === 'manual') {
    // タブ表示時にスタッフ選択肢と日付グリッドを最新化する
    initManualInputSection();
  }
}

/**
 * 手入力セクションを初期化する
 * ・スタッフセレクトの選択肢を登録済みスタッフで埋める
 * ・日付グリッドを描画する
 */
function initManualInputSection() {
  const sel = document.getElementById('manualStaffSelect');
  if (!sel) return;

  // 現在の選択値を保持
  const prevName = AppState.manualInput.staffName;

  sel.innerHTML = '<option value="">-- スタッフを選択 --</option>';
  AppState.registeredStaff.forEach(s => {
    const opt = document.createElement('option');
    opt.value       = escapeHtml(s.name);
    opt.textContent = s.name;
    if (s.name === prevName) opt.selected = true;
    sel.appendChild(opt);
  });

  renderManualDayGrid();
  updateManualRegisteredList();
}

/**
 * スタッフセレクト変更時
 * @param {string} value - selected staff name
 */
function onManualStaffChange(value) {
  AppState.manualInput.staffName = value;
  const nameInput = document.getElementById('manualStaffNameInput');
  if (nameInput && value) nameInput.value = '';

  const existing = AppState.staffList.find(s => s.name === value);
  AppState.manualInput.requests = existing ? { ...existing.requests } : {};

  renderManualDayGrid();
  if (value) renderRequestWarnings(value, AppState.manualInput.requests, 'manualWarnings');
  else { const w = document.getElementById('manualWarnings'); if (w) w.innerHTML = ''; }
}

/**
 * テキスト入力欄変更時（未登録スタッフの直接入力）
 */
function onManualNameInputChange(value) {
  AppState.manualInput.staffName = value.trim();
  const sel = document.getElementById('manualStaffSelect');
  if (sel) sel.value = '';

  const existing = AppState.staffList.find(s => s.name === value.trim());
  AppState.manualInput.requests = existing ? { ...existing.requests } : {};

  renderManualDayGrid();
  if (value.trim()) renderRequestWarnings(value.trim(), AppState.manualInput.requests, 'manualWarnings');
  else { const w = document.getElementById('manualWarnings'); if (w) w.innerHTML = ''; }
}

/**
 * 日付グリッドを描画する
 * 各セルは「空欄 → 赤 → 青 → 空欄」の3段階をクリックで切り替え
 */
function renderManualDayGrid() {
  const grid = document.getElementById('manualDayGrid');
  if (!grid) return;

  const period = getCurrentPeriod();
  const reqs   = AppState.manualInput.requests;

  grid.innerHTML = '';

  period.days.forEach((pd, idx) => {
    const reqType = reqs[idx] || '';
    const dow     = pd.dow;

    const cell = document.createElement('div');
    cell.className = `mgrid-cell${dow === 0 ? ' mgrid-sun' : dow === 6 ? ' mgrid-sat' : ''}`;

    // 日付ラベル
    const label = document.createElement('div');
    label.className   = 'mgrid-date';
    label.textContent = `${pd.month}/${pd.day}`;
    cell.appendChild(label);

    // 曜日ラベル
    const dowLabel = document.createElement('div');
    dowLabel.className   = 'mgrid-dow';
    dowLabel.textContent = DAY_NAMES[dow];
    cell.appendChild(dowLabel);

    // 状態ボタン
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.dayIdx = idx;
    btn.addEventListener('click', () => toggleManualDayRequest(idx));

    if (reqType === 'red') {
      btn.className   = 'mgrid-btn mgrid-red';
      btn.textContent = '赤';
      btn.title       = '希望休（クリックで「青」に変更）';
    } else if (reqType === 'blue') {
      btn.className   = 'mgrid-btn mgrid-blue';
      btn.textContent = '青';
      btn.title       = '休日（クリックで「空欄」に変更）';
    } else {
      btn.className   = 'mgrid-btn mgrid-avail';
      btn.textContent = '空';
      btn.title       = '出勤可能（クリックで「赤（希望休）」に変更）';
    }

    cell.appendChild(btn);
    grid.appendChild(cell);
  });
}

/**
 * 日付セルのリクエスト種別を切り替える
 * 空欄 → 赤 → 青 → 空欄 の順に循環
 * @param {number} dayIdx - 期間内のインデックス
 */
function toggleManualDayRequest(dayIdx) {
  const cur = AppState.manualInput.requests[dayIdx] || '';
  if (!cur) {
    AppState.manualInput.requests[dayIdx] = 'red';
  } else if (cur === 'red') {
    AppState.manualInput.requests[dayIdx] = 'blue';
  } else {
    delete AppState.manualInput.requests[dayIdx];
  }
  renderManualDayGrid();
  // 名前が確定しているなら警告を即時更新
  const selVal   = (document.getElementById('manualStaffSelect')?.value   || '').trim();
  const inputVal = (document.getElementById('manualStaffNameInput')?.value || '').trim();
  const name     = selVal || inputVal;
  if (name) {
    renderRequestWarnings(name, AppState.manualInput.requests, 'manualWarnings');
  }
}

/**
 * 手入力データをスタッフリストに登録・更新する
 */
/**
 * 希望休バリデーションチェック
 * @param {string} name - スタッフ名
 * @param {Object} requests - {dayIdx: 'red'|'blue'}
 * @param {string} sourceId - チェックボックスを管理するコンテナID（手入力 or Excel用）
 * @returns {boolean} 問題があればfalse（ただしチェックボックスにチェック済みならtrue）
 */
function checkRequestWarnings(name, requests, sourceId) {
  const redCount  = Object.values(requests).filter(v => v === 'red').length;
  const blueCount = Object.values(requests).filter(v => v === 'blue').length;

  let warnings = [];

  if (redCount >= 3) {
    warnings.push({
      key: `warn-toomanyred-${sourceId}-${name.replace(/\s/g,'_')}`,
      msg: `「${name}」の希望休が${redCount}つ以上選択されていますがよろしいですか？`
    });
  }

  if (redCount <= 1 && blueCount >= 1) {
    warnings.push({
      key: `warn-fewred-${sourceId}-${name.replace(/\s/g,'_')}`,
      msg: `「${name}」の希望休が2つ未満で休日が入力されていますがよろしいですか？`
    });
  }

  if (warnings.length === 0) return true;

  // ウォーニングコンテナを取得
  const container = document.getElementById(sourceId);
  if (!container) return true;

  // 未チェックの警告があるか確認
  let allChecked = true;
  for (const w of warnings) {
    const cb = document.getElementById(w.key);
    if (!cb || !cb.checked) {
      allChecked = false;
      break;
    }
  }
  return allChecked;
}

/**
 * 手入力エリアに警告チェックボックスを描画する
 * @param {string} name - スタッフ名
 * @param {Object} requests - {dayIdx: 'red'|'blue'}
 * @param {string} containerId - 描画先コンテナID
 */
function renderRequestWarnings(name, requests, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const redCount  = Object.values(requests).filter(v => v === 'red').length;
  const blueCount = Object.values(requests).filter(v => v === 'blue').length;

  let html = '';

  if (redCount >= 3) {
    const key = `warn-toomanyred-${containerId}-${name.replace(/\s/g,'_')}`;
    const checked = document.getElementById(key)?.checked ? 'checked' : '';
    html += `
      <div class="req-warning">
        <label>
          <input type="checkbox" id="${key}" ${checked}>
          ⚠️ 希望休が${redCount}つ以上選択されていますがよろしいですか？
        </label>
      </div>
    `;
  }

  if (redCount <= 1 && blueCount >= 1) {
    const key = `warn-fewred-${containerId}-${name.replace(/\s/g,'_')}`;
    const checked = document.getElementById(key)?.checked ? 'checked' : '';
    html += `
      <div class="req-warning">
        <label>
          <input type="checkbox" id="${key}" ${checked}>
          ⚠️ 希望休が2つ未満で休日が入力されていますがよろしいですか？
        </label>
      </div>
    `;
  }

  container.innerHTML = html;
}

function registerManualStaff() {
  // スタッフ名を確定（セレクト優先、なければテキスト入力）
  const selVal   = (document.getElementById('manualStaffSelect')?.value   || '').trim();
  const inputVal = (document.getElementById('manualStaffNameInput')?.value || '').trim();
  const name     = selVal || inputVal;

  if (!name) {
    showToast('スタッフ名を選択または入力してください。', 'error');
    return;
  }

  AppState.manualInput.staffName = name;

  // 警告チェックボックスを更新描画
  renderRequestWarnings(name, AppState.manualInput.requests, 'manualWarnings');

  // バリデーション：未チェックの警告があれば登録不可
  if (!checkRequestWarnings(name, AppState.manualInput.requests, 'manualWarnings')) {
    showToast('⚠️ 警告の内容を確認してチェックボックスにチェックを入れてください。', 'error');
    return;
  }

  // 登録済みスタッフからマスタ情報を取得
  const regStaff = AppState.registeredStaff.find(s => s.name === name);

  const settings = regStaff ? {
    category:       regStaff.category,
    monthlyHours:   regStaff.monthlyHours   ?? 160,
    weeklyHours:    regStaff.weeklyHours     ?? 40,
    dailyHours:     regStaff.dailyHours      ?? 8,
    availableStart: regStaff.availableStart  ?? null,
    availableEnd:   regStaff.availableEnd    ?? null
  } : {
    category:       '',
    monthlyHours:   160,
    weeklyHours:    40,
    dailyHours:     8,
    availableStart: null,
    availableEnd:   null
  };

  const newEntry = {
    name,
    matchedRegistered: regStaff || null,
    requests:          { ...AppState.manualInput.requests },
    settings
  };

  // 同名が既存なら requests を更新、なければ新規追加
  const existingIdx = AppState.staffList.findIndex(s => s.name === name);
  if (existingIdx >= 0) {
    AppState.staffList[existingIdx].requests = newEntry.requests;
    showToast(`「${name}」の希望休を更新しました。`, 'info');
  } else {
    AppState.staffList.push(newEntry);
    showToast(`「${name}」を追加しました。`, 'success');
  }

  // スタッフ設定セクションを表示
  renderStaffList();
  document.getElementById('section-staff').style.display              = '';
  document.getElementById('section-individual-settings').style.display = '';
  document.getElementById('section-actions').style.display            = '';

  // 入力エリアをリセット（警告エリアもクリア）
  AppState.manualInput.staffName = '';
  AppState.manualInput.requests  = {};
  const sel = document.getElementById('manualStaffSelect');
  if (sel) sel.value = '';
  const ni = document.getElementById('manualStaffNameInput');
  if (ni) ni.value = '';
  const warnEl = document.getElementById('manualWarnings');
  if (warnEl) warnEl.innerHTML = '';
  renderManualDayGrid();
  updateManualRegisteredList();
}

/**
 * 手入力の作業中データをクリアする
 */
function clearManualInput() {
  AppState.manualInput.requests = {};
  renderManualDayGrid();
  showToast('入力内容をクリアしました。', 'info');
}

/**
 * 手入力で登録済みのスタッフ一覧を表示する
 */
function updateManualRegisteredList() {
  const container = document.getElementById('manualRegisteredList');
  if (!container) return;

  if (AppState.staffList.length === 0) {
    container.innerHTML = '';
    return;
  }

  const redCount = (requests) =>
    Object.values(requests).filter(v => v === 'red').length;
  const blueCount = (requests) =>
    Object.values(requests).filter(v => v === 'blue').length;

  container.innerHTML = `
    <div class="manual-registered-title">✅ 登録済みスタッフ（${AppState.staffList.length}名）</div>
    <div class="manual-registered-grid">
      ${AppState.staffList.map((s, idx) => `
        <div class="manual-reg-item">
          <span class="manual-reg-name">${escapeHtml(s.name)}</span>
          <span class="manual-reg-badges">
            ${redCount(s.requests)  > 0 ? `<span class="badge badge-red">希望休:${redCount(s.requests)}日</span>` : ''}
            ${blueCount(s.requests) > 0 ? `<span class="badge badge-blue">休日:${blueCount(s.requests)}日</span>` : ''}
            ${redCount(s.requests) === 0 && blueCount(s.requests) === 0 ? '<span class="badge-none">希望なし</span>' : ''}
          </span>
          <button class="btn-remove" type="button" onclick="removeStaffFromManualList(${idx})">削除</button>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * 手入力の登録済み一覧からスタッフを削除する
 * @param {number} idx
 */
function removeStaffFromManualList(idx) {
  const name = AppState.staffList[idx].name;
  AppState.staffList.splice(idx, 1);

  if (AppState.staffList.length === 0) {
    document.getElementById('section-staff').style.display              = 'none';
    document.getElementById('section-individual-settings').style.display = 'none';
    document.getElementById('section-actions').style.display            = 'none';
  } else {
    renderStaffList();
  }

  updateManualRegisteredList();
  showToast(`「${name}」を削除しました。`, 'info');
}

/* ============================================================
 * ユーティリティ関数
 * ============================================================ */

/**
 * HTMLエスケープ
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * トースト通知
 */
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast       = document.createElement('div');
  toast.className   = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fade');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 350);
  }, duration);
}