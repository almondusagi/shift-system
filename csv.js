/**
 * csv.js
 * CSV読み書き — ネイティブJavaScriptのみ。外部ライブラリ禁止。
 * xlsx対応なし。CSV専用。
 */

const CSV = window.CSV = (() => {

  const DELIM   = CONSTANTS.CSV_DELIMITER;
  const NEWLINE = CONSTANTS.CSV_NEWLINE;

  // ===== エンコード =====

  // 値を1セル分にエスケープ
  const _escapeCell = (val) => {
    if (val == null) return '';
    const s = String(val);
    // カンマ・改行・ダブルクォートを含む場合はクォートで囲む
    if (s.includes(DELIM) || s.includes('\n') || s.includes('\r') || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // 2次元配列 → CSV文字列
  const encode = (rows) => {
    return rows
      .map(row => row.map(_escapeCell).join(DELIM))
      .join(NEWLINE);
  };

  // ===== デコード =====

  // CSV文字列 → 2次元配列
  const decode = (text) => {
    const rows  = [];
    let row     = [];
    let cell    = '';
    let inQuote = false;
    // 末尾の改行を正規化
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < normalized.length; i++) {
      const ch   = normalized[i];
      const next = normalized[i + 1];

      if (inQuote) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === DELIM) {
          row.push(cell);
          cell = '';
        } else if (ch === '\n') {
          row.push(cell);
          rows.push(row);
          row  = [];
          cell = '';
        } else {
          cell += ch;
        }
      }
    }
    // 末尾セル処理
    if (cell !== '' || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    // 末尾空行除去
    while (rows.length && rows[rows.length - 1].every(c => c === '')) {
      rows.pop();
    }
    return rows;
  };

  // ===== ダウンロード =====

  // BOM付きUTF-8でCSVをダウンロード
  // file://環境でも動作するようdata:URL方式を使用
  const download = (filename, rows) => {
    const csv  = encode(rows);
    const bom  = '\uFEFF'; // BOM（Excel文字化け防止）
    
    // Blob URL方式（モダンブラウザ）
    try {
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    } catch(e) {
      // フォールバック: data:URL方式
      const encoded = encodeURIComponent(bom + csv);
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encoded;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
    }
  };

  // ===== スタッフCSV =====

  const exportStaff = () => {
    const staff = State.getStaff();
    const header = CONSTANTS.STAFF_CSV_HEADER;
    const rows = [header, ...staff.map(s => [
      s.name,
      CONSTANTS.CATEGORY_LABEL[s.category] || s.category,
      s.monthlyHours,
      s.dailyHours,
      s.hasBreak5h  ? '1' : '0',
      s.workStartAmPm  || '',
      s.workStartTime  || '',
      s.workEndAmPm    || '',
      s.workEndTime    || '',
      s.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS,
    ])];
    download(`スタッフ一覧_${_today()}.csv`, rows);
  };

  const importStaff = (text) => {
    const rows = decode(text);
    if (rows.length < 2) throw new Error('データが見つかりません');
    const header = rows[0];
    // ヘッダー検証
    if (header[0] !== CONSTANTS.STAFF_CSV_HEADER[0]) {
      throw new Error('スタッフCSVのヘッダーが一致しません');
    }
    const imported = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0]) continue;
      const catRaw = r[1] || '';
      const category =
        catRaw === '社員' ? CONSTANTS.CATEGORY.EMPLOYEE :
        catRaw === 'コミュニティ' ? CONSTANTS.CATEGORY.COMMUNITY :
        catRaw; // そのままフォールバック
      const dailyHours = parseFloat(r[3]) || CONSTANTS.DEFAULT_DAILY_HOURS;
      let hasBreak5h = r[4] === '1';
      if (dailyHours > 5) {
        hasBreak5h = true;
      } else if (dailyHours < 5) {
        hasBreak5h = false;
      }

      imported.push({
        id:           State.generateId(),
        name:         r[0],
        category,
        monthlyHours: parseFloat(r[2]) || CONSTANTS.DEFAULT_MONTHLY_HOURS,
        dailyHours:   dailyHours,
        hasBreak5h:   hasBreak5h,
        workStartAmPm: r[5] || 'am',
        workStartTime: r[6] || '',
        workEndAmPm:   r[7] || 'pm',
        workEndTime:   r[8] || '',
        minRestDays:   parseInt(r[9]) || CONSTANTS.DEFAULT_MIN_REST_DAYS,
      });
    }
    return imported;
  };

  // ===== STEP5 前月シフトCSV =====

  const exportStep5 = () => {
    const dates = State.getPrevPeriodDates();
    const staff = State.getStaff();
    if (!dates.length) throw new Error('STEP1で期間を設定してください');
    const step5 = State.getStep5();
    const header = [CONSTANTS.STEP5_CSV_STAFF_COL || 'スタッフ名', ...dates.map(_dateLabel)];
    const rows = [header, ...staff.map(s => {
      const dayMap = step5[s.id] || {};
      return [s.name, ...dates.map(d => {
        const cell = dayMap[d];
        if (!cell || cell.state !== 'work') return '';
        return cell.hours || '';
      })];
    })];
    download(`前月シフト_${_today()}.csv`, rows);
  };

  // 前月シフトCSVインポート → { staffId: { date: { state, hours } } }
  const importStep5 = (text) => {
    const rows = decode(text);
    if (rows.length < 2) throw new Error('データが見つかりません');
    const header = rows[0];
    const dates  = header.slice(1).map(_parseHeaderDate); // 日付列
    const staff  = State.getStaff();
    const result = {};

    for (let i = 1; i < rows.length; i++) {
      const row      = rows[i];
      const staffName = row[0];
      const member   = staff.find(s => s.name === staffName);
      if (!member) continue;

      const dayMap = {};
      for (let j = 0; j < dates.length; j++) {
        const date = dates[j];
        if (!date) continue;
        const raw = (row[j + 1] || '').trim();
        if (!raw) { dayMap[date] = { state: 'off', hours: 0 }; continue; }

        // 書式: "出勤 9:00-17:00" or "出勤" or "08:00" or "休" など
        let state = 'work';
        let hours = member.dailyHours || CONSTANTS.DEFAULT_DAILY_HOURS;
        if (raw === '休' || raw === 'off') {
          state = 'off'; hours = 0;
        } else if (raw.includes(':')) {
          // 時間範囲 HH:MM-HH:MM
          const m = raw.match(/(\d{1,2}):(\d{2})\s*[-〜~]\s*(\d{1,2}):(\d{2})/);
          if (m) {
            const sh = parseInt(m[1]), sm = parseInt(m[2]);
            const eh = parseInt(m[3]), em = parseInt(m[4]);
            hours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
          }
        } else {
          hours = parseFloat(raw) || hours;
        }
        dayMap[date] = { state, hours };
      }
      result[member.id] = dayMap;
    }
    return result;
  };

  // ===== シフト表CSV出力（人閲覧用） =====
  const exportShiftResult = (plan) => {
    if (!plan) throw new Error('シフトデータがありません');
    const dates = State.getPeriodDates();
    const staff = State.getStaff();

    // ヘッダー行1: 日付, スタッフ1(区分), (空白), スタッフ2(区分), (空白)..., 日付
    const headerRow1 = ['日付'];
    staff.forEach(s => {
      const cat = CONSTANTS.CATEGORY_LABEL[s.category] || s.category;
      headerRow1.push(`${s.name}（${cat}）`);
      headerRow1.push(''); // h用
    });
    headerRow1.push('日付');

    // ヘッダー行2: (空白), 時間, h, 時間, h..., (空白)
    const headerRow2 = [''];
    staff.forEach(() => {
      headerRow2.push('時間');
      headerRow2.push('h');
    });
    headerRow2.push('');

    // データ行
    const dataRows = dates.map(d => {
      const lbl = _dateLabel(d);
      const row = [lbl];
      
      staff.forEach(s => {
        const c = plan.cells[s.id]?.[d];
        if (!c || c.state === 'off') {
          row.push(''); row.push('休');
        } else if (c.state === 'forcedOff') {
          row.push(''); row.push('強制休');
        } else if (c.state === 'paid') {
          row.push(''); row.push('有給');
        } else if (c.state === 'wishOff') {
          row.push(''); row.push('希望休');
        } else if (c.state === 'preferOff') {
          row.push(''); row.push('青（出勤可）');
        } else {
          // 出勤日
          const h = c.hours || 0;
          const timeStr = (c.workStart && c.workEnd) ? `${c.workStart}〜${c.workEnd}` : '';
          const hoursStr = `${h}h`;
          row.push(timeStr);
          row.push(hoursStr);
        }
      });
      row.push(lbl); // 右端にも日付を追加
      return row;
    });

    // 集計データ計算
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

    // 集計行
    const sumWorkDaysRow = ['出勤日数'];
    const sumRestDaysRow = ['休日数'];
    const sumTotalHRow   = ['合計時間'];
    const sumMonthRow    = ['月所定(差分)'];

    staff.forEach(s => {
      const totals = staffTotals[s.id];
      const eff = State.getEffectiveStaff(s.id);
      const max = eff?.monthlyHours || CONSTANTS.DEFAULT_MONTHLY_HOURS;
      const diff = totals.totalH - max;
      let diffStr = '±0';
      if (diff > 0.05) diffStr = `+${diff.toFixed(1)}`;
      else if (diff < -0.05) diffStr = `${diff.toFixed(1)}`;
      
      sumWorkDaysRow.push(`${totals.workDays}日`, '');
      sumRestDaysRow.push(`${totals.restDays}日`, '');
      sumTotalHRow.push(`${totals.totalH.toFixed(1)}h`, '');
      sumMonthRow.push(`${max}h (${diffStr})`, '');
    });

    sumWorkDaysRow.push('出勤日数');
    sumRestDaysRow.push('休日数');
    sumTotalHRow.push('合計時間');
    sumMonthRow.push('月所定(差分)');

    const rows = [
      headerRow1,
      headerRow2,
      ...dataRows,
      [], // 空行（表と集計行の区切り）
      sumWorkDaysRow,
      sumRestDaysRow,
      sumTotalHRow,
      sumMonthRow
    ];
    const lastDate = dates[dates.length - 1];
    const endDt = new Date(lastDate + 'T00:00:00');
    const endYear = endDt.getFullYear();
    const endMonth = endDt.getMonth() + 1;
    download(`${endYear}年${endMonth}月度勤務計画表.csv`, rows);
  };

  // ===== ユーティリティ =====

  const _today = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  };

  const _dateLabel = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth()+1}/${d.getDate()}(${CONSTANTS.WEEKDAY_SHORT[d.getDay()]})`;
  };

  // "5/12(月)" → "2026-05-12" に変換（年はSTEP1から補完）
  const _parseHeaderDate = (label) => {
    const m = label.match(/(\d+)\/(\d+)/);
    if (!m) return null;
    const s1    = State.getStep1();
    let   month = parseInt(m[1]);
    const day   = parseInt(m[2]);
    let   year  = s1.year;
    // 前月分のためmonthが現在月より大きい場合は前年扱い
    if (month > s1.month) year -= 1;
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  };

  return {
    encode, decode, download,
    exportStaff, importStaff,
    exportStep5, importStep5,
    exportShiftResult,
  };
})();
