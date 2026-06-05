/**
 * generator.js - シフト生成エンジン（新ロジック）
 *
 * ─────────────────────────────────────────────────────────────
 *  アルゴリズム概要
 * ─────────────────────────────────────────────────────────────
 *  STEP 1: STEP4例外設定を適用
 *    対象日付 × 対象者のシフトを「出勤（WORK）」としてロック。
 *    このロックは後から他のルールで上書きすることは不可能。
 *    ※ 対象日付でも選ばれていない人のシフトには適用されない。
 *
 *  STEP 2: 希望休（wishOff）・有給（paid）を適用
 *    STEP2で登録された希望休・有給をロック。
 *
 *  STEP 3: 休日をランダムに振り分け
 *    各スタッフの休日日数を算出（minRestDays と月所定逆算の大きい方）。
 *    ロック済み休日を差し引いた残りの休日を、ランダムに振り分ける。
 *    制約: 休日と休日の間隔は最大5日以内。
 *    例外設定でロックされた出勤日は「出勤日」として間隔計算に含める。
 *
 *  STEP 3.5: 連休制限
 *    週目安出勤日数に基づき連休の最大日数を制限する。
 *    - 週目安4日以下 → 最大3連休
 *    - 週目安4〜5日 → 最大3連休
 *    - 週目安5日以上 → 最大2連休
 *    超過する連休を検出したら、いずれかの休日を出勤に変え、
 *    別の出勤日を休日に変えて日数を維持する。
 *
 *  STEP 4: 出勤人数条件の調整
 *    STEP1で設定した全体出勤人数・社員出勤人数・早番人数・遅番人数を
 *    日付ごとにチェック。条件を満たさない場合は対象スタッフをランダムに
 *    選んで出勤/休日を変更。休日→出勤の場合は別の日をスワップして
 *    休日日数を維持。休日間隔5日以内制約を維持。希望休は対象外。
 *
 *  ※ 出勤時間の計算は試験段階のため省略。
 * ─────────────────────────────────────────────────────────────
 */
