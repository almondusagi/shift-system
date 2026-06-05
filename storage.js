/**
 * storage.js
 * localStorageへの保存・復元
 * JSON形式のみ。外部依存なし。
 */

const Storage = window.Storage = (() => {

  const KEYS = CONSTANTS.STORAGE_KEYS;

  // ===== 保存 =====
  const _save = (key, data) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn(`[Storage] 保存失敗 key=${key}`, e);
      return false;
    }
  };

  const _load = (key, fallback = null) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn(`[Storage] 読込失敗 key=${key}`, e);
      return fallback;
    }
  };

  // ===== 個別保存 =====
  const saveStaff   = ()  => _save(KEYS.STAFF,  State.getStaff());
  const saveStep1   = ()  => _save(KEYS.STEP1,  State.getStep1());
  const saveStep2   = ()  => _save(KEYS.STEP2,  State.getStep2());
  const saveStep3   = ()  => _save(KEYS.STEP3,  State.getStep3());
  const saveStep4   = ()  => _save(KEYS.STEP4,  State.getStep4());
  const saveStep5   = ()  => _save(KEYS.STEP5,  State.getStep5());
  const saveResult  = ()  => _save(KEYS.RESULT, State.getResult());
  const saveUI      = ()  => _save(KEYS.UI,     State.getUI());

  // まとめて保存
  const saveAll = () => {
    saveStaff(); saveStep1(); saveStep2(); saveStep3();
    saveStep4(); saveStep5(); saveResult(); saveUI();
  };

  // ===== 復元（起動時） =====
  const restoreAll = () => {
    const staff  = _load(KEYS.STAFF,  []);
    const step1  = _load(KEYS.STEP1,  null);
    const step2  = _load(KEYS.STEP2,  {});
    const step3  = _load(KEYS.STEP3,  {});
    const step4  = _load(KEYS.STEP4,  []);
    const step5  = _load(KEYS.STEP5,  {});
    const result = _load(KEYS.RESULT, null);
    const ui     = _load(KEYS.UI,     null);

    if (staff.length)  State.setStaff(staff);
    if (step1)         State.setStep1(step1);
    if (Object.keys(step2).length) {
      Object.entries(step2).forEach(([id, map]) => State.setStep2ForStaff(id, map));
    }
    if (Object.keys(step3).length) {
      Object.entries(step3).forEach(([id, data]) => State.setStep3ForStaff(id, data));
    }
    if (step4.length)  State.setStep4(step4);
    if (Object.keys(step5).length) State.setStep5(step5);
    if (result)        State.setResult(result);
    if (ui)            State.setUI(ui);
  };

  // ===== 全削除 =====
  const clearAll = () => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  };

  // ===== 自動保存（デバウンス） =====
  let _saveTimer = null;
  const autoSave = (callback) => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      saveAll();
      if (callback) callback();
    }, 800);
  };

  // ===== ストレージ使用量 =====
  const getUsage = () => {
    let total = 0;
    Object.values(KEYS).forEach(k => {
      const v = localStorage.getItem(k);
      if (v) total += v.length * 2; // UTF-16
    });
    return total;
  };

  const getUsageText = () => {
    const bytes = getUsage();
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return {
    saveStaff, saveStep1, saveStep2, saveStep3,
    saveStep4, saveStep5, saveResult, saveUI,
    saveAll, restoreAll, clearAll, autoSave,
    getUsage, getUsageText,
  };
})();
