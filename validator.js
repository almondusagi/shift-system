/**
 * validator.js
 * 制約検証エンジン
 *
 * 検証結果フォーマット:
 * { type: 'HARD'|'SOFT', rule, target, date, staffId, message }
 */

const Validator = window.Validator = (() => {

  const { PRIORITY, RULE, MAX_CONSECUTIVE, SHIFT_STATE } = CONSTANTS;

  const validateAll = (plan, opts = {}) => {
    const { includeSoft = true } = opts;
    const violations = [];

    const staff  = State.getStaff();
    const dates  = State.getPeriodDates();
    const step1  = State.getStep1();
    const step2  = State.getStep2();
    const step4  = State.getStep4();

    if (!dates.length) return violations;

    // 1. STEP4例外違反
    violations.push(..._checkExceptions(plan, dates, staff, step4));
    // 2. 希望休・有給違反
    violations.push(..._checkWishOff(plan, dates, staff, step2));
    // 3. 最低人数
    violations.push(..._checkMinStaff(plan, dates, staff, step1, step4));
    // 4. 最大人数
    violations.push(..._checkMaxStaff(plan, dates, staff, step1, step4));
    // 5. 連勤
    violations.push(..._checkConsecutive(plan, dates, staff));
    // 6. 月所定
    violations.push(..._checkHours(plan, dates, staff));
    // 7. 最低休日数
    violations.push(..._checkRestDays(plan, dates, staff));
    // 8. 強制休みの通知（SOFT: 情報として表示）
    violations.push(..._checkForcedOff(plan, dates, staff));

    if (includeSoft) {
      // SOFT: なるべく休み
      violations.push(..._checkPreferOff(plan, dates, staff, step2));
      // SOFT: バランス
      violations.push(..._checkBalance(plan, dates, staff, step1));
    }

    return violations;
  };

  const validateCell = (plan, staffId, date) => {
    const all = validateAll(plan);
    return all.filter(v => v.staffId === staffId || v.date === date);
  };

  // ===== 内部チェック関数 =====

  const _checkExceptions = (plan, dates, staff, step4) => {
    const violations = [];
    for (const ex of step4) {
      for (const date of ex.dates) {
        if (!dates.includes(date)) continue;

        if (ex.workTimeChange) {
          const targets = _getTargetStaff(staff, ex.target, ex.targetStaffIds);
          for (const s of targets) {
            const cell = plan.cells[s.id]?.[date];
            if (!cell || cell.state !== SHIFT_STATE.WORK) continue;
            if (ex.workStart && ex.workEnd && cell.workStart && cell.workEnd) {
              if (cell.workStart !== ex.workStart || cell.workEnd !== ex.workEnd) {
                violations.push(_v('HARD', RULE.EXCEPTION, s.name, date,
                  `例外設定の勤務時間(${ex.workStart}〜${ex.workEnd})と一致しません`));
              }
            }
          }
        }

        if (ex.staffCountChange) {
          const dayStaff = _getWorkingStaff(plan, staff, date);
          const dayEmp   = dayStaff.filter(s => s.category === CONSTANTS.CATEGORY.EMPLOYEE);
          if (ex.minStaff    != null && dayStaff.length < ex.minStaff)
            violations.push(_v('HARD', RULE.EXCEPTION, null, date,
              `例外設定の最低人数(${ex.minStaff}人)を満たしていません（実際:${dayStaff.length}人）`));
          if (ex.minEmployee != null && dayEmp.length < ex.minEmployee)
            violations.push(_v('HARD', RULE.EXCEPTION, null, date,
              `例外設定の社員最低人数(${ex.minEmployee}人)を満たしていません（実際:${dayEmp.length}人）`));
          if (ex.maxStaff    != null && dayStaff.length > ex.maxStaff)
            violations.push(_v('HARD', RULE.EXCEPTION, null, date,
              `例外設定の最大人数(${ex.maxStaff}人)を超過しています（実際:${dayStaff.length}人）`));
        }
      }
    }
    return violations;
  };

  const _checkWishOff = (plan, dates, staff, step2) => {
    const violations = [];
    for (const s of staff) {
      const wishes = step2[s.id] || {};
      for (const [date, wishState] of Object.entries(wishes)) {
        if (!dates.includes(date)) continue;
        const cell = plan.cells[s.id]?.[date];
        if (!cell) continue;
        if (wishState === 'wishOff' && cell.state === SHIFT_STATE.WORK)
          violations.push(_v('HARD', RULE.WISH_OFF, s.name, date, `希望休が設定されているのに出勤になっています`));
        if (wishState === 'paid' && cell.state === SHIFT_STATE.WORK)
          violations.push(_v('HARD', RULE.PAID, s.name, date, `有給が設定されているのに出勤になっています`));
      }
    }
    return violations;
  };

  const _checkMinStaff = (plan, dates, staff, step1, step4) => {
    const violations = [];
    for (const date of dates) {
      const ex = _getExceptionForDate(step4, date);
      const minStaff    = ex?.staffCountChange && ex.minStaff    != null ? ex.minStaff    : step1.minStaff;
      const minEmployee = ex?.staffCountChange && ex.minEmployee != null ? ex.minEmployee : step1.minEmployee;

      const working    = _getWorkingStaff(plan, staff, date);
      const empWorking = working.filter(s => s.category === CONSTANTS.CATEGORY.EMPLOYEE);

      if (working.length < minStaff)
        violations.push(_v('HARD', RULE.MIN_STAFF, null, date,
          `最低出勤人数(${minStaff}人)を満たしていません（実際:${working.length}人）`));
      if (empWorking.length < minEmployee)
        violations.push(_v('HARD', RULE.MIN_EMPLOYEE, null, date,
          `社員の最低出勤人数(${minEmployee}人)を満たしていません（実際:${empWorking.length}人）`));
    }
    return violations;
  };

  const _checkMaxStaff = (plan, dates, staff, step1, step4) => {
    const violations = [];
    for (const date of dates) {
      const ex = _getExceptionForDate(step4, date);
      const maxStaff    = ex?.staffCountChange && ex.maxStaff    != null ? ex.maxStaff    : (step1.maxStaff    ?? null);
      const maxEmployee = ex?.staffCountChange && ex.maxEmployee != null ? ex.maxEmployee : (step1.maxEmployee ?? null);

      const working    = _getWorkingStaff(plan, staff, date);
      const empWorking = working.filter(s => s.category === CONSTANTS.CATEGORY.EMPLOYEE);

      if (maxStaff    != null && working.length > maxStaff)
        violations.push(_v('HARD', RULE.MAX_STAFF, null, date,
          `最大出勤人数(${maxStaff}人)を超過しています（実際:${working.length}人）`));
      if (maxEmployee != null && empWorking.length > maxEmployee)
        violations.push(_v('HARD', RULE.MAX_EMPLOYEE, null, date,
          `社員の最大出勤人数(${maxEmployee}人)を超過しています（実際:${empWorking.length}人）`));
    }
    return violations;
  };

  const _checkConsecutive = (plan, dates, staff) => {
    const violations = [];
    const step5     = State.getStep5();
    const prevDates = State.getPrevPeriodDates();

    for (const s of staff) {
      const allDates = [...prevDates, ...dates];
      let streak = 0;

      for (const date of allDates) {
        const isWork = _isWorking(plan, step5, s.id, date, prevDates);
        if (isWork) {
          streak++;
          if (streak > MAX_CONSECUTIVE && dates.includes(date)) {
            violations.push(_v('HARD', RULE.MAX_CONSEC, s.name, date,
              `${streak}連勤になっています（上限:${MAX_CONSECUTIVE}連勤）`));
          }
        } else {
          streak = 0;
        }
      }
    }
    return violations;
  };

  const _checkHours = (plan, dates, staff) => {
    const violations = [];
    for (const s of staff) {
      const eff = State.getEffectiveStaff(s.id);
      if (!eff) continue;

      let totalMonthly = 0;
      const weekTotals = {};

      for (const date of dates) {
        const cell = plan.cells[s.id]?.[date];
        if (!cell || (cell.state !== SHIFT_STATE.WORK && cell.state !== SHIFT_STATE.PAID)) continue;
        const h = cell.hours || eff.dailyHours || 0;
        totalMonthly += h;
        const weekKey = _getWeekKey(date);
        weekTotals[weekKey] = (weekTotals[weekKey] || 0) + h;
      }

      const maxMonthly = eff.monthlyHours || CONSTANTS.DEFAULT_MONTHLY_HOURS;
      if (totalMonthly > maxMonthly + 0.5)
        violations.push(_v('HARD', RULE.MONTHLY_HRS, s.name, null,
          `月所定(${maxMonthly}h)を超過しています（実際:${totalMonthly.toFixed(1)}h）`));
      if (Math.abs(totalMonthly - maxMonthly) > 0.5)
        violations.push(_v('SOFT', RULE.MONTHLY_HRS, s.name, null,
          `月所定(${maxMonthly}h)との差分があります（実際:${totalMonthly.toFixed(1)}h / 差:${(totalMonthly-maxMonthly).toFixed(1)}h）`));

    }
    return violations;
  };

  /** 最低休日数チェック（希望休含む・有給除く） */
  const _checkRestDays = (plan, dates, staff) => {
    const violations = [];
    for (const s of staff) {
      const minRest = s.minRestDays ?? CONSTANTS.DEFAULT_MIN_REST_DAYS;
      if (minRest <= 0) continue;

      const restDays = dates.filter(date => {
        const cell = plan.cells[s.id]?.[date];
        return cell && (
          cell.state === SHIFT_STATE.OFF      ||
          cell.state === SHIFT_STATE.WISH_OFF ||
          cell.state === SHIFT_STATE.PREFER_OFF ||
          cell.state === SHIFT_STATE.FORCED_OFF
        );
      }).length;

      if (restDays < minRest)
        violations.push(_v('HARD', RULE.REST_DAYS, s.name, null,
          `最低休日数(${minRest}日)を満たしていません（実際:${restDays}日）`));
    }
    return violations;
  };

  /** 強制休みの通知 */
  const _checkForcedOff = (plan, dates, staff) => {
    const violations = [];
    for (const s of staff) {
      for (const date of dates) {
        const cell = plan.cells[s.id]?.[date];
        if (cell?.forcedOff) {
          violations.push(_v('SOFT', RULE.FORCED_OFF, s.name, date,
            `最大出勤人数の制限により強制的に休みにしました`));
        }
      }
    }
    return violations;
  };

  const _checkPreferOff = (plan, dates, staff, step2) => {
    const violations = [];
    for (const s of staff) {
      const wishes = step2[s.id] || {};
      for (const [date, wishState] of Object.entries(wishes)) {
        if (!dates.includes(date) || wishState !== 'preferOff') continue;
        const cell = plan.cells[s.id]?.[date];
        if (cell && cell.state === SHIFT_STATE.WORK)
          violations.push(_v('SOFT', RULE.PREFER_OFF, s.name, date,
            `なるべく休み(青)が設定されていますが出勤になっています`));
      }
    }
    return violations;
  };

  const _checkBalance = (plan, dates, staff, step1) => {
    const violations = [];
    if (staff.length < 2) return violations;

    // 出勤日数のバランスチェック
    const workDays = staff.map(s => ({
      name: s.name,
      days: dates.filter(d => plan.cells[s.id]?.[d]?.state === SHIFT_STATE.WORK).length,
    }));
    const maxDays = Math.max(...workDays.map(x => x.days));
    const minDays = Math.min(...workDays.map(x => x.days));
    if (maxDays - minDays > 5) {
      const maxPerson = workDays.find(x => x.days === maxDays);
      violations.push(_v('SOFT', RULE.BALANCE, maxPerson?.name, null,
        `出勤日数に大きな偏りがあります（最多:${maxDays}日 / 最少:${minDays}日）`));
    }
    return violations;
  };

  // ===== ユーティリティ =====

  const _v = (type, rule, target, date, message) => ({
    type, rule,
    target: target || null,
    staffId: target ? (State.getStaff().find(s => s.name === target)?.id || null) : null,
    date:   date || null,
    message,
  });

  const _getWorkingStaff = (plan, staff, date) =>
    staff.filter(s => {
      const cell = plan.cells[s.id]?.[date];
      return cell && cell.state === SHIFT_STATE.WORK;
    });

  const _isWorking = (plan, step5, staffId, date, prevDates) => {
    if (prevDates.includes(date)) {
      const prev = step5[staffId]?.[date];
      return prev ? prev.state === 'work' : false;
    }
    const cell = plan.cells[staffId]?.[date];
    return cell ? cell.state === SHIFT_STATE.WORK : false;
  };

  const _getWeekKey = (dateStr) => {
    const d      = new Date(dateStr + 'T00:00:00');
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
  };

  const _getExceptionForDate = (step4, date) => step4.find(ex => ex.dates.includes(date)) || null;

  const _getTargetStaff = (staff, target, individualIds) => {
    if (target === 'all')        return staff;
    if (target === 'employee')   return staff.filter(s => s.category === CONSTANTS.CATEGORY.EMPLOYEE);
    if (target === 'community')  return staff.filter(s => s.category === CONSTANTS.CATEGORY.COMMUNITY);
    if (target === 'individual') return staff.filter(s => (individualIds || []).includes(s.id));
    return staff;
  };

  const summarize = (violations) => {
    const hard = violations.filter(v => v.type === 'HARD');
    const soft = violations.filter(v => v.type === 'SOFT');
    return {
      total: violations.length,
      hardCount: hard.length,
      softCount: soft.length,
      hasCritical: hard.length > 0,
      byRule:  _groupBy(violations, 'rule'),
      byStaff: _groupBy(violations, 'target'),
    };
  };

  const _groupBy = (arr, key) => {
    const result = {};
    for (const item of arr) {
      const k = item[key] || '（共通）';
      if (!result[k]) result[k] = [];
      result[k].push(item);
    }
    return result;
  };

  return { validateAll, validateCell, summarize };
})();
