/**
 * modal.js
 * モーダル・ダイアログ・トースト通知 + 日別タイムラインモーダル
 */

const Modal = window.Modal = (() => {

  // ===== トースト通知 =====
  const toast = (message, type = 'info', duration = 3000) => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${_toastIcon(type)}</span><span>${_escHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'fadeOut 300ms ease forwards';
      setTimeout(() => el.remove(), 300);
    }, duration);
  };

  const toastSuccess = (msg) => toast(msg, 'success');
  const toastError   = (msg) => toast(msg, 'error', 4000);
  const toastWarning = (msg) => toast(msg, 'warning', 4000);

  const _toastIcon = (type) => ({ success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] || 'ℹ');

  // ===== 確認ダイアログ =====
  let _confirmResolve = null;

  const confirm = (message, title = '確認') => {
    return new Promise((resolve) => {
      _confirmResolve = resolve;
      document.getElementById('dialogTitle').textContent   = title;
      document.getElementById('dialogMessage').textContent = message;
      document.getElementById('confirmDialog').style.display = 'flex';
    });
  };

  const _initConfirmDialog = () => {
    document.getElementById('dialogConfirm')?.addEventListener('click', () => {
      document.getElementById('confirmDialog').style.display = 'none';
      if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
    });
    document.getElementById('dialogCancel')?.addEventListener('click', () => {
      document.getElementById('confirmDialog').style.display = 'none';
      if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
    });
  };

  // ===== シフト表モーダル =====
  let _zoomLevel = 100;

  const openShiftModal = (title, htmlContent) => {
    const modal = document.getElementById('shiftModal');
    document.getElementById('shiftModalTitle').textContent = title;
    document.getElementById('shiftModalBody').innerHTML = htmlContent;
    _updateZoom();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  const closeShiftModal = () => {
    document.getElementById('shiftModal').style.display = 'none';
    document.body.style.overflow = '';
  };

  const _updateZoom = () => {
    const body = document.getElementById('shiftModalBody');
    if (!body) return;
    const inner = body.firstElementChild;
    if (inner) inner.style.transform = `scale(${_zoomLevel / 100})`;
    document.getElementById('zoomLevel').textContent = `${_zoomLevel}%`;
  };

  const _initShiftModal = () => {
    document.getElementById('closeShiftModal')?.addEventListener('click', closeShiftModal);
    document.getElementById('shiftModal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('shiftModal')) closeShiftModal();
    });
    document.getElementById('zoomIn')?.addEventListener('click', () => {
      _zoomLevel = Math.min(_zoomLevel + 10, 200); _updateZoom();
      State.setUI({ zoomLevel: _zoomLevel });
    });
    document.getElementById('zoomOut')?.addEventListener('click', () => {
      _zoomLevel = Math.max(_zoomLevel - 10, 50); _updateZoom();
      State.setUI({ zoomLevel: _zoomLevel });
    });
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('shiftModal')?.style.display !== 'none') {
        if (e.key === 'Escape') closeShiftModal();
        if (e.key === '+' || e.key === '=') { _zoomLevel = Math.min(_zoomLevel + 10, 200); _updateZoom(); }
        if (e.key === '-') { _zoomLevel = Math.max(_zoomLevel - 10, 50); _updateZoom(); }
      }
    });
  };

  // ===== 日別タイムラインモーダル =====
  let _dailyCurrentPlan = null;
  let _dailyCurrentDate = null;
  let _dailyDates = [];

  const openDailyModal = (plan, date, dates) => {
    _dailyCurrentPlan = plan;
    _dailyCurrentDate = date;
    _dailyDates = dates;
    _renderDailyModal();
    document.getElementById('dailyModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  const closeDailyModal = () => {
    document.getElementById('dailyModal').style.display = 'none';
    document.body.style.overflow = '';
  };

  const _renderDailyModal = () => {
    const date  = _dailyCurrentDate;
    const plan  = _dailyCurrentPlan;
    const dates = _dailyDates;
    const staff = State.getStaff();
    const step1 = State.getStep1();

    const d    = new Date(date + 'T00:00:00');
    const wday = CONSTANTS.WEEKDAY_SHORT[d.getDay()];
    document.getElementById('dailyModalTitle').textContent =
      `${d.getMonth()+1}月${d.getDate()}日（${wday}） の勤務スケジュール`;

    // 前後日ボタンの活性化
    const idx = dates.indexOf(date);
    document.getElementById('dailyPrevBtn').disabled = idx <= 0;
    document.getElementById('dailyNextBtn').disabled = idx >= dates.length - 1;

    // 就業時間の範囲を計算（表示範囲）
    const bizStart = step1.bizStartTime || '09:00';
    const bizEnd   = step1.bizEndTime   || '18:00';
    const dispStart = _timeToMin(_addMinutes(bizStart, -90));
    const dispEnd   = _timeToMin(_addMinutes(bizEnd,    90));
    const totalMin  = dispEnd - dispStart;

    // 出勤スタッフを取得
    const workingStaff = staff.filter(s => {
      const cell = plan.cells[s.id]?.[date];
      return cell && cell.state === 'work';
    });

    if (!workingStaff.length) {
      document.getElementById('dailyModalBody').innerHTML =
        '<div class="daily-empty">この日の出勤者はいません</div>';
      return;
    }

    // タイムライン描画
    let html = `
      <div class="daily-timeline">
        <div class="daily-timeline-header">
          ${_buildTimeAxis(dispStart, dispEnd)}
        </div>
        <div class="daily-rows">`;

    for (const s of workingStaff) {
      const cell = plan.cells[s.id][date];
      const startMin = _timeToMin(cell.workStart || bizStart) - dispStart;
      const endMin   = _timeToMin(cell.workEnd   || bizEnd)   - dispStart;
      const leftPct  = Math.max(0, startMin / totalMin * 100);
      const widthPct = Math.max(1, (endMin - startMin) / totalMin * 100);
      const isEarly  = cell.shiftType === 'early';
      const isLate   = cell.shiftType === 'late';
      const shiftClass = isEarly ? 'early' : isLate ? 'late' : '';
      const shiftLabel = isEarly ? '早番' : isLate ? '遅番' : '';
      const catClass = s.category === CONSTANTS.CATEGORY.EMPLOYEE ? 'tag-employee' : 'tag-community';

      html += `
        <div class="daily-row">
          <div class="daily-name">
            <span class="tag ${catClass}" style="font-size:9px;margin-right:4px">
              ${s.category === CONSTANTS.CATEGORY.EMPLOYEE ? '社' : 'コ'}
            </span>
            ${_escHtml(s.name)}
          </div>
          <div class="daily-bar-track">
            <div class="daily-bar ${shiftClass}"
                 style="left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%"
                 title="${_escHtml(s.name)} ${cell.workStart||bizStart}〜${cell.workEnd||bizEnd}">
              <span class="daily-bar-label">
                ${cell.workStart||bizStart}〜${cell.workEnd||bizEnd}
                ${shiftLabel ? `<em>${shiftLabel}</em>` : ''}
              </span>
            </div>
          </div>
        </div>`;
    }
    html += `</div></div>`;

    // 出勤人数サマリー
    const total = workingStaff.length;
    const emp   = workingStaff.filter(s => s.category === CONSTANTS.CATEGORY.EMPLOYEE).length;
    const early = workingStaff.filter(s => plan.cells[s.id][date]?.shiftType === 'early').length;
    const late  = workingStaff.filter(s => plan.cells[s.id][date]?.shiftType === 'late').length;
    html += `
      <div class="daily-summary">
        <span>出勤: <strong>${total}人</strong></span>
        <span>社員: <strong>${emp}人</strong></span>
        ${early ? `<span>早番: <strong>${early}人</strong></span>` : ''}
        ${late  ? `<span>遅番: <strong>${late}人</strong></span>`  : ''}
      </div>`;

    document.getElementById('dailyModalBody').innerHTML = html;
  };

  const _buildTimeAxis = (startMin, endMin) => {
    const totalMin = endMin - startMin;
    let html = '<div class="time-axis">';
    for (let m = startMin; m <= endMin; m += 60) {
      const pct = (m - startMin) / totalMin * 100;
      const h   = Math.floor(m / 60);
      const label = `${String(h).padStart(2,'0')}:00`;
      html += `<span class="time-axis-tick" style="left:${pct.toFixed(1)}%">${label}</span>`;
    }
    html += '</div>';
    return html;
  };

  const _initDailyModal = () => {
    document.getElementById('closeDailyModal')?.addEventListener('click', closeDailyModal);
    document.getElementById('dailyModal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('dailyModal')) closeDailyModal();
    });
    document.getElementById('dailyPrevBtn')?.addEventListener('click', () => {
      const idx = _dailyDates.indexOf(_dailyCurrentDate);
      if (idx > 0) { _dailyCurrentDate = _dailyDates[idx - 1]; _renderDailyModal(); }
    });
    document.getElementById('dailyNextBtn')?.addEventListener('click', () => {
      const idx = _dailyDates.indexOf(_dailyCurrentDate);
      if (idx < _dailyDates.length - 1) { _dailyCurrentDate = _dailyDates[idx + 1]; _renderDailyModal(); }
    });
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('dailyModal')?.style.display !== 'none') {
        if (e.key === 'Escape') closeDailyModal();
        if (e.key === 'ArrowLeft') document.getElementById('dailyPrevBtn')?.click();
        if (e.key === 'ArrowRight') document.getElementById('dailyNextBtn')?.click();
      }
    });
  };

  // ===== ローディングオーバーレイ =====
  let _loadingEl = null;

  const showLoading = (message = '処理中...') => {
    if (_loadingEl) return;
    _loadingEl = document.createElement('div');
    _loadingEl.className = 'loading-overlay';
    _loadingEl.innerHTML = `<div class="loading-spinner"></div><div class="loading-text">${_escHtml(message)}</div>`;
    document.body.appendChild(_loadingEl);
  };

  const hideLoading = () => {
    if (_loadingEl) { _loadingEl.remove(); _loadingEl = null; }
  };

  // ===== 初期化 =====
  const init = () => {
    _initConfirmDialog();
    _initShiftModal();
    _initDailyModal();
    const ui = State.getUI();
    if (ui.zoomLevel) _zoomLevel = ui.zoomLevel;
  };

  // ===== ユーティリティ =====
  const _escHtml = (s) =>
    String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const _timeToMin = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const _addMinutes = (timeStr, minutes) => {
    if (!timeStr) return timeStr;
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const rh = Math.max(0, Math.min(23, Math.floor(total / 60)));
    const rm = Math.max(0, Math.abs(total) % 60);
    return `${String(rh).padStart(2,'0')}:${String(rm).padStart(2,'0')}`;
  };

  return {
    toast, toastSuccess, toastError, toastWarning,
    confirm,
    openShiftModal, closeShiftModal,
    openDailyModal, closeDailyModal,
    showLoading, hideLoading,
    init,
  };
})();
