/**
 * ui.js - 画面描画・DOM操作
 */
const UI = window.UI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  /** 月所定÷1日÷4 で出勤目安/週を計算してフォーマット */
  const _formatWeeklyDays = (monthly, daily) => {
    if (!monthly || !daily || daily <= 0) return '—';
    const val = monthly / daily / 4;
    if (Number.isInteger(val)) return `（目安）${val}日/週`;
    return `（目安）${Math.floor(val)}～${Math.ceil(val)}日/週`;
  };

  const _weekdayClass = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 0 ? 'day-sun' : d.getDay() === 6 ? 'day-sat' : '';
  };

  const _dateLabel = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return { short: `${d.getMonth()+1}/${d.getDate()}`, weekday: CONSTANTS.WEEKDAY_SHORT[d.getDay()], cls: _weekdayClass(dateStr) };
  };

  // ===== タブ =====
  const initTabs = () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  };

  const switchTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    State.setUI({ activeTab: tab });
    Storage.saveUI();
    if (tab === 'step2') { renderStep2StaffList(); renderStep2Calendar(); renderStep2Status(); }
    if (tab === 'step3') renderStep3Table();
    if (tab === 'step4') renderStep4StaffCheckboxes();
    if (tab === 'step5') renderStep5Table();
    if (tab === 'result') renderResult();
  };

  // ===== 保存ステータス =====
  let _saveTimer;
  const showSaveStatus = () => {
    const el = $('saveStatus');
    if (!el) return;
    el.textContent = '保存中...';
    el.style.color = 'var(--color-warning)';
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      el.textContent = `✓ 自動保存済み (${Storage.getUsageText()})`;
      el.style.color = 'var(--color-success)';
    }, 900);
  };

  // ===== STEP1 =====
  const initStep1YearSelect = () => {
    const sel = $('targetYear');
    if (!sel) return;
    const cur = new Date().getFullYear();
    for (let y = cur; y <= CONSTANTS.YEAR_MAX; y++) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = `${y}年`;
      sel.appendChild(opt);
    }
  };

  const loadStep1Values = () => {
    const s1 = State.getStep1();
    _setVal('targetYear', s1.year);         _setVal('targetMonth', s1.month);
    _setVal('startDay', s1.startDay);
    _setVal('bizStartAmPm', s1.bizStartAmPm); _setVal('bizStartTime', s1.bizStartTime);
    _setVal('bizEndAmPm', s1.bizEndAmPm);     _setVal('bizEndTime', s1.bizEndTime);
    _setVal('minStaff', s1.minStaff);         _setVal('maxStaff', s1.maxStaff ?? '');
    _setVal('minEmployee', s1.minEmployee);   _setVal('maxEmployee', s1.maxEmployee ?? '');
    _setVal('earlyCountMin', s1.earlyCountMin || 0);
    _setVal('earlyCountMax', s1.earlyCountMax ?? '');
    _setVal('lateCountMin', s1.lateCountMin || 0);
    _setVal('lateCountMax', s1.lateCountMax ?? '');
    updatePeriodPreview();
  };

  const updatePeriodPreview = () => {
    const dates = State.getPeriodDates();
    const el = $('periodPreview');
    if (!el) return;
    if (!dates.length) { el.textContent = '— 年月・開始日を入力してください —'; return; }
    const ds = new Date(dates[0] + 'T00:00:00'), de = new Date(dates[dates.length-1] + 'T00:00:00');
    const fmt = d => `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${CONSTANTS.WEEKDAY_SHORT[d.getDay()]})`;
    el.textContent = `${fmt(ds)} 〜 ${fmt(de)}（${dates.length}日間）`;
  };

  // ===== スタッフ管理 =====
  const renderStaffTable = (filter = 'all', sortKey = null, sortAsc = true) => {
    const tbody = $('staffTableBody');
    if (!tbody) return;
    let list = State.getStaff();
    if (filter === 'employee')  list = list.filter(s => s.category === CONSTANTS.CATEGORY.EMPLOYEE);
    if (filter === 'community') list = list.filter(s => s.category === CONSTANTS.CATEGORY.COMMUNITY);
    $('staffCount').textContent = State.getStaff().length;

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let va = _staffSortValue(a, sortKey), vb = _staffSortValue(b, sortKey);
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    if (!list.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">スタッフが登録されていません</td></tr>'; return;
    }

    // 早番・遅番可否を自動判定して表示
    const step1 = State.getStep1();
    tbody.innerHTML = list.map(s => {
      const canEarly = State.canEarlyShift(s.id);
      const canLate  = State.canLateShift(s.id);
      const shiftHints = [];
      if (canEarly) shiftHints.push('<span style="color:var(--color-warning);font-size:10px">早番可</span>');
      if (canLate)  shiftHints.push('<span style="color:var(--color-info,#3b82f6);font-size:10px">遅番可</span>');
      const workTimeStr = s.workStartTime
        ? `${s.workStartAmPm==='am'?'午前':'午後'} ${s.workStartTime} 〜 ${s.workEndAmPm==='am'?'午前':'午後'} ${s.workEndTime}`
        : '<span style="color:var(--color-text-muted)">STEP1に従う</span>';
      return `
      <tr data-id="${esc(s.id)}">
        <td><strong>${esc(s.name)}</strong></td>
        <td><span class="tag ${s.category===CONSTANTS.CATEGORY.EMPLOYEE?'tag-employee':'tag-community'}">${esc(CONSTANTS.CATEGORY_LABEL[s.category]||s.category)}</span></td>
        <td>${s.monthlyHours}h</td>
        <td>${_formatWeeklyDays(s.monthlyHours, s.dailyHours)}</td>
        <td>${s.dailyHours}h</td>
        <td style="text-align:center">${s.hasBreak5h ? '✓' : '—'}</td>
        <td>${workTimeStr}${shiftHints.length ? '<br>' + shiftHints.join(' ') : ''}</td>
        <td style="text-align:center">${s.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS}日</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn btn-outline btn-sm" data-action="edit-staff" data-id="${esc(s.id)}">編集</button>
            <button class="btn btn-danger btn-sm" data-action="delete-staff" data-id="${esc(s.id)}">削除</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  };

  const _staffSortValue = (s, key) => {
    if (key === 'name')         return s.name;
    if (key === 'category')     return s.category;
    if (key === 'monthlyHours') return s.monthlyHours;
    if (key === 'weeklyDays')  return (s.monthlyHours || 0) / (s.dailyHours || 1) / 4;
    if (key === 'dailyHours')   return s.dailyHours;
    if (key === 'hasBreak5h')   return s.hasBreak5h ? 1 : 0;
    if (key === 'workTime')     return s.workStartTime || '';
    if (key === 'minRestDays')  return s.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS;
    return '';
  };

  const fillStaffForm = (staff) => {
    _setVal('staffName', staff.name);       _setVal('staffCategory', staff.category);
    _setVal('monthlyHours', staff.monthlyHours);
    _setVal('dailyHours', staff.dailyHours);
    _setVal('workStartAmPm', staff.workStartAmPm||'am'); _setVal('workStartTime', staff.workStartTime||'');
    _setVal('workEndAmPm', staff.workEndAmPm||'pm');     _setVal('workEndTime', staff.workEndTime||'');
    _setVal('minRestDays', staff.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS);
    _updateBreakUI(staff.dailyHours, staff.hasBreak5h);
  };

  const clearStaffForm = () => {
    ['staffName','monthlyHours','dailyHours','workStartTime','workEndTime','minRestDays'].forEach(id => _setVal(id,''));
    _setVal('staffCategory',''); _setVal('workStartAmPm','am'); _setVal('workEndAmPm','pm');
    _setChecked('hasBreak5h', false);
    _updateBreakUI(0, false);
    $('registerStaff').textContent = 'スタッフを登録';
    $('staffName')?.focus();
  };

  const _updateBreakUI = (hours, checked) => {
    const wrapper = $('breakCheckWrapper'), cb = $('hasBreak5h');
    if (!wrapper || !cb) return;
    const h = parseFloat(hours) || 0;
    if (h < 5) {
      cb.checked = false; wrapper.style.opacity = '0.4'; wrapper.style.pointerEvents = 'none';
    } else if (h > 5) {
      cb.checked = true;  wrapper.style.opacity = '0.4'; wrapper.style.pointerEvents = 'none';
    } else {
      cb.checked = (checked !== undefined ? checked : cb.checked);
      wrapper.style.opacity = '1'; wrapper.style.pointerEvents = 'auto';
    }
  };

  // ===== STEP2 =====
  const renderStep2StaffList = () => {
    const container = $('step2StaffList');
    if (!container) return;
    const staff = State.getStaff(), selected = State.getUI().step2SelectedStaff;
    if (!staff.length) { container.innerHTML = '<p class="empty-hint">スタッフ管理でスタッフを登録してください</p>'; return; }
    container.innerHTML = staff.map(s => `
      <button class="staff-select-btn ${s.id===selected?'active':''}" data-action="select-step2-staff" data-id="${esc(s.id)}">
        <span class="tag ${s.category===CONSTANTS.CATEGORY.EMPLOYEE?'tag-employee':'tag-community'}">${s.category===CONSTANTS.CATEGORY.EMPLOYEE?'社':'コ'}</span>
        ${esc(s.name)}
      </button>
    `).join('');
    renderStep2Status();
  };

  const renderStep2Calendar = () => {
    const wrapper = $('step2CalendarWrapper');
    if (!wrapper) return;
    const dates = State.getPeriodDates(), selId = State.getUI().step2SelectedStaff;
    if (!selId || !dates.length) {
      wrapper.innerHTML = '<p class="empty-hint center">STEP1で期間を設定し、スタッフを選択してください</p>';
      $('step2CalendarTitle').textContent = 'カレンダー'; return;
    }
    const staff = State.getStaffById(selId);
    $('step2CalendarTitle').textContent = `${staff?.name||''} さんの希望休入力`;
    const confirmed = State.getStep2For(selId), draft = State.getUI().step2Draft || {};
    const merged = { ...confirmed, ...draft };

    const byMonth = {};
    dates.forEach(d => { const m = d.slice(0,7); if (!byMonth[m]) byMonth[m] = []; byMonth[m].push(d); });

    let html = '<div class="calendar-scroll">';
    for (const [month, mDates] of Object.entries(byMonth)) {
      const [y, m] = month.split('-');
      html += `<div class="calendar-month-label">${parseInt(y)}年${parseInt(m)}月</div>`;
      html += '<table class="calendar-table"><thead><tr>';
      mDates.forEach(d => {
        const lbl = _dateLabel(d);
        html += `<th class="${lbl.cls}" data-date="${esc(d)}">${lbl.short}<br><span class="cal-weekday">${lbl.weekday}</span></th>`;
      });
      html += '</tr></thead><tbody><tr>';
      mDates.forEach(d => {
        const state = merged[d] || '', disp = CONSTANTS.STEP2_DISPLAY[state] || CONSTANTS.STEP2_DISPLAY[''], lbl = _dateLabel(d);
        html += `<td class="${disp.cls} ${lbl.cls}" data-date="${esc(d)}">${esc(disp.text)}</td>`;
      });
      html += '</tr></tbody></table>';
    }
    html += '</div>';
    wrapper.innerHTML = html;

    wrapper.querySelectorAll('.calendar-table td[data-date]').forEach(td => {
      td.addEventListener('click', () => {
        const date = td.dataset.date;
        const draft = { ...State.getUI().step2Draft };
        const cur = draft[date] || merged[date] || '';
        const cycle = CONSTANTS.STEP2_CYCLE;
        draft[date] = cycle[(cycle.indexOf(cur)+1) % cycle.length];
        State.setUI({ step2Draft: draft });
        renderStep2Calendar();
      });
    });
  };

  const renderStep2Status = (sortKey = null, sortAsc = true) => {
    const step2 = State.getStep2(), staff = State.getStaff();
    const regIds = Object.keys(step2);
    _setText('step2RegisteredCount', regIds.length);
    const unreg = staff.filter(s => !regIds.includes(s.id)).map(s => s.name);
    _setText('step2UnregisteredList', unreg.length ? unreg.join('、') : '（全員登録済み）');

    const tbody = $('step2RegisteredBody');
    if (!tbody) return;
    let list = [...staff.filter(s => regIds.includes(s.id))];
    if (sortKey) {
      list.sort((a, b) => {
        const va = _step2SortVal(a, sortKey, step2), vb = _step2SortVal(b, sortKey, step2);
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
      });
    }
    if (!list.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="6">登録データがありません</td></tr>'; return; }

    tbody.innerHTML = list.map(s => {
      const wishes = step2[s.id] || {};
      const wish = Object.entries(wishes).filter(([,v])=>v==='wishOff');
      const paid = Object.entries(wishes).filter(([,v])=>v==='paid');
      const pref = Object.entries(wishes).filter(([,v])=>v==='preferOff');
      const dayChips = [
        ...wish.map(([d])=>`<span class="day-chip day-chip-wish" title="希望休">${_shortDate(d)}</span>`),
        ...paid.map(([d])=>`<span class="day-chip day-chip-paid" title="有給">${_shortDate(d)}</span>`),
        ...pref.map(([d])=>`<span class="day-chip day-chip-pref" title="なるべく休み">${_shortDate(d)}</span>`),
      ].join('');
      return `<tr>
        <td>${esc(s.name)}</td>
        <td style="text-align:center">${wish.length}</td>
        <td style="text-align:center">${paid.length}</td>
        <td style="text-align:center">${pref.length}</td>
        <td><div class="day-chips">${dayChips}</div></td>
        <td><div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" data-action="edit-step2" data-id="${esc(s.id)}">編集</button>
          <button class="btn btn-danger btn-sm" data-action="delete-step2" data-id="${esc(s.id)}">削除</button>
        </div></td>
      </tr>`;
    }).join('');
  };

  const _step2SortVal = (s, key, step2) => {
    const w = step2[s.id] || {};
    if (key === 'name') return s.name;
    if (key === 'wish') return Object.values(w).filter(v=>v==='wishOff').length;
    if (key === 'paid') return Object.values(w).filter(v=>v==='paid').length;
    if (key === 'pref') return Object.values(w).filter(v=>v==='preferOff').length;
    return '';
  };

  const _shortDate = (d) => { const dt = new Date(d+'T00:00:00'); return `${dt.getMonth()+1}/${dt.getDate()}`; };

  // ===== STEP3 =====
  const renderStep3Table = () => {
    const tbody = $('step3TableBody');
    if (!tbody) return;
    const staff = State.getStaff();
    if (!staff.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="8">スタッフが登録されていません</td></tr>'; return; }

    const draft = State.getUI().step3Draft || {};

    tbody.innerHTML = staff.map(s => {
      const over = State.getStep3For(s.id) || {};
      const dr = draft[s.id] || {};
      // 表示用: ドラフト → 確定済み → スタッフマスタ の優先順
      const dispMonthly = dr.monthlyHours ?? over.monthlyHours ?? s.monthlyHours;
      const dispDaily   = dr.dailyHours   ?? over.dailyHours   ?? s.dailyHours;
      const dispRestDays = dr.minRestDays ?? over.minRestDays ?? s.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS;
      const dispStartAmPm = dr.workStartAmPm ?? over.workStartAmPm ?? s.workStartAmPm;
      const dispStartTime = dr.workStartTime ?? over.workStartTime ?? s.workStartTime;
      const dispEndAmPm   = dr.workEndAmPm ?? over.workEndAmPm ?? s.workEndAmPm;
      const dispEndTime   = dr.workEndTime ?? over.workEndTime ?? s.workEndTime;
      const dispBreak5h   = dr.hasBreak5h ?? over.hasBreak5h ?? s.hasBreak5h;
      const dh = dispDaily || 0;
      const breakDisabled = dh !== 5, breakChecked = dh > 5 ? true : dh < 5 ? false : dispBreak5h;

      // ステータス判定
      const hasDraft = !!Object.keys(dr).length;
      const hasOverride = !!Object.keys(over).length;
      let statusTag = '<span class="tag tag-default" style="font-size:10px">参照元のまま</span>';
      if (hasDraft)        statusTag = '<span class="tag tag-warning" style="font-size:10px">上書き中</span>';
      else if (hasOverride) statusTag = '<span class="tag tag-success" style="font-size:10px">上書き済み</span>';

      return `<tr data-sid="${esc(s.id)}" class="${hasDraft?'row-draft':hasOverride?'row-modified':''}">
        <td><strong>${esc(s.name)}</strong>${statusTag ? '<span style="margin-left:4px">' + statusTag + '</span>' : ''}</td>
        <td><span class="tag ${s.category===CONSTANTS.CATEGORY.EMPLOYEE?'tag-employee':'tag-community'}">${esc(CONSTANTS.CATEGORY_LABEL[s.category])}</span></td>
        <td><input type="number" class="form-input form-input-sm step3-input" data-field="monthlyHours" value="${dispMonthly}" min="0" max="744" step="0.25" style="width:72px"></td>
        <td><span class="auto-calc-text" style="font-size:12px">${_formatWeeklyDays(dispMonthly, dispDaily)}</span></td>
        <td><input type="number" class="form-input form-input-sm step3-input" data-field="dailyHours"   value="${dispDaily}"   min="0" max="24"  step="0.25" style="width:64px"></td>
        <td><input type="number" class="form-input form-input-sm step3-input" data-field="minRestDays"  value="${dispRestDays}" min="0" max="31" style="width:56px"></td>
        <td>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
            <select class="form-select step3-input" data-field="workStartAmPm" style="width:72px">
              <option value="am" ${dispStartAmPm==='am'?'selected':''}>午前</option>
              <option value="pm" ${dispStartAmPm==='pm'?'selected':''}>午後</option>
            </select>
            <input type="time" class="form-input form-input-sm step3-input" data-field="workStartTime" value="${dispStartTime||''}" style="width:100px">
            <span>〜</span>
            <select class="form-select step3-input" data-field="workEndAmPm" style="width:72px">
              <option value="am" ${dispEndAmPm==='am'?'selected':''}>午前</option>
              <option value="pm" ${dispEndAmPm==='pm'?'selected':''}>午後</option>
            </select>
            <input type="time" class="form-input form-input-sm step3-input" data-field="workEndTime" value="${dispEndTime||''}" style="width:100px">
          </div>
        </td>
        <td><input type="checkbox" class="step3-input" data-field="hasBreak5h" ${breakChecked?'checked':''} ${breakDisabled?'disabled':''} style="${breakDisabled?'opacity:0.4;cursor:not-allowed':''}"></td>
      </tr>`;
    }).join('');

    // changeイベント: step3Draftに書き込む（step3確定データには書かない）
    tbody.querySelectorAll('.step3-input').forEach(el => {
      el.addEventListener('change', () => {
        const row = el.closest('tr'), sid = row.dataset.sid, field = el.dataset.field;
        let val = el.type==='checkbox' ? el.checked : el.type==='number' ? parseFloat(el.value) : el.value;
        const curDraft = State.getUI().step3Draft[sid] || {};
        const next = { ...curDraft, [field]: val };
        // ベース値（確定済みor元のスタッフデータ）と同じなら削除
        const over = State.getStep3For(sid) || {};
        const base = State.getStaffById(sid);
        const baseVal = over[field] ?? base?.[field];
        if (String(next[field]) === String(baseVal)) delete next[field];
        State.setStep3Draft(sid, Object.keys(next).length ? next : {});

        // 1h休憩の連動処理
        if (field === 'dailyHours') {
          const newDh = parseFloat(el.value) || 0;
          const cbEl = row.querySelector('[data-field="hasBreak5h"]');
          if (cbEl) {
            if (newDh < 5) { cbEl.checked = false; cbEl.disabled = true; cbEl.style.opacity='0.4'; }
            else if (newDh > 5) { cbEl.checked = true; cbEl.disabled = true; cbEl.style.opacity='0.4'; }
            else { cbEl.disabled = false; cbEl.style.opacity='1'; }
          }
        }

        // 出勤目安/週の自動更新
        if (field === 'monthlyHours' || field === 'dailyHours') {
          const m = parseFloat(row.querySelector('[data-field="monthlyHours"]')?.value) || 0;
          const d = parseFloat(row.querySelector('[data-field="dailyHours"]')?.value) || 0;
          const calcSpan = row.querySelector('.auto-calc-text');
          if (calcSpan) calcSpan.textContent = _formatWeeklyDays(m, d);
        }

        // ステータス更新
        const hasDraft = !!Object.keys(State.getUI().step3Draft[sid]||{}).length;
        const hasOverride = !!Object.keys(State.getStep3For(sid)||{}).length;
        const nameCell = row.querySelector('td:first-child'), base2 = State.getStaffById(sid);
        let statusTag = '<span class="tag tag-default" style="font-size:10px">参照元のまま</span>';
        if (hasDraft)        statusTag = '<span class="tag tag-warning" style="font-size:10px">上書き中</span>';
        else if (hasOverride) statusTag = '<span class="tag tag-success" style="font-size:10px">上書き済み</span>';
        if (nameCell) nameCell.innerHTML = `<strong>${esc(base2?.name||'')}</strong><span style="margin-left:4px">${statusTag}</span>`;
        row.className = hasDraft ? 'row-draft' : hasOverride ? 'row-modified' : '';
      });
    });
  };

  // ===== STEP4 =====
  const renderStep4StaffCheckboxes = () => {
    const container = $('step4StaffCheckboxes');
    if (!container) return;
    container.innerHTML = State.getStaff().map(s => `
      <label class="checkbox-label">
        <input type="checkbox" class="step4-staff-cb" value="${esc(s.id)}">
        <span class="checkbox-custom"></span>
        <span>${esc(s.name)}</span>
      </label>
    `).join('');
  };

  const renderStep4ExceptionList = () => {
    const list = $('step4ExceptionList'), countEl = $('step4Count');
    const exceptions = State.getStep4();
    if (countEl) countEl.textContent = exceptions.length;
    if (!list) return;
    if (!exceptions.length) { list.innerHTML = '<p class="empty-hint">例外設定が登録されていません</p>'; return; }

    list.innerHTML = exceptions.map(ex => {
      const dateLabel = ex.anyDays ? `期間内 ${ex.anyDays}日間（自動選択）` : ex.dates.join('、');
      const tags = [];
      if (ex.workTimeChange) tags.push(`就業時間: ${ex.workStart}〜${ex.workEnd}`);
      if (ex.staffCountChange) {
        if (ex.minStaff    != null) tags.push(`最低${ex.minStaff}人`);
        if (ex.maxStaff    != null) tags.push(`最大${ex.maxStaff}人`);
        if (ex.minEmployee != null) tags.push(`社員最低${ex.minEmployee}人`);
        if (ex.maxEmployee != null) tags.push(`社員最大${ex.maxEmployee}人`);
        if (ex.earlyCountMin != null) tags.push(`早番${ex.earlyCountMin}${ex.earlyCountMax!=null?`〜${ex.earlyCountMax}`:''}人`);
        if (ex.lateCountMin  != null) tags.push(`遅番${ex.lateCountMin}${ex.lateCountMax!=null?`〜${ex.lateCountMax}`:''}人`);
      }
      const tLabel = {all:'全員',employee:'社員',community:'コミュニティ',individual:'個別指定'}[ex.target]||ex.target;
      tags.push(`対象:${tLabel}`);
      return `<div class="exception-item" data-id="${esc(ex.id)}">
        <div class="exception-item-body">
          <div class="exception-dates">📅 ${esc(dateLabel)}</div>
          <div class="exception-details">${tags.map(t=>`<span class="exception-tag">${esc(t)}</span>`).join('')}</div>
        </div>
        <div class="exception-item-actions">
          <button class="btn btn-danger btn-sm" data-action="delete-step4" data-id="${esc(ex.id)}">削除</button>
        </div>
      </div>`;
    }).join('');
  };

  // ===== STEP5 =====
  const renderStep5Table = () => {
    const wrapper = $('step5TableWrapper');
    if (!wrapper) return;
    const dates = State.getPrevPeriodDates(), staff = State.getStaff();
    if (!dates.length) { wrapper.innerHTML = '<p class="empty-hint center">STEP1で期間を設定してください。前月の最終1週間分が表示されます。</p>'; return; }

    const headerCols = dates.map(d => { const lbl=_dateLabel(d); return `<th class="${lbl.cls}">${lbl.short}<br>${lbl.weekday}</th>`; }).join('');
    const rows = staff.map(s => {
      const dayMap = State.getStep5For(s.id);
      const cells = dates.map(d => {
        const cell = dayMap[d]||{};
        const val = cell.state==='work' ? (cell.hours?`${cell.hours}h`:'出勤') : '';
        return `<td><input type="text" class="step5-input" data-sid="${esc(s.id)}" data-date="${esc(d)}" value="${esc(val)}" placeholder="—"></td>`;
      }).join('');
      return `<tr><td class="staff-name-cell"><span class="tag ${s.category===CONSTANTS.CATEGORY.EMPLOYEE?'tag-employee':'tag-community'}" style="margin-right:4px">${s.category===CONSTANTS.CATEGORY.EMPLOYEE?'社':'コ'}</span>${esc(s.name)}</td>${cells}</tr>`;
    }).join('');

    wrapper.innerHTML = `<div class="table-wrapper"><table class="step5-table">
      <thead><tr><th class="staff-name-cell" style="position:sticky;left:0;z-index:2">スタッフ名</th>${headerCols}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;

    wrapper.querySelectorAll('.step5-input').forEach(input => {
      input.addEventListener('change', () => {
        const sid = input.dataset.sid, date = input.dataset.date, raw = input.value.trim();
        let state='off', hours=0;
        if (raw && raw!=='休'&&raw!=='off'&&raw!=='—') {
          state='work';
          const m=raw.match(/^(\d+\.?\d*)h?$/);
          hours = m ? parseFloat(m[1]) : (State.getEffectiveStaff(sid)?.dailyHours||CONSTANTS.DEFAULT_DAILY_HOURS);
        }
        State.setStep5ForStaff(sid, { ...State.getStep5For(sid), [date]:{state,hours} });
        Storage.autoSave(showSaveStatus);
      });
    });
  };

  // ===== シフト生成結果 =====
  const renderResult = () => {
    const result = State.getResult();
    $('resultEmpty').style.display      = result ? 'none'  : 'block';
    $('resultTabsWrapper').style.display = result ? 'block' : 'none';
    $('regenerateShift').style.display   = result ? 'inline-flex' : 'none';
    if (!result) return;

    const planA = result.planA, planB = result.planB;
    const hardA = planA?.violations?.filter(v=>v.type==='HARD').length || 0;
    const hardB = planB?.violations?.filter(v=>v.type==='HARD').length || 0;
    const softA = planA?.violations?.filter(v=>v.type==='SOFT').length || 0;
    const softB = planB?.violations?.filter(v=>v.type==='SOFT').length || 0;

    // スコア表示
    const scoreAEl = $('scoreA'), scoreBEl = $('scoreB');
    if (scoreAEl) scoreAEl.textContent = hardA > 0 ? `⚠️ 違反${hardA}件` : '✅ 充足';
    if (scoreBEl) scoreBEl.textContent = hardB > 0 ? `⚠️ 違反${hardB}件` : '✅ 充足';

    // アクティブタブ
    const activePlan = State.getUI().resultActiveTab || 'planA';
    $('resultTabA')?.classList.toggle('active', activePlan === 'planA');
    $('resultTabB')?.classList.toggle('active', activePlan === 'planB');

    const plan  = activePlan === 'planB' ? planB : planA;
    const label = activePlan === 'planB' ? '案 B' : '案 A';
    const hard  = activePlan === 'planB' ? hardB  : hardA;
    const soft  = activePlan === 'planB' ? softB  : softA;

    const container = $('resultContent');
    container.innerHTML = '';
    if (plan) container.appendChild(_buildShiftPanel(activePlan, label, plan, hard, soft));

    // 生成ログ
    if (result.log?.length) {
      const logEl = document.createElement('div');
      logEl.style.cssText = 'padding:0 0 16px';
      logEl.innerHTML = `<details style="cursor:pointer"><summary style="font-size:12px;color:var(--color-text-muted);padding:8px 0;user-select:none">▶ 生成ログ（${result.log.length}件）</summary>
        <div class="generate-log">${result.log.map(l=>`<div class="generate-log-item${l.includes('違反')?' warn':''}">&gt; ${esc(l)}</div>`).join('')}</div></details>`;
      container.appendChild(logEl);
    }
  };

  const _buildShiftPanel = (key, label, plan, hardCount, softCount) => {
    const dates = State.getPeriodDates(), staff = State.getStaff();
    const violations = plan.violations || [];

    const panel = document.createElement('div');
    panel.className = 'shift-result-panel';
    panel.dataset.key = key;

    const statusHtml = hardCount > 0
      ? `<span class="result-status status-ng">違反 ${hardCount}件</span>`
      : `<span class="result-status status-ok">制約充足</span>`;

    panel.innerHTML = `
      <div class="shift-result-header">
        <div class="shift-result-title">${esc(label)}</div>
        ${statusHtml}
        ${softCount ? `<span class="result-status status-warn">要確認 ${softCount}件</span>` : ''}
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" data-action="download-plan" data-key="${esc(key)}">⬇ ダウンロード</button>
        </div>
      </div>
      <div class="shift-result-body" id="shiftBody_${esc(key)}"></div>
    `;

    panel.querySelector(`#shiftBody_${key}`).innerHTML = _buildShiftTable(plan, dates, staff);

    if (violations.length) {
      const vEl = document.createElement('div');
      vEl.style.padding = '0 16px 16px';
      vEl.innerHTML = `<details><summary style="font-size:12px;cursor:pointer;user-select:none;padding:4px 0">▶ 制約チェック結果（${violations.length}件）</summary>
        <div class="violation-list">${violations.map(v => {
          const isForcedOff = v.rule === CONSTANTS.RULE.FORCED_OFF;
          return `<div class="violation-item ${isForcedOff ? 'violation-forced' : ''}">
            <span class="violation-icon">${v.type==='HARD'?'🔴':'🟡'}</span>
            <div>
              ${esc(v.rule)}${v.target?`｜${esc(v.target)}`:''}${v.date?`｜${esc(v.date)}`:''}
              <div style="color:var(--color-text-secondary);font-size:11px;margin-top:2px">${esc(v.message)}</div>
            </div>
          </div>`;
        }).join('')}
        </div></details>`;
      panel.appendChild(vEl);
    }

    _attachCellEditHandlers(panel, plan, key);
    return panel;
  };

  const _buildShiftTable = (plan, dates, staff) => {
    // スタッフごとの集計
    const staffTotals = {};
    for (const s of staff) {
      let workDays=0, totalH=0, restDays=0;
      for (const d of dates) {
        const cell = plan.cells[s.id]?.[d];
        if (cell?.state === 'work')      { workDays++; totalH += cell.hours||0; }
        if (cell?.state === 'paid')      { totalH += cell.hours||0; }
        if (cell?.state === 'off'    ||
            cell?.state === 'wishOff' ||
            cell?.state === 'preferOff'||
            cell?.state === 'forcedOff') restDays++;
      }
      staffTotals[s.id] = { workDays, totalH, restDays };
    }

    // 違反セルのマップ
    const violations = plan.violations || [];
    const violationMap = {};
    violations.forEach(v => {
      if (v.staffId && v.date) {
        const key = `${v.staffId}::${v.date}`;
        if (!violationMap[key]) violationMap[key] = [];
        violationMap[key].push(v);
      }
    });

    const staffHeaderCells = staff.map(s => {
      const catTag = s.category===CONSTANTS.CATEGORY.EMPLOYEE
        ? '<span class="tag tag-employee" style="font-size:9px;margin-bottom:2px">社</span>'
        : '<span class="tag tag-community" style="font-size:9px;margin-bottom:2px">コ</span>';
      return `<th class="shift-staff-header">${catTag}<br>${esc(s.name)}</th>`;
    }).join('');

    const headerRow = `<tr>
      <th class="shift-date-col sticky-col-date" style="cursor:pointer" title="日付クリックでタイムライン表示">日付</th>
      ${staffHeaderCells}
      <th class="shift-date-col">日付</th>
    </tr>`;

    const dataRows = dates.map(d => {
      const lbl = _dateLabel(d);
      const dateCell = `<td class="shift-date-col sticky-col-date ${lbl.cls} shift-date-clickable" data-date="${esc(d)}" title="クリックで日別タイムライン表示">
        <span class="shift-date-num">${lbl.short}</span>
        <span class="shift-date-wday">${lbl.weekday}</span>
      </td>`;
      // 右列も同様にクリック可能
      const dateCellR = `<td class="shift-date-col ${lbl.cls} shift-date-clickable" data-date="${esc(d)}" title="クリックで日別タイムライン表示" style="cursor:pointer">
        <span class="shift-date-num">${lbl.short}</span>
        <span class="shift-date-wday">${lbl.weekday}</span>
      </td>`;

      // この日の出勤人数
      const workingCount = staff.filter(s => plan.cells[s.id]?.[d]?.state === 'work').length;
      const step1 = State.getStep1();
      const minStaff = step1.minStaff || 1;
      const maxStaff = step1.maxStaff ?? null;
      const isShort = workingCount < minStaff;
      const isOver  = maxStaff != null && workingCount > maxStaff;

      const staffCells = staff.map(s => {
        const cell = plan.cells[s.id]?.[d];
        const sid = esc(s.id), dd = esc(d);
        const vKey = `${s.id}::${d}`;
        const viols = violationMap[vKey] || [];
        const hasHard = viols.some(v => v.type === 'HARD');
        const hasSoft = viols.some(v => v.type === 'SOFT');
        const violClass = hasHard ? ' cell-violation-hard' : hasSoft ? ' cell-violation-soft' : '';
        const violTip = viols.length ? ` title="${esc(viols.map(v=>v.message).join(' / '))}"` : '';

        if (!cell || cell.state==='off')      return `<td class="cell-off${violClass} ${lbl.cls}" data-sid="${sid}" data-date="${dd}"${violTip}>休</td>`;
        if (cell.state==='forcedOff')         return `<td class="cell-forced-off${violClass} ${lbl.cls}" data-sid="${sid}" data-date="${dd}" title="最大人数超過のため強制的に休みにしました">強制休</td>`;
        if (cell.state==='paid')              return `<td class="cell-paid${violClass} ${lbl.cls}" data-sid="${sid}" data-date="${dd}"${violTip}>有</td>`;
        if (cell.state==='wishOff')           return `<td class="cell-wish-off${violClass} ${lbl.cls}" data-sid="${sid}" data-date="${dd}"${violTip}>希</td>`;
        if (cell.state==='preferOff')         return `<td class="cell-prefer-off${violClass} ${lbl.cls}" data-sid="${sid}" data-date="${dd}"${violTip}>青</td>`;
        const h = cell.hours||0;
        const timeStr = (cell.workStart&&cell.workEnd) ? `${cell.workStart}〜${cell.workEnd}` : `${h}h`;
        const mark = cell.shiftType==='early' ? '<span class="cell-shift-mark early">早</span>' :
                     cell.shiftType==='late'  ? '<span class="cell-shift-mark late">遅</span>' : '';
        const tip = `${s.name} / ${d} / ${timeStr}`;
        return `<td class="cell-work${violClass} ${lbl.cls}" data-sid="${sid}" data-date="${dd}" title="${esc(tip)}" contenteditable="true">${mark}<span class="cell-time">${esc(timeStr)}</span></td>`;
      }).join('');

      const rowClass = isShort ? ' row-short-staff' : isOver ? ' row-over-staff' : '';
      return `<tr class="${rowClass}">${dateCell}${staffCells}${dateCellR}</tr>`;
    }).join('');

    // 集計行
    const workDaysRow = `<tr class="shift-summary-row">
      <td class="shift-summary-label sticky-col-date">出勤日数</td>
      ${staff.map(s=>`<td class="shift-summary-cell">${staffTotals[s.id].workDays}日</td>`).join('')}
      <td class="shift-summary-label">出勤日数</td>
    </tr>`;

    const restDaysRow = `<tr class="shift-summary-row">
      <td class="shift-summary-label sticky-col-date">休日数</td>
      ${staff.map(s => {
        const rd = staffTotals[s.id].restDays;
        const minRest = s.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS;
        const cls = rd < minRest ? 'diff-over' : '';
        return `<td class="shift-summary-cell"><span class="${cls}">${rd}日</span></td>`;
      }).join('')}
      <td class="shift-summary-label">休日数</td>
    </tr>`;

    const totalHRow = `<tr class="shift-summary-row">
      <td class="shift-summary-label sticky-col-date">合計時間</td>
      ${staff.map(s=>`<td class="shift-summary-cell shift-summary-hours">${staffTotals[s.id].totalH.toFixed(1)}h</td>`).join('')}
      <td class="shift-summary-label">合計時間</td>
    </tr>`;

    const monthRow = `<tr class="shift-summary-row shift-summary-monthly">
      <td class="shift-summary-label sticky-col-date">月所定<br><span style="font-size:9px">(差分)</span></td>
      ${staff.map(s => {
        const eff = State.getEffectiveStaff(s.id);
        const max = eff?.monthlyHours || CONSTANTS.DEFAULT_MONTHLY_HOURS;
        const act = staffTotals[s.id].totalH;
        const diff = act - max;
        const diffHtml = diff > 0.05  ? `<span class="diff-over">+${diff.toFixed(1)}</span>`
                       : diff < -0.05 ? `<span class="diff-under">${diff.toFixed(1)}</span>`
                       : `<span class="diff-ok">±0</span>`;
        return `<td class="shift-summary-cell shift-summary-target" title="月所定:${max}h / 実績:${act.toFixed(1)}h">${max}h<br>${diffHtml}</td>`;
      }).join('')}
      <td class="shift-summary-label">月所定<br><span style="font-size:9px">(差分)</span></td>
    </tr>`;

    return `<div class="shift-table-wrapper">
      <table class="shift-table shift-table-transposed">
        <thead>${headerRow}</thead>
        <tbody>${dataRows}${workDaysRow}${restDaysRow}${totalHRow}${monthRow}</tbody>
      </table>
    </div>`;
  };

  const _attachCellEditHandlers = (panel, plan, key) => {
    // 日付クリック → タイムラインモーダル
    panel.querySelectorAll('.shift-date-clickable').forEach(td => {
      td.addEventListener('click', () => {
        const date = td.dataset.date;
        if (!date) return;
        Modal.openDailyModal(plan, date, State.getPeriodDates());
      });
    });

    // セル編集
    panel.querySelectorAll('[contenteditable="true"][data-sid]').forEach(td => {
      td.addEventListener('blur', () => {
        const sid=td.dataset.sid, date=td.dataset.date, val=td.innerText.trim();
        const cell=plan.cells[sid]?.[date];
        if (!cell) return;
        if (val==='休'||val==='')         { cell.state='off';       cell.hours=0; }
        else if (val==='強')              { cell.state='forcedOff'; cell.hours=0; }
        else if (val==='有')              { cell.state='paid'; }
        else if (val==='希')              { cell.state='wishOff'; }
        else if (val==='青')              { cell.state='preferOff'; }
        else { cell.state='work'; const m=val.match(/(\d+\.?\d*)/); if(m) cell.hours=parseFloat(m[1]); }
        const violations=Validator.validateAll(plan);
        plan.violations=violations;
        panel.querySelectorAll('[data-sid][data-date]').forEach(t=>t.classList.remove('cell-violation-hard','cell-violation-soft'));
        violations.forEach(v => {
          if (!v.staffId||!v.date) return;
          const t=panel.querySelector(`[data-sid="${v.staffId}"][data-date="${v.date}"]`);
          if(t) t.classList.add(v.type==='HARD'?'cell-violation-hard':'cell-violation-soft');
        });
        State.getResult()[key].violations=violations;
        Storage.autoSave(showSaveStatus);
      });
    });
  };

  // ===== 生成フッター =====
  const updateGenerateInfo = () => {
    const staff=State.getStaff(), dates=State.getPeriodDates(), result=State.getResult();
    const el=$('generateInfoText');
    if (!el) return;
    if (result) {
      const vA=result.planA?.violations||[], vB=result.planB?.violations||[];
      const hA=vA.filter(x=>x.type==='HARD').length, hB=vB.filter(x=>x.type==='HARD').length;
      el.textContent=`最終生成: ${dates[0]||'?'} 〜 ${dates[dates.length-1]||'?'} ／ 案A:${hA}件 案B:${hB}件`;
    } else {
      el.textContent=`スタッフ${staff.length}人 ／ 期間${dates.length}日 ／ 未生成`;
    }
  };

  // ===== Event Delegation =====
  const initEventDelegation = () => {
    document.addEventListener('click', e => {
      const btn = e.target.closest('#staffTableBody [data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit-staff')   App.editStaff(btn.dataset.id);
      if (btn.dataset.action === 'delete-staff') App.deleteStaff(btn.dataset.id);
    });
    $('step2StaffList')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="select-step2-staff"]');
      if (!btn) return;
      State.setUI({ step2SelectedStaff: btn.dataset.id, step2Draft: {} });
      renderStep2StaffList(); renderStep2Calendar();
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('#step2RegisteredBody [data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit-step2')   App.editStep2(btn.dataset.id);
      if (btn.dataset.action === 'delete-step2') App.deleteStep2(btn.dataset.id);
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('#step4ExceptionList [data-action="delete-step4"]');
      if (!btn) return;
      App.deleteStep4(btn.dataset.id);
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('#resultContent [data-action="download-plan"]');
      if (!btn) return;
      App.downloadPlan(btn.dataset.key);
    });
  };

  // ===== DOM ヘルパー =====
  const _setVal     = (id, val)  => { const el=$(id); if(el) el.value=val??''; };
  const _setChecked = (id, val)  => { const el=$(id); if(el) el.checked=!!val; };
  const _setText    = (id, text) => { const el=$(id); if(el) el.textContent=text; };
  const _update5hBreakUI = (hours) => _updateBreakUI(hours);

  return {
    initTabs, switchTab, showSaveStatus, updateGenerateInfo,
    initStep1YearSelect, loadStep1Values, updatePeriodPreview,
    initEventDelegation,
    renderStaffTable, fillStaffForm, clearStaffForm, _updateBreakUI, _update5hBreakUI,
    renderStep2StaffList, renderStep2Calendar, renderStep2Status,
    renderStep3Table,
    renderStep4StaffCheckboxes, renderStep4ExceptionList,
    renderStep5Table,
    renderResult,
    $, esc,
  };
})();