const Generator = window.Generator = (() => {

  const { SHIFT_STATE, CATEGORY, SHIFT_TYPE, MAX_CONSECUTIVE, DEFAULT_DAILY_HOURS } = CONSTANTS;

  // 調整の最大イテレーション数
  const MAX_ADJUST_ITERATIONS = 100;

  // ─── メイン API ─────────────────────────────────────────────

  const generate = () => {
    const staff = State.getStaff();
    const dates = State.getPeriodDates();

    if (!staff.length) throw new Error('スタッフが登録されていません');
    if (!dates.length) throw new Error('STEP1で期間を設定してください');

    const startMs   = Date.now();
    const step1     = State.getStep1();
    const step2     = State.getStep2();
    const step4Raw  = State.getStep4();
    const step4     = _resolveStep4(step4Raw, dates);
    const step5     = State.getStep5();
    const prevDates = State.getPrevPeriodDates();

    // ═══════════════════════════════════════════════════════════
    //  Phase 1: 各スタッフのベースパターン構築
    //  （例外設定 → 希望休 → 休日振り分け）
    // ═══════════════════════════════════════════════════════════
    const cells = {};

    for (const s of staff) {
      cells[s.id] = _buildStaffPattern(s, dates, step2, step4, step5, prevDates);
    }

    // 残った未定セルをWORKで埋める
    for (const s of staff) {
      for (const date of dates) {
        const cell = cells[s.id][date];
        if (cell.state === null) {
          cell.state = SHIFT_STATE.WORK;
          cell.hours = _getDailyHours(s);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    //  Phase 2: 出勤人数条件の調整
    //  （全体/社員の最低・最大、早番・遅番人数）
    // ═══════════════════════════════════════════════════════════
    const adjustLog = _adjustStaffingLevels(cells, staff, dates, step1, step4, step5, prevDates);

    // ═══════════════════════════════════════════════════════════
    //  Phase 3: 出勤人数調整後の連休制限再チェック
    // ═══════════════════════════════════════════════════════════
    let consecutiveRestFixes = 0;
    for (const s of staff) {
      const fixed = _enforceConsecutiveRestLimit(s, dates, cells[s.id], step5, prevDates);
      consecutiveRestFixes += fixed;
    }
    if (consecutiveRestFixes > 0) {
      adjustLog.push(`[調整] 連休制限の再調整: ${consecutiveRestFixes}件`);
    }

    const plan      = { cells, violations: [] };
    plan.violations = Validator.validateAll(plan);
    plan.score      = 0;

    const elapsed = Date.now() - startMs;

    const log = [
      `生成完了: ${dates[0]} 〜 ${dates[dates.length - 1]} (${dates.length}日間)`,
      `スタッフ: ${staff.length}人 / ${elapsed}ms`,
      ...adjustLog,
    ];

    // planA / planB 両方同じ（現段階では1案のみ）
    return { planA: plan, planB: plan, log };
  };

  // ═══════════════════════════════════════════════════════════
  //  Phase 1: スタッフ単体パターン構築
  // ═══════════════════════════════════════════════════════════

  const _buildStaffPattern = (s, dates, step2, step4, step5, prevDates) => {
    const wishes = step2[s.id] || {};
    const pattern = {};

    // ① 全日付を「未定（state: null）」で初期化
    for (const date of dates) {
      pattern[date] = {
        state:      null,       // 未定
        hours:      0,
        shiftType:  SHIFT_TYPE.NORMAL,
        workStart:  null,
        workEnd:    null,
        locked:     false,      // ロック = 後から変更不可
        exOverride: false,
        exBiz:      null,
        forcedOff:  false,
      };
    }

    // ② STEP4 例外設定を適用（対象日 × 対象者のみ → 出勤としてロック）
    for (const ex of step4) {
      if (!_isTargetedBy(s, ex)) continue;
      for (const date of (ex.dates || [])) {
        if (!dates.includes(date)) continue;
        const cell = pattern[date];
        cell.state     = SHIFT_STATE.WORK;
        cell.hours     = _getDailyHours(s);
        cell.locked    = true;
        cell.exOverride = true;
        // 勤務時間帯の変更がある場合はそれも記録
        if (ex.workTimeChange && ex.workStart && ex.workEnd) {
          cell.exBiz = { start: ex.workStart, end: ex.workEnd };
        }
      }
    }

    // ③ 希望休・有給を適用（ロック）
    //    ※ 例外設定でロック済みのセルは上書きしない
    for (const [date, state] of Object.entries(wishes)) {
      if (!dates.includes(date)) continue;
      const cell = pattern[date];
      if (cell.locked) continue;  // 例外設定ロック済み → スキップ

      if (state === 'wishOff') {
        cell.state     = SHIFT_STATE.WISH_OFF;
        cell.locked    = true;
        cell.hours     = 0;
        cell.workStart = null;
        cell.workEnd   = null;
      } else if (state === 'paid') {
        cell.state  = SHIFT_STATE.PAID;
        cell.locked = true;
        cell.hours  = _getDailyHours(s);
      }
    }

    // ④ 休日をランダムに振り分け
    _assignRestDays(s, dates, pattern, step5, prevDates);

    // ⑤ 連休制限の適用
    _enforceConsecutiveRestLimit(s, dates, pattern, step5, prevDates);

    return pattern;
  };

  // ═══════════════════════════════════════════════════════════
  //  Phase 2: 出勤人数条件の調整
  // ═══════════════════════════════════════════════════════════

  /**
   * 日付ごとに出勤人数条件をチェックし、条件を満たすまで調整する。
   *
   * 処理順:
   *  1. 全体最低出勤人数の不足 → 休日スタッフを出勤に変更（スワップ）
   *  2. 社員最低出勤人数の不足 → 休日の社員を出勤に変更（スワップ）
   *  3. 全体最大出勤人数の超過 → 出勤スタッフを休日に変更（スワップ）
   *  4. 社員最大出勤人数の超過 → 出勤の社員を休日に変更（スワップ）
   *  5. 早番人数の不足 → 出勤中の早番可能者に早番を割り当て
   *  6. 遅番人数の不足 → 出勤中の遅番可能者に遅番を割り当て
   *
   * 制約:
   *  - 希望休（wishOff）は対象外（変更しない）
   *  - 例外設定でロックされたセルは変更しない
   *  - 休日→出勤に変更する場合は、別の日を出勤→休日にスワップして日数維持
   *  - 休日間隔は常に5日以内を維持
   */
  const _adjustStaffingLevels = (cells, staff, dates, step1, step4, step5, prevDates) => {
    const log = [];
    let totalSwaps = 0;

    for (let iter = 0; iter < MAX_ADJUST_ITERATIONS; iter++) {
      let changed = false;

      for (const date of dates) {
        // この日に適用される出勤人数条件を取得（STEP4例外があればそちらを優先）
        const limits = _getDayLimits(date, step1, step4);

        // 現在の出勤状況を集計
        const working    = _getWorkingStaffIds(cells, staff, date);
        const workingEmp = working.filter(id => _isEmployee(staff, id));
        const earlyIds   = _getShiftTypeIds(cells, staff, date, SHIFT_TYPE.EARLY);
        const lateIds    = _getShiftTypeIds(cells, staff, date, SHIFT_TYPE.LATE);

        // ─── 1. 全体最低出勤人数チェック ──────────────────────
        if (limits.minStaff != null && working.length < limits.minStaff) {
          const need = limits.minStaff - working.length;
          const added = _addWorkersToDate(cells, staff, dates, date, need, null, step5, prevDates);
          if (added > 0) { changed = true; totalSwaps += added; }
        }

        // ─── 2. 社員最低出勤人数チェック ──────────────────────
        if (limits.minEmployee != null && workingEmp.length < limits.minEmployee) {
          const need = limits.minEmployee - workingEmp.length;
          const added = _addWorkersToDate(cells, staff, dates, date, need, CATEGORY.EMPLOYEE, step5, prevDates);
          if (added > 0) { changed = true; totalSwaps += added; }
        }

        // 出勤人数の再集計（変更後）
        const working2    = _getWorkingStaffIds(cells, staff, date);
        const workingEmp2 = working2.filter(id => _isEmployee(staff, id));

        // ─── 3. 全体最大出勤人数チェック ──────────────────────
        if (limits.maxStaff != null && working2.length > limits.maxStaff) {
          const excess = working2.length - limits.maxStaff;
          const removed = _removeWorkersFromDate(cells, staff, dates, date, excess, null, step5, prevDates);
          if (removed > 0) { changed = true; totalSwaps += removed; }
        }

        // ─── 4. 社員最大出勤人数チェック ──────────────────────
        if (limits.maxEmployee != null && workingEmp2.length > limits.maxEmployee) {
          const excess = workingEmp2.length - limits.maxEmployee;
          const removed = _removeWorkersFromDate(cells, staff, dates, date, excess, CATEGORY.EMPLOYEE, step5, prevDates);
          if (removed > 0) { changed = true; totalSwaps += removed; }
        }

        // 出勤人数の再集計（変更後）
        const working3 = _getWorkingStaffIds(cells, staff, date);

        // ─── 5. 早番人数チェック ──────────────────────────────
        if (limits.earlyMin != null && limits.earlyMin > 0) {
          const currentEarly = _getShiftTypeIds(cells, staff, date, SHIFT_TYPE.EARLY);
          if (currentEarly.length < limits.earlyMin) {
            const need = limits.earlyMin - currentEarly.length;
            const assigned = _assignShiftTypeToDate(cells, staff, date, working3, SHIFT_TYPE.EARLY, need, limits.earlyMax);
            if (assigned > 0) { changed = true; }
          }
        }

        // ─── 6. 遅番人数チェック ──────────────────────────────
        if (limits.lateMin != null && limits.lateMin > 0) {
          const currentLate = _getShiftTypeIds(cells, staff, date, SHIFT_TYPE.LATE);
          if (currentLate.length < limits.lateMin) {
            const need = limits.lateMin - currentLate.length;
            const assigned = _assignShiftTypeToDate(cells, staff, date, working3, SHIFT_TYPE.LATE, need, limits.lateMax);
            if (assigned > 0) { changed = true; }
          }
        }
      }

      if (!changed) break;
    }

    if (totalSwaps > 0) {
      log.push(`[調整] 出勤人数の調整を実施: ${totalSwaps}件のスワップ`);
    }

    return log;
  };

  /**
   * 指定日の出勤人数条件を取得
   * STEP4例外の staffCountChange があればそちらを優先
   */
  const _getDayLimits = (date, step1, step4) => {
    const ex = step4.find(e => (e.dates || []).includes(date) && e.staffCountChange);

    return {
      minStaff:    ex?.minStaff    ?? step1.minStaff    ?? null,
      maxStaff:    ex?.maxStaff    ?? step1.maxStaff    ?? null,
      minEmployee: ex?.minEmployee ?? step1.minEmployee ?? null,
      maxEmployee: ex?.maxEmployee ?? step1.maxEmployee ?? null,
      earlyMin:    ex?.earlyCountMin ?? step1.earlyCountMin ?? 0,
      earlyMax:    ex?.earlyCountMax ?? step1.earlyCountMax ?? null,
      lateMin:     ex?.lateCountMin  ?? step1.lateCountMin  ?? 0,
      lateMax:     ex?.lateCountMax  ?? step1.lateCountMax  ?? null,
    };
  };

  // ─── 出勤者の追加（休日→出勤スワップ） ───────────────────────

  /**
   * 指定日に出勤者を追加する。
   * 休日のスタッフから候補を選び、出勤に変更する。
   * その際、そのスタッフの別の出勤日を休日に変更して日数を維持する。
   *
   * @param {string|null} categoryFilter - 'employee' なら社員のみ、null なら全員
   * @returns {number} 実際に追加した人数
   */
  const _addWorkersToDate = (cells, staff, dates, date, count, categoryFilter, step5, prevDates) => {
    let added = 0;

    // 対象日に休日で、ロックされていないスタッフを候補とする
    const candidates = _shuffle(staff.filter(s => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      const cell = cells[s.id]?.[date];
      if (!cell) return false;
      // 休日（OFF）で、ロックされておらず、希望休でもない
      return cell.state === SHIFT_STATE.OFF && !cell.locked;
    }));

    for (const s of candidates) {
      if (added >= count) break;

      // この人の別の出勤日で、休日にスワップできる日を探す
      const swapDate = _findSwapDateWorkToOff(cells, s, dates, date, step5, prevDates);
      if (!swapDate) continue;  // スワップ先が見つからない場合はスキップ

      // スワップ実行: date を出勤に、swapDate を休日に
      _setWork(cells[s.id][date], s);
      _setOff(cells[s.id][swapDate]);
      added++;
    }

    return added;
  };

  // ─── 出勤者の削除（出勤→休日スワップ） ───────────────────────

  /**
   * 指定日から出勤者を減らす。
   * 出勤中のスタッフから候補を選び、休日に変更する。
   * その際、そのスタッフの別の休日を出勤に変更して日数を維持する。
   *
   * @param {string|null} categoryFilter - 'employee' なら社員のみ、null なら全員
   * @returns {number} 実際に減らした人数
   */
  const _removeWorkersFromDate = (cells, staff, dates, date, count, categoryFilter, step5, prevDates) => {
    let removed = 0;

    // 対象日に出勤で、ロックされていないスタッフを候補とする
    const candidates = _shuffle(staff.filter(s => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      const cell = cells[s.id]?.[date];
      if (!cell) return false;
      return cell.state === SHIFT_STATE.WORK && !cell.locked;
    }));

    for (const s of candidates) {
      if (removed >= count) break;

      // この人の別の休日で、出勤にスワップできる日を探す
      const swapDate = _findSwapDateOffToWork(cells, s, dates, date, step5, prevDates);
      if (!swapDate) continue;

      // スワップ実行: date を休日に、swapDate を出勤に
      _setOff(cells[s.id][date]);
      _setWork(cells[s.id][swapDate], s);
      removed++;
    }

    return removed;
  };

  // ─── 早番・遅番の割り当て ──────────────────────────────────────

  /**
   * 指定日の出勤者の中から早番/遅番を割り当てる
   *
   * @param {string[]} workingIds - 当日出勤中のスタッフIDリスト
   * @param {string} shiftType - SHIFT_TYPE.EARLY or SHIFT_TYPE.LATE
   * @param {number} need - 追加で必要な人数
   * @param {number|null} max - 最大人数（nullなら制限なし）
   * @returns {number} 実際に割り当てた人数
   */
  const _assignShiftTypeToDate = (cells, staff, date, workingIds, shiftType, need, max) => {
    let assigned = 0;

    // 対象の出勤者の中で、まだこの shiftType が割り当てられておらず、
    // 該当のシフトタイプが可能なスタッフを候補とする
    const eligible = shiftType === SHIFT_TYPE.EARLY
      ? staff.filter(s => State.canEarlyShift(s.id))
      : staff.filter(s => State.canLateShift(s.id));

    const candidates = _shuffle(eligible.filter(s => {
      if (!workingIds.includes(s.id)) return false;
      const cell = cells[s.id]?.[date];
      if (!cell) return false;
      return cell.state === SHIFT_STATE.WORK && cell.shiftType === SHIFT_TYPE.NORMAL;
    }));

    for (const s of candidates) {
      if (assigned >= need) break;
      // 最大人数チェック
      if (max != null) {
        const currentCount = _getShiftTypeIds(cells, staff, date, shiftType).length;
        if (currentCount >= max) break;
      }
      cells[s.id][date].shiftType = shiftType;
      assigned++;
    }

    // 対象者だけでは足りない場合：全出勤者から補填
    if (assigned < need) {
      const fallback = _shuffle(staff.filter(s => {
        if (!workingIds.includes(s.id)) return false;
        const cell = cells[s.id]?.[date];
        if (!cell) return false;
        return cell.state === SHIFT_STATE.WORK && cell.shiftType === SHIFT_TYPE.NORMAL;
      }));

      for (const s of fallback) {
        if (assigned >= need) break;
        if (max != null) {
          const currentCount = _getShiftTypeIds(cells, staff, date, shiftType).length;
          if (currentCount >= max) break;
        }
        cells[s.id][date].shiftType = shiftType;
        assigned++;
      }
    }

    return assigned;
  };

  // ─── スワップ先日付の探索 ──────────────────────────────────────

  /**
   * あるスタッフの出勤日の中で、休日にスワップ可能な日を探す
   * （指定日を休日→出勤にする時の対となるスワップ先）
   *
   * 条件:
   *  - ロックされていない出勤日
   *  - その日を休日にしても休日間隔5日以内制約を満たす
   *  - 指定日（date）以外
   */
  const _findSwapDateWorkToOff = (cells, s, dates, excludeDate, step5, prevDates) => {
    const pattern = cells[s.id];
    const candidates = _shuffle(
      dates.filter(d => {
        if (d === excludeDate) return false;
        const cell = pattern[d];
        return cell && cell.state === SHIFT_STATE.WORK && !cell.locked;
      })
    );

    for (const d of candidates) {
      // この日を休日にした場合、間隔制約が保たれるかチェック
      // また、excludeDate を出勤にした場合の間隔もチェック
      if (_canSwapToOff(pattern, dates, d, excludeDate, step5, s.id, prevDates)) {
        return d;
      }
    }

    return null;
  };

  /**
   * あるスタッフの休日の中で、出勤にスワップ可能な日を探す
   * （指定日を出勤→休日にする時の対となるスワップ先）
   *
   * 条件:
   *  - ロックされていない休日（OFF）、希望休は除外
   *  - その日を出勤にしても休日間隔5日以内制約を満たす
   *  - 指定日（date）以外
   */
  const _findSwapDateOffToWork = (cells, s, dates, excludeDate, step5, prevDates) => {
    const pattern = cells[s.id];
    const candidates = _shuffle(
      dates.filter(d => {
        if (d === excludeDate) return false;
        const cell = pattern[d];
        return cell && cell.state === SHIFT_STATE.OFF && !cell.locked;
      })
    );

    for (const d of candidates) {
      // この日を出勤にした場合 + excludeDate を休日にした場合の間隔チェック
      if (_canSwapToWork(pattern, dates, d, excludeDate, step5, s.id, prevDates)) {
        return d;
      }
    }

    return null;
  };

  // ─── 間隔制約チェック ──────────────────────────────────────────

  /**
   * dayToOff を休日に、dayToWork を出勤に変更した場合、
   * 休日間隔5日以内制約が保たれるかシミュレーションする
   */
  const _canSwapToOff = (pattern, dates, dayToOff, dayToWork, step5, staffId, prevDates) => {
    return _checkGapAfterSwap(pattern, dates, dayToOff, dayToWork, step5, staffId, prevDates);
  };

  const _canSwapToWork = (pattern, dates, dayToWork, dayToOff, step5, staffId, prevDates) => {
    return _checkGapAfterSwap(pattern, dates, dayToOff, dayToWork, step5, staffId, prevDates);
  };

  /**
   * dayToOff を休日に、dayToWork を出勤に変更した場合の
   * 連続出勤をシミュレーションし、5日以内に収まるかチェック
   */
  const _checkGapAfterSwap = (pattern, dates, dayToOff, dayToWork, step5, staffId, prevDates) => {
    const MAX_GAP = 5;

    // 前月末からの連続出勤ストリーク
    let streak = _getInitialStreak(step5, staffId, prevDates);

    for (const date of dates) {
      let isWork;

      if (date === dayToOff) {
        isWork = false;  // 休日にする
      } else if (date === dayToWork) {
        isWork = true;   // 出勤にする
      } else {
        const cell = pattern[date];
        isWork = _isWorkState(cell?.state);
      }

      if (isWork) {
        streak++;
        if (streak > MAX_GAP) return false;  // 5日超過 → NG
      } else {
        streak = 0;
      }
    }

    return true;
  };

  // ─── セル状態の設定ヘルパー ─────────────────────────────────────

  const _setWork = (cell, s) => {
    cell.state     = SHIFT_STATE.WORK;
    cell.hours     = _getDailyHours(s);
    cell.shiftType = SHIFT_TYPE.NORMAL;
    cell.workStart = null;
    cell.workEnd   = null;
  };

  const _setOff = (cell) => {
    cell.state     = SHIFT_STATE.OFF;
    cell.hours     = 0;
    cell.shiftType = SHIFT_TYPE.NORMAL;
    cell.workStart = null;
    cell.workEnd   = null;
  };

  // ─── 集計ヘルパー ─────────────────────────────────────────────

  /** 指定日に出勤しているスタッフIDのリスト */
  const _getWorkingStaffIds = (cells, staff, date) =>
    staff.filter(s => {
      const cell = cells[s.id]?.[date];
      return cell && _isWorkState(cell.state);
    }).map(s => s.id);

  /** 指定日に特定のシフトタイプが割り当てられたスタッフIDのリスト */
  const _getShiftTypeIds = (cells, staff, date, shiftType) =>
    staff.filter(s => {
      const cell = cells[s.id]?.[date];
      return cell && cell.state === SHIFT_STATE.WORK && cell.shiftType === shiftType;
    }).map(s => s.id);

  /** スタッフが社員かどうか */
  const _isEmployee = (staff, id) => {
    const s = staff.find(x => x.id === id);
    return s?.category === CATEGORY.EMPLOYEE;
  };

  /** 出勤状態かどうか（WORK or PAID） */
  const _isWorkState = (state) =>
    state === SHIFT_STATE.WORK || state === SHIFT_STATE.PAID;

  // ═══════════════════════════════════════════════════════════
  //  連休制限ロジック
  //  週目安出勤日数に基づき連続休日の最大日数を制限する
  // ═══════════════════════════════════════════════════════════

  /**
   * スタッフの週目安出勤日数を算出する
   * 計算式: 月所定労働時間 ÷ 1日労働時間 ÷ 4
   */
  const _getWeeklyTargetDays = (s) => {
    const eff = State.getEffectiveStaff(s.id);
    const monthly = eff?.monthlyHours || CONSTANTS.DEFAULT_MONTHLY_HOURS;
    const daily   = eff?.dailyHours   || DEFAULT_DAILY_HOURS;
    if (daily <= 0) return 5;
    return monthly / daily / 4;
  };

  /**
   * 週目安出勤日数から連休の最大日数を決定する
   * - 5日以上 → 最大2連休
   * - 4日以下（4〜5日含む） → 最大3連休
   */
  const _getMaxConsecutiveRest = (weeklyDays) => {
    if (weeklyDays >= 5) return 2;
    return 3;  // 4日以下 or 4〜5日
  };

  /**
   * 連休制限を強制する。
   * 連休が最大日数を超えている場合、超過分の休日を出勤に変更し、
   * 別の出勤日を休日に変更して日数を維持する。
   *
   * @returns {number} 修正したスワップ回数
   */
  const _enforceConsecutiveRestLimit = (s, dates, pattern, step5, prevDates) => {
    const weeklyDays = _getWeeklyTargetDays(s);
    const maxConsecRest = _getMaxConsecutiveRest(weeklyDays);
    let totalFixes = 0;

    for (let iter = 0; iter < 20; iter++) {
      // 連続休日のランを検出
      const runs = _findConsecutiveRestRuns(pattern, dates);
      const violations = runs.filter(r => r.length > maxConsecRest);

      if (violations.length === 0) break;

      let fixedThisIter = false;

      for (const run of violations) {
        // ランの中からロックされていない休日を見つけて出勤に変更
        const excess = run.length - maxConsecRest;
        let fixed = 0;

        // ランの中間部分から優先的に出勤に変更（端を残す）
        const sortedByMiddle = [...run].sort((a, b) => {
          const ai = dates.indexOf(a), bi = dates.indexOf(b);
          const mid = (dates.indexOf(run[0]) + dates.indexOf(run[run.length - 1])) / 2;
          return Math.abs(ai - mid) - Math.abs(bi - mid);
        });

        for (const date of sortedByMiddle) {
          if (fixed >= excess) break;
          const cell = pattern[date];
          if (cell.locked) continue;
          if (cell.state !== SHIFT_STATE.OFF) continue;

          // この休日を出勤に変更し、別の出勤日を休日にスワップ
          const swapDate = _findSwapDateForConsecFix(pattern, dates, date, s, step5, prevDates, maxConsecRest);
          if (!swapDate) continue;

          _setWork(cell, s);
          _setOff(pattern[swapDate]);
          fixed++;
          totalFixes++;
          fixedThisIter = true;
        }
      }

      if (!fixedThisIter) break;  // これ以上修正できない
    }

    return totalFixes;
  };

  /**
   * 連続休日のラン（連続して休日が続く区間）を検出する
   * @returns {string[][]} 連続休日の日付配列のリスト
   */
  const _findConsecutiveRestRuns = (pattern, dates) => {
    const runs = [];
    let currentRun = [];

    for (const date of dates) {
      const cell = pattern[date];
      const isRest = cell && (
        cell.state === SHIFT_STATE.OFF ||
        cell.state === SHIFT_STATE.WISH_OFF ||
        cell.state === SHIFT_STATE.PREFER_OFF ||
        cell.state === SHIFT_STATE.FORCED_OFF
      );

      if (isRest) {
        currentRun.push(date);
      } else {
        if (currentRun.length > 0) {
          runs.push([...currentRun]);
          currentRun = [];
        }
      }
    }
    if (currentRun.length > 0) {
      runs.push([...currentRun]);
    }

    return runs;
  };

  /**
   * 連休制限修正のためのスワップ先を探す。
   * 出勤日のうち、ロックされておらず、その日を休日にしても：
   *   - 5連勤制約を満たす
   *   - 新たな連休超過を生まない
   */
  const _findSwapDateForConsecFix = (pattern, dates, restToWork, s, step5, prevDates, maxConsecRest) => {
    const candidates = _shuffle(
      dates.filter(d => {
        if (d === restToWork) return false;
        const cell = pattern[d];
        return cell && cell.state === SHIFT_STATE.WORK && !cell.locked;
      })
    );

    for (const d of candidates) {
      // シミュレーション: restToWork を出勤、d を休日にした場合
      // 1. 5連勤制約チェック
      if (!_checkGapAfterSwap(pattern, dates, d, restToWork, step5, s.id, prevDates)) continue;

      // 2. 連休制限チェック: d を休日にした場合に新たな連休超過が発生しないか
      if (_wouldCreateExcessiveRest(pattern, dates, d, restToWork, maxConsecRest)) continue;

      return d;
    }

    return null;
  };

  /**
   * dayToOff を休日、dayToWork を出勤に変更した場合、
   * maxConsecRest を超える連休が新たに発生するかチェック
   */
  const _wouldCreateExcessiveRest = (pattern, dates, dayToOff, dayToWork, maxConsecRest) => {
    let consecRest = 0;

    for (const date of dates) {
      let isRest;
      if (date === dayToOff) {
        isRest = true;  // 休日にする
      } else if (date === dayToWork) {
        isRest = false;  // 出勤にする
      } else {
        const cell = pattern[date];
        isRest = cell && (
          cell.state === SHIFT_STATE.OFF ||
          cell.state === SHIFT_STATE.WISH_OFF ||
          cell.state === SHIFT_STATE.PREFER_OFF ||
          cell.state === SHIFT_STATE.FORCED_OFF
        );
      }

      if (isRest) {
        consecRest++;
        if (consecRest > maxConsecRest) return true;
      } else {
        consecRest = 0;
      }
    }

    return false;
  };

  // ═══════════════════════════════════════════════════════════
  //  休日振り分けロジック（Phase 1 で使用）
  // ═══════════════════════════════════════════════════════════

  const _assignRestDays = (s, dates, pattern, step5, prevDates) => {
    const eff = State.getEffectiveStaff(s.id);
    const dailyH   = eff?.dailyHours   || DEFAULT_DAILY_HOURS;
    const monthMax  = eff?.monthlyHours || CONSTANTS.DEFAULT_MONTHLY_HOURS;
    const minRest   = eff?.minRestDays  ?? CONSTANTS.DEFAULT_MIN_REST_DAYS;

    // 月所定から逆算した休日数
    const maxWorkDays     = Math.max(0, Math.floor((monthMax + 0.01) / dailyH));
    const restFromHours   = Math.max(0, dates.length - maxWorkDays);

    // 実際に使う休日数（大きい方を採用）
    const targetRestDays  = Math.max(minRest, restFromHours);

    // 既にロック済みの休日をカウント
    const lockedRestCount = dates.filter(d => {
      const cell = pattern[d];
      return cell.locked && cell.state === SHIFT_STATE.WISH_OFF;
    }).length;

    // 追加で必要な休日数
    const needRest = Math.max(0, targetRestDays - lockedRestCount);

    // ロックされていないセルの日付リスト
    const freeDates = dates.filter(d => !pattern[d].locked);

    if (needRest <= 0 || freeDates.length <= 0) return;

    // 前月末からの連続出勤ストリーク
    const initialStreak = _getInitialStreak(step5, s.id, prevDates);

    // 間隔制約を満たしつつランダムに休日を配置
    _distributeRestDays(pattern, dates, freeDates, needRest, initialStreak);
  };

  /**
   * 休日をランダムに振り分ける
   */
  const _distributeRestDays = (pattern, dates, freeDates, needRest, initialStreak) => {
    const MAX_GAP = 5;

    let restPlaced = 0;
    const restDates = new Set();

    // 既存の休日をrestDatesに追加
    for (const date of dates) {
      const cell = pattern[date];
      if (cell.state === SHIFT_STATE.WISH_OFF) {
        restDates.add(date);
      }
    }

    // Phase 1: 間隔制約に基づく必須休日の配置
    const mandatoryRestPositions = _findMandatoryRestPositions(
      pattern, dates, freeDates, initialStreak, MAX_GAP, restDates
    );

    for (const date of mandatoryRestPositions) {
      if (restPlaced >= needRest) break;
      if (pattern[date].locked) continue;
      pattern[date].state     = SHIFT_STATE.OFF;
      pattern[date].hours     = 0;
      pattern[date].workStart = null;
      pattern[date].workEnd   = null;
      restDates.add(date);
      restPlaced++;
    }

    // Phase 2: 残りの休日をランダム配置
    if (restPlaced < needRest) {
      const remainingFree = freeDates.filter(d =>
        !restDates.has(d) && pattern[d].state === null
      );
      _shuffle(remainingFree);

      for (const date of remainingFree) {
        if (restPlaced >= needRest) break;
        pattern[date].state     = SHIFT_STATE.OFF;
        pattern[date].hours     = 0;
        pattern[date].workStart = null;
        pattern[date].workEnd   = null;
        restDates.add(date);
        restPlaced++;
      }
    }

    // Phase 3: 間隔制約の最終チェック・修正
    _fixGapViolations(pattern, dates, freeDates, initialStreak, MAX_GAP, restDates);
  };

  const _findMandatoryRestPositions = (pattern, dates, freeDates, initialStreak, maxGap, restDates) => {
    const mandatory = [];
    const freeSet = new Set(freeDates);

    let streak = initialStreak;

    for (const date of dates) {
      const isRest = restDates.has(date);

      if (isRest) {
        streak = 0;
      } else {
        streak++;
        if (streak >= maxGap && freeSet.has(date) && !pattern[date].locked) {
          mandatory.push(date);
          streak = 0;
        }
      }
    }

    return mandatory;
  };

  const _fixGapViolations = (pattern, dates, freeDates, initialStreak, maxGap, restDates) => {
    const freeSet = new Set(freeDates);
    let changed = true;

    for (let iter = 0; iter < 10 && changed; iter++) {
      changed = false;
      let streak = initialStreak;

      for (const date of dates) {
        const cell = pattern[date];
        const isRest = (cell.state === SHIFT_STATE.OFF ||
                        cell.state === SHIFT_STATE.WISH_OFF ||
                        cell.state === SHIFT_STATE.FORCED_OFF);

        if (isRest) {
          streak = 0;
        } else {
          streak++;
          if (streak > maxGap) {
            const fixDate = _findNearestFreeDate(pattern, dates, date, freeSet, restDates);
            if (fixDate) {
              pattern[fixDate].state     = SHIFT_STATE.OFF;
              pattern[fixDate].hours     = 0;
              pattern[fixDate].workStart = null;
              pattern[fixDate].workEnd   = null;
              restDates.add(fixDate);
              changed = true;
              break;
            }
          }
        }
      }
    }
  };

  const _findNearestFreeDate = (pattern, dates, targetDate, freeSet, restDates) => {
    const targetIdx = dates.indexOf(targetDate);
    if (targetIdx < 0) return null;

    if (freeSet.has(targetDate) && !pattern[targetDate].locked &&
        pattern[targetDate].state !== SHIFT_STATE.OFF &&
        pattern[targetDate].state !== SHIFT_STATE.WISH_OFF) {
      return targetDate;
    }

    for (let offset = 1; offset <= 5; offset++) {
      const idx = targetIdx - offset;
      if (idx < 0) break;
      const d = dates[idx];
      if (freeSet.has(d) && !pattern[d].locked && !restDates.has(d) &&
          pattern[d].state !== SHIFT_STATE.OFF &&
          pattern[d].state !== SHIFT_STATE.WISH_OFF) {
        return d;
      }
    }

    for (let offset = 1; offset <= 5; offset++) {
      const idx = targetIdx + offset;
      if (idx >= dates.length) break;
      const d = dates[idx];
      if (freeSet.has(d) && !pattern[d].locked && !restDates.has(d) &&
          pattern[d].state !== SHIFT_STATE.OFF &&
          pattern[d].state !== SHIFT_STATE.WISH_OFF) {
        return d;
      }
    }

    return null;
  };

  // ─── ユーティリティ ─────────────────────────────────────────

  /** スタッフの1日の勤務時間を取得 */
  const _getDailyHours = (s) => {
    const eff = State.getEffectiveStaff(s.id);
    return eff?.dailyHours || DEFAULT_DAILY_HOURS;
  };

  /** スタッフが例外設定の対象かどうか判定 */
  const _isTargetedBy = (s, ex) => {
    if (ex.target === 'all')        return true;
    if (ex.target === 'employee')   return s.category === CATEGORY.EMPLOYEE;
    if (ex.target === 'community')  return s.category !== CATEGORY.EMPLOYEE;
    if (ex.target === 'individual') return (ex.targetStaffIds || []).includes(s.id);
    return true;
  };

  /** Fisher-Yates シャッフル */
  const _shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  /**
   * STEP4の「anyDays」を具体的な日付に解決する
   */
  const _resolveStep4 = (step4, dates) =>
    step4.map(ex => {
      if (!ex.anyDays || ex.anyDays <= 0) return ex;
      const n    = Math.min(ex.anyDays, dates.length);
      const step = dates.length / n;
      const selected = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.min(Math.round(i * step + step / 2), dates.length - 1);
        if (dates[idx]) selected.push(dates[idx]);
      }
      return { ...ex, dates: [...new Set(selected)], anyDays: 0 };
    });

  /** 前月末からの連続出勤ストリークを STEP5 から逆引き */
  const _getInitialStreak = (step5, staffId, prevDates) => {
    let streak = 0;
    for (let i = prevDates.length - 1; i >= 0; i--) {
      if (step5[staffId]?.[prevDates[i]]?.state === 'work') streak++;
      else break;
    }
    return streak;
  };

  return { generate };
})();
