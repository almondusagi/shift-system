/**
 * app.js - アプリ起動・イベントバインディング
 */
const App = window.App = (() => {

  let _staffSortKey = null, _staffSortAsc = true;
  let _step2SortKey = null, _step2SortAsc = true;
  let _editingStaffId = null;
  const _step4Dates = [];
  let _step4AnyDays = 0;

  // ===== 起動 =====
  const init = () => {
    Storage.restoreAll();
    Modal.init();
    UI.initTabs();
    UI.initStep1YearSelect();
    UI.loadStep1Values();

    _bindStaff();
    _bindStep1();
    _bindStep2();
    _bindStep3();
    _bindStep4();
    _bindStep5();
    _bindGenerate();
    _bindResultTabs();
    UI.initEventDelegation();

    UI.renderStaffTable();
    UI.renderStep2StaffList();
    UI.renderStep4ExceptionList();
    UI.renderStep3Table();
    UI.renderStep5Table();
    UI.renderResult();
    UI.updateGenerateInfo();

    const savedTab = State.getUI().activeTab;
    if (savedTab) UI.switchTab(savedTab);

    _initSortHeaders();
    console.log('[ShiftPlan v2] 起動完了');
  };

  const _initSortHeaders = () => {
    document.querySelectorAll('#staffTable thead th[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (_staffSortKey === key) _staffSortAsc = !_staffSortAsc;
        else { _staffSortKey = key; _staffSortAsc = true; }
        UI.renderStaffTable(_currentFilter(), _staffSortKey, _staffSortAsc);
      });
    });
    document.querySelectorAll('#step2RegisteredTable thead th[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (_step2SortKey === key) _step2SortAsc = !_step2SortAsc;
        else { _step2SortKey = key; _step2SortAsc = true; }
        UI.renderStep2Status(_step2SortKey, _step2SortAsc);
      });
    });
  };

  const _currentFilter = () =>
    document.querySelector('.filter-btn[data-filter].active')?.dataset.filter || 'all';

  /** 出勤目安/週の自動表示更新 */
  const _updateWeeklyDaysDisplay = (monthly, daily) => {
    const el = UI.$('weeklyDaysDisplay');
    if (!el) return;
    if (!monthly || !daily || daily <= 0) {
      el.textContent = '月所定と1日労働時間を入力してください';
      return;
    }
    const val = monthly / daily / 4;
    if (Number.isInteger(val)) {
      el.textContent = `（目安）${val}日/週`;
    } else {
      el.textContent = `（目安）${Math.floor(val)}～${Math.ceil(val)}日/週`;
    }
  };

  // ===== スタッフ管理 =====
  const _bindStaff = () => {
    UI.$('monthlyHours')?.addEventListener('input', () => {
      const m = parseFloat(UI.$('monthlyHours').value) || 0;
      const d = parseFloat(UI.$('dailyHours')?.value) || 0;
      _updateWeeklyDaysDisplay(m, d);
    });
    UI.$('dailyHours')?.addEventListener('input', () => {
      const m = parseFloat(UI.$('monthlyHours')?.value) || 0;
      const d = parseFloat(UI.$('dailyHours').value) || 0;
      UI._updateBreakUI(d);
      _updateWeeklyDaysDisplay(m, d);
    });

    UI.$('registerStaff')?.addEventListener('click', _handleRegisterStaff);
    UI.$('clearStaffForm')?.addEventListener('click', () => {
      _editingStaffId = null;
      UI.clearStaffForm();
    });

    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        UI.renderStaffTable(btn.dataset.filter, _staffSortKey, _staffSortAsc);
      });
    });

    UI.$('exportStaffCSV')?.addEventListener('click', () => {
      try { CSV.exportStaff(); Modal.toastSuccess('スタッフCSVを出力しました'); }
      catch(e) { Modal.toastError(e.message); }
    });

    UI.$('importStaffCSV')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await _readFile(file);
        const imported = CSV.importStaff(text);
        const existing = State.getStaff().map(s => s.name);
        let added = [], skipped = [];
        imported.forEach(m => {
          if (existing.includes(m.name)) { skipped.push(m.name); return; }
          State.addStaff(m); added.push(m.name);
        });
        Storage.autoSave(UI.showSaveStatus);
        UI.renderStaffTable(_currentFilter(), _staffSortKey, _staffSortAsc);
        UI.updateGenerateInfo();
        Modal.toastSuccess(`${added.length}人読み込み完了${skipped.length ? `（${skipped.join('、')}は重複スキップ）` : ''}`);
      } catch(err) { Modal.toastError(`CSV読込エラー: ${err.message}`); }
      e.target.value = '';
    });
  };

  const _handleRegisterStaff = async () => {
    const name     = (UI.$('staffName')?.value || '').trim();
    const category = UI.$('staffCategory')?.value || '';
    if (!name)     { Modal.toastError('スタッフ名を入力してください'); UI.$('staffName')?.focus(); return; }
    if (!category) { Modal.toastError('区分を選択してください'); UI.$('staffCategory')?.focus(); return; }

    const monthly  = parseFloat(UI.$('monthlyHours')?.value) || CONSTANTS.DEFAULT_MONTHLY_HOURS;
    const daily    = parseFloat(UI.$('dailyHours')?.value)   || CONSTANTS.DEFAULT_DAILY_HOURS;
    const minRest  = parseInt(UI.$('minRestDays')?.value) || CONSTANTS.DEFAULT_MIN_REST_DAYS;

    const member = {
      id:            _editingStaffId || State.generateId(),
      name, category,
      monthlyHours:  monthly, dailyHours: daily,
      hasBreak5h:    UI.$('hasBreak5h')?.checked || false,
      workStartAmPm: UI.$('workStartAmPm')?.value || 'am',
      workStartTime: UI.$('workStartTime')?.value || '',
      workEndAmPm:   UI.$('workEndAmPm')?.value   || 'pm',
      workEndTime:   UI.$('workEndTime')?.value    || '',
      minRestDays:   minRest,
    };

    const dup = State.getStaff().find(s => s.name === name && s.id !== _editingStaffId);
    if (dup) {
      const ok = await Modal.confirm(`「${name}」は既に登録されています。上書きしてもよろしいですか？`, '上書き確認');
      if (!ok) return;
      State.updateStaff(dup.id, { ...member, id: dup.id });
      // スタッフマスタ更新時、STEP3の該当スタッフ情報をリセット
      State.setStep3ForStaff(dup.id, {});
      State.setStep3Draft(dup.id, {});
      Modal.toastSuccess(`${name} を上書き更新しました`);
    } else if (_editingStaffId) {
      State.updateStaff(_editingStaffId, member);
      // スタッフマスタ更新時、STEP3の該当スタッフ情報をリセット
      State.setStep3ForStaff(_editingStaffId, {});
      State.setStep3Draft(_editingStaffId, {});
      Modal.toastSuccess(`${name} を更新しました`);
    } else {
      State.addStaff(member);
      Modal.toastSuccess(`${name} を登録しました`);
    }

    _editingStaffId = null;
    Storage.autoSave(UI.showSaveStatus);
    UI.clearStaffForm();
    UI.renderStaffTable(_currentFilter(), _staffSortKey, _staffSortAsc);
    UI.renderStep3Table();
    UI.updateGenerateInfo();
  };

  const editStaff = (id) => {
    const staff = State.getStaffById(id);
    if (!staff) return;
    _editingStaffId = id;
    UI.fillStaffForm(staff);
    UI.$('registerStaff').textContent = '更新する';
    UI.switchTab('staff');
    document.querySelector('.form-card')?.scrollIntoView({ behavior: 'smooth' });
    Modal.toast(`${staff.name} を編集中`, 'info');
  };

  const deleteStaff = async (id) => {
    const staff = State.getStaffById(id);
    if (!staff) return;
    const ok = await Modal.confirm(`本当に削除をしてもよろしいですか？\n「${staff.name}」のデータはすべて削除されます。`);
    if (!ok) return;
    State.removeStaff(id);
    Storage.autoSave(UI.showSaveStatus);
    UI.renderStaffTable(_currentFilter(), _staffSortKey, _staffSortAsc);
    UI.updateGenerateInfo();
    Modal.toastSuccess(`${staff.name} を削除しました`);
  };

  // ===== STEP1 =====
  const _bindStep1 = () => {
    const fields = ['targetYear','targetMonth','startDay','bizStartAmPm','bizStartTime',
                    'bizEndAmPm','bizEndTime','minStaff','maxStaff','minEmployee','maxEmployee',
                    'earlyCountMin','earlyCountMax','lateCountMin','lateCountMax'];
    fields.forEach(id => UI.$(id)?.addEventListener('change', _saveStep1));
    ['targetYear','targetMonth','startDay'].forEach(id =>
      UI.$(id)?.addEventListener('change', UI.updatePeriodPreview));
    UI.$('saveStep1')?.addEventListener('click', () => {
      _saveStep1(); Modal.toastSuccess('STEP1を保存しました');
    });
  };

  const _saveStep1 = () => {
    const _int = (id, def) => { const v = parseInt(UI.$(id)?.value); return isNaN(v) ? def : v; };
    const _nullInt = (id) => { const v = parseInt(UI.$(id)?.value); return isNaN(v) || UI.$(id)?.value === '' ? null : v; };

    State.setStep1({
      year:         _int('targetYear', new Date().getFullYear()),
      month:        _int('targetMonth', 1),
      startDay:     _int('startDay', 1),
      bizStartAmPm: UI.$('bizStartAmPm')?.value || 'am',
      bizStartTime: UI.$('bizStartTime')?.value || '09:00',
      bizEndAmPm:   UI.$('bizEndAmPm')?.value   || 'pm',
      bizEndTime:   UI.$('bizEndTime')?.value    || '18:00',
      minStaff:     _nullInt('minStaff'),
      maxStaff:     _nullInt('maxStaff'),
      minEmployee:  _nullInt('minEmployee'),
      maxEmployee:  _nullInt('maxEmployee'),
      minCommunity:  _nullInt('minCommunity'),
      maxCommunity:  _nullInt('maxCommunity'),
      earlyCountMin: _nullInt('earlyCountMin'),
      earlyCountMax: _nullInt('earlyCountMax'),
      lateCountMin:  _nullInt('lateCountMin'),
      lateCountMax:  _nullInt('lateCountMax'),
    });
    Storage.autoSave(UI.showSaveStatus);
    UI.updateGenerateInfo();
    UI.renderStaffTable();  // 就業時間変更に伴う早番可/遅番可表記更新
  };

  // ===== STEP2 =====
  const _bindStep2 = () => {
    UI.$('registerStep2')?.addEventListener('click', _handleRegisterStep2);
    UI.$('clearStep2')?.addEventListener('click', () => {
      State.setUI({ step2Draft: {} });
      UI.renderStep2Calendar();
    });
  };

  const _handleRegisterStep2 = async () => {
    const selId = State.getUI().step2SelectedStaff;
    if (!selId) { Modal.toastError('スタッフを選択してください'); return; }
    const draft = State.getUI().step2Draft || {};
    if (Object.keys(draft).length === 0) {
      Modal.toast('変更がありません。セルをクリックして状態を変更してください。', 'info'); return;
    }
    const cur = State.getStep2For(selId);
    if (Object.values(cur).some(v => v !== '')) {
      const ok = await Modal.confirm('既に登録されています。上書きしてもよろしいですか？', '上書き確認');
      if (!ok) return;
    }
    const merged = { ...cur, ...draft };
    Object.keys(merged).forEach(d => { if (!merged[d]) delete merged[d]; });
    State.setStep2ForStaff(selId, merged);
    State.setUI({ step2Draft: {} });
    Storage.autoSave(UI.showSaveStatus);
    UI.renderStep2Status(_step2SortKey, _step2SortAsc);
    UI.renderStep2Calendar();
    Modal.toastSuccess('希望休を登録しました');
  };

  const editStep2 = (staffId) => {
    State.setUI({ step2SelectedStaff: staffId, step2Draft: {} });
    UI.switchTab('step2');
    setTimeout(() => { UI.renderStep2StaffList(); UI.renderStep2Calendar(); }, 80);
  };

  const deleteStep2 = async (staffId) => {
    const staff = State.getStaffById(staffId);
    const ok = await Modal.confirm(`${staff?.name || 'このスタッフ'} の希望休データを削除しますか？`);
    if (!ok) return;
    State.removeStep2ForStaff(staffId);
    Storage.autoSave(UI.showSaveStatus);
    UI.renderStep2Status(_step2SortKey, _step2SortAsc);
    Modal.toastSuccess('希望休データを削除しました');
  };

  // ===== STEP3 =====
  const _bindStep3 = () => {
    UI.$('saveStep3')?.addEventListener('click', () => {
      const draft = State.getUI().step3Draft || {};
      const draftKeys = Object.keys(draft);
      if (!draftKeys.length) {
        Modal.toast('保存する変更がありません。', 'info');
        return;
      }
      // ドラフト内容をstep3確定データにマージ
      for (const staffId of draftKeys) {
        const curOver = State.getStep3For(staffId) || {};
        const newOver = { ...curOver, ...draft[staffId] };
        // 空のオブジェクトならクリア
        if (Object.keys(newOver).length) {
          State.setStep3ForStaff(staffId, newOver);
        } else {
          State.setStep3ForStaff(staffId, {});
        }
      }
      // ドラフトをリセット
      State.resetStep3Draft();
      Storage.autoSave(UI.showSaveStatus);
      UI.renderStep3Table();
      Modal.toastSuccess('STEP3を保存しました');
    });
  };

  // ===== STEP4 =====
  const _bindStep4 = () => {
    UI.$('step4AddDate')?.addEventListener('click', () => {
      const val = UI.$('step4DateInput')?.value;
      if (!val) { Modal.toastError('日付を入力してください'); return; }
      _step4AnyDays = 0;
      if (!_step4Dates.includes(val)) { _step4Dates.push(val); _step4Dates.sort(); }
      _renderStep4Dates();
    });

    UI.$('step4AddDays')?.addEventListener('click', () => {
      const count = parseInt(UI.$('step4DayCount')?.value) || 0;
      if (count < 1) { Modal.toastError('日数を1以上で入力してください'); return; }
      _step4Dates.length = 0;
      _step4AnyDays = count;
      _renderStep4Dates();
    });

    document.querySelectorAll('input[name="step4WorkTime"]').forEach(r => {
      r.addEventListener('change', () => {
        const show = document.querySelector('input[name="step4WorkTime"]:checked')?.value === 'change';
        UI.$('step4WorkTimeField').style.display = show ? 'block' : 'none';
      });
    });
    document.querySelectorAll('input[name="step4StaffCount"]').forEach(r => {
      r.addEventListener('change', () => {
        const show = document.querySelector('input[name="step4StaffCount"]:checked')?.value === 'change';
        UI.$('step4StaffCountField').style.display = show ? 'block' : 'none';
      });
    });
    document.querySelectorAll('input[name="step4Target"]').forEach(r => {
      r.addEventListener('change', () => {
        const show = document.querySelector('input[name="step4Target"]:checked')?.value === 'individual';
        UI.$('step4IndividualField').style.display = show ? 'block' : 'none';
      });
    });
    UI.$('addStep4Exception')?.addEventListener('click', _addStep4Exception);
  };

  const _renderStep4Dates = () => {
    const container = UI.$('step4SelectedDates');
    if (!container) return;
    if (_step4AnyDays > 0) {
      container.innerHTML = `<span class="date-chip" style="background:#dbeafe;color:#1d4ed8">期間内から <strong>${_step4AnyDays}日間</strong> を自動選択</span>
        <button class="btn btn-ghost btn-sm" id="clearAnyDays" style="margin-left:8px">×クリア</button>`;
      container.querySelector('#clearAnyDays')?.addEventListener('click', () => { _step4AnyDays = 0; _renderStep4Dates(); });
      return;
    }
    if (!_step4Dates.length) {
      container.innerHTML = '<span class="empty-hint">日付が選択されていません</span>'; return;
    }
    container.innerHTML = _step4Dates.map(d =>
      `<span class="date-chip">${UI.esc(d)}<span class="date-chip-remove" data-date="${UI.esc(d)}" style="cursor:pointer;margin-left:4px">×</span></span>`
    ).join('');
    container.querySelectorAll('.date-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = _step4Dates.indexOf(btn.dataset.date);
        if (idx >= 0) _step4Dates.splice(idx, 1);
        _renderStep4Dates();
      });
    });
  };

  const _addStep4Exception = () => {
    if (!_step4Dates.length && _step4AnyDays === 0) {
      Modal.toastError('対象日付または日数を設定してください'); return;
    }
    const workTimeVal   = document.querySelector('input[name="step4WorkTime"]:checked')?.value;
    const staffCountVal = document.querySelector('input[name="step4StaffCount"]:checked')?.value;
    const targetVal     = document.querySelector('input[name="step4Target"]:checked')?.value;
    const individualIds = [...document.querySelectorAll('.step4-staff-cb:checked')].map(c => c.value);

    const _nullInt = (id) => { const v = parseInt(UI.$(id)?.value); return isNaN(v) || UI.$(id)?.value === '' ? null : v; };

    State.addStep4({
      id:               State.generateId(),
      dates:            _step4AnyDays > 0 ? [] : [..._step4Dates],
      anyDays:          _step4AnyDays,
      workTimeChange:   workTimeVal === 'change',
      workStart:        workTimeVal === 'change' ? (UI.$('step4StartTime')?.value || null) : null,
      workEnd:          workTimeVal === 'change' ? (UI.$('step4EndTime')?.value   || null) : null,
      staffCountChange: staffCountVal === 'change',
      minStaff:         staffCountVal === 'change' ? _nullInt('step4MinStaff')    : null,
      maxStaff:         staffCountVal === 'change' ? _nullInt('step4MaxStaff')    : null,
      minEmployee:      staffCountVal === 'change' ? _nullInt('step4MinEmployee') : null,
      maxEmployee:      staffCountVal === 'change' ? _nullInt('step4MaxEmployee') : null,
      minCommunity:     staffCountVal === 'change' ? _nullInt('step4MinCommunity') : null,
      maxCommunity:     staffCountVal === 'change' ? _nullInt('step4MaxCommunity') : null,
      earlyCountMin:    staffCountVal === 'change' ? _nullInt('step4EarlyCountMin') : null,
      earlyCountMax:    staffCountVal === 'change' ? _nullInt('step4EarlyCountMax') : null,
      lateCountMin:     staffCountVal === 'change' ? _nullInt('step4LateCountMin')  : null,
      lateCountMax:     staffCountVal === 'change' ? _nullInt('step4LateCountMax')  : null,
      target:           targetVal || 'all',
      targetStaffIds:   targetVal === 'individual' ? individualIds : [],
    });

    Storage.autoSave(UI.showSaveStatus);
    UI.renderStep4ExceptionList();
    _step4Dates.length = 0; _step4AnyDays = 0;
    _renderStep4Dates();
    Modal.toastSuccess('例外シフトを追加しました');
  };

  const deleteStep4 = async (id) => {
    const ok = await Modal.confirm('この例外シフト設定を削除しますか？');
    if (!ok) return;
    State.removeStep4(id);
    Storage.autoSave(UI.showSaveStatus);
    UI.renderStep4ExceptionList();
    Modal.toastSuccess('例外シフトを削除しました');
  };

  // ===== STEP5 =====
  const _bindStep5 = () => {
    UI.$('exportStep5CSV')?.addEventListener('click', () => {
      try { CSV.exportStep5(); Modal.toastSuccess('CSVを出力しました'); }
      catch(e) { Modal.toastError(e.message); }
    });
    UI.$('importStep5CSV')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await _readFile(file);
        State.setStep5(CSV.importStep5(text));
        Storage.autoSave(UI.showSaveStatus);
        UI.renderStep5Table();
        Modal.toastSuccess('前月シフトを読み込みました');
      } catch(err) { Modal.toastError(`CSV読込エラー: ${err.message}`); }
      e.target.value = '';
    });
  };

  // ===== シフト生成 =====
  const _bindGenerate = () => {
    UI.$('generateShift')?.addEventListener('click', generateShift);
    UI.$('regenerateShift')?.addEventListener('click', async () => {
      const ok = await Modal.confirm('現在の生成結果を破棄して再生成しますか？');
      if (ok) generateShift();
    });
  };

  const _bindResultTabs = () => {
    // タブ切替不要（planAのみ）
  };

  const generateShift = () => {
    if (!State.getStaff().length)       { Modal.toastError('スタッフが登録されていません'); return; }
    if (!State.getPeriodDates().length) { Modal.toastError('STEP1で対象期間を設定してください'); return; }

    // STEP3未保存ドラフトがある場合は破棄して保存済み状態に戻す
    const draft = State.getUI().step3Draft || {};
    if (Object.keys(draft).length) {
      State.resetStep3Draft();
      UI.renderStep3Table();
    }

    Modal.showLoading('シフトを生成中...');
    setTimeout(() => {
      try {
        const { planA, log } = Generator.generate();
        State.setResult({ planA, log });
        Storage.autoSave(UI.showSaveStatus);
        UI.renderResult();
        UI.updateGenerateInfo();
        UI.switchTab('result');
        Modal.hideLoading();
        const hA = planA.violations.filter(v => v.type === 'HARD').length;
        if (hA > 0)
          Modal.toastWarning(`生成完了。${hA}件の制約違反があります。内容を確認してください。`);
        else
          Modal.toastSuccess('シフトを生成しました（制約充足）');
      } catch(err) {
        Modal.hideLoading();
        Modal.toastError(`生成エラー: ${err.message}`);
        console.error('[Generator]', err);
      }
    }, 50);
  };

  const downloadPlan = (key) => {
    const result = State.getResult();
    if (!result) { Modal.toastError('生成結果がありません'); return; }
    const plan = result.planA;
    if (!plan) { Modal.toastError('対象の案が見つかりません'); return; }
    try {
      CSV.exportShiftResult(plan);
      Modal.toastSuccess('シフト表をダウンロードしました');
    } catch(e) { Modal.toastError(e.message); }
  };

  // ===== ユーティリティ =====
  const _readFile = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    r.readAsText(file, 'UTF-8');
  });

  return {
    init,
    editStaff, deleteStaff,
    editStep2, deleteStep2,
    deleteStep4,
    generateShift, downloadPlan,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
