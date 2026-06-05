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
      imported.push({
        id:           State.generateId(),
        name:         r[0],
        category,
        monthlyHours: parseFloat(r[2]) || CONSTANTS.DEFAULT_MONTHLY_HOURS,
        dailyHours:   parseFloat(r[3]) || CONSTANTS.DEFAULT_DAILY_HOURS,
        hasBreak5h:   r[4] === '1',
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

  // サンプルCSV生成（前月7日分）
  const exportStep5Sample = () => {
    const dates = State.getPrevPeriodDates();
    const staff = State.getStaff();
    if (!dates.length) throw new Error('STEP1で期間を設定してください');

    const header = [CONSTANTS.STEP5_CSV_STAFF_COL, ...dates.map(_dateLabel)];
    const rows   = [header, ...staff.map(s => [s.name, ...dates.map(() => '')])];
    download(`前月シフト_サンプル_${_today()}.csv`, rows);
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
  const exportShiftResult = (plan, suffix = '') => {
    if (!plan) throw new Error('シフトデータがありません');
    const dates = State.getPeriodDates();
    const staff = State.getStaff();

    const headerRow1 = [
      'スタッフ名', '区分',
      ...dates.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return `${dt.getMonth()+1}/${dt.getDate()}`;
      }),
      '出勤日数', '総時間',
    ];
    const headerRow2 = [
      '', '',
      ...dates.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return CONSTANTS.WEEKDAY_SHORT[dt.getDay()];
      }),
      '', '',
    ];

    const dataRows = staff.map(s => {
      const cells = plan.cells[s.id] || {};
      let workDays = 0, totalHours = 0;
      const row = [
        s.name,
        CONSTANTS.CATEGORY_LABEL[s.category] || s.category,
        ...dates.map(d => {
          const c = cells[d];
          if (!c || c.state === 'off')       return '休';
          if (c.state === 'forcedOff')       return '強制休【最大人数超過】';
          if (c.state === 'paid')            return '有給';
          if (c.state === 'wishOff')         return '希望休';
          if (c.state === 'preferOff')       return '青（出勤可）';
          workDays++;
          totalHours += c.hours || 0;
          const shift = c.shiftType === 'early' ? '早番' : c.shiftType === 'late' ? '遅番' : '';
          return c.hours ? `${c.hours}h${shift ? ' ' + shift : ''}` : '出勤';
        }),
        workDays,
        totalHours.toFixed(1),
      ];
      return row;
    });

    const rows = [headerRow1, headerRow2, ...dataRows];
    const s1   = State.getStep1();
    download(`シフト表_${s1.year}年${s1.month}月${suffix}_${_today()}.csv`, rows);
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
    exportStep5Sample, importStep5,
    exportShiftResult,
  };
})();
