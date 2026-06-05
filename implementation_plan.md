# 週所定労働時間の廃止 + STEP3保存ボタン追加

## 概要

1. **週所定労働時間**を入力項目から廃止し、自動計算の表示項目に変更
2. **STEP3に「保存」ボタン**を追加し、上書き中/上書き済みのステート管理を導入
3. シフト生成時に未保存のSTEP3データを破棄する仕組みを実装

---

## 変更1: 週所定労働時間の廃止 → 自動計算表示

### 計算方法
- `月所定労働時間 ÷ 1日労働時間 ÷ 4 = 出勤日数/週`
- 小数点がある場合：`（目安）◯～◯日/週` と表示
  - 例: 75h ÷ 5h ÷ 4 = 3.75 → `（目安）3～4日/週`
- 割り切れる場合：`（目安）◯日/週`
  - 例: 160h ÷ 8h ÷ 4 = 5 → `（目安）5日/週`

### シフト生成への影響
- 旧: 週所定労働時間を参考にしていた部分
- 新: `（目安）◯日/週` で考える → ジェネレーターやバリデーターの週所定チェックを廃止

---

## 変更2: STEP3 保存ボタンの追加

### 状態遷移
```
参照元のまま → (値を変更) → 上書き中（未保存）→ (保存ボタン押下) → 上書き済み
```

- **上書き中**: 値が変更されているが、まだ保存されていない状態。`step3` state には反映されず `step3Draft` に一時保存。
- **上書き済み**: 保存ボタンを押すと `step3` state に確定保存される。タグが「上書き済み」に変わる。

### シフト生成時の動作
- 生成ボタンを押したとき、`step3Draft`（未保存データ）がある場合は**破棄**して、最後に保存された状態に戻す。
- 保存済みの `step3` のデータのみがシフト生成に使われる。

---

## Proposed Changes

### データモデル / 定数

#### [MODIFY] [constants.js](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/constants.js)
- `WEEKLY_HRS` ルールを削除
- `DEFAULT_WEEKLY_HOURS` を削除
- `STAFF_CSV_HEADER` から `'週所定(h)'` を削除

#### [MODIFY] [state.js](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/state.js)
- スタッフデータモデルから `weeklyHours` の記述を削除
- `getEffectiveStaff` から `weeklyHours` のマージを削除
- STEP3のドラフトステート管理を導入:
  - `ui.step3Draft` をSTEP3の未保存データの保持場所として明確化
  - `resetStep3Draft()` メソッド追加（全ドラフトを破棄）

---

### HTML

#### [MODIFY] [index.html](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/index.html)
- スタッフ登録フォーム: 週所定の入力欄 → 自動計算表示（`<span id="weeklyDaysDisplay">`）に変更
- スタッフ一覧テーブルのヘッダー: 「週所定（目安）」→ 「出勤目安/週」に変更
- STEP3テーブルのヘッダー: 「週所定労働時間（目安）」→ 「出勤目安/週」に変更
- STEP3セクション: 「STEP3を保存」ボタンを追加
- STEP5の説明文から「週所定超過防止」を削除
- フォームの注記: 「週所定 = 月所定 ÷ 4」の説明を新しい計算式に変更

---

### UI描画

#### [MODIFY] [ui.js](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/ui.js)
- スタッフテーブル:「週所定 ◯h 目安」→ `_formatWeeklyDays(monthly, daily)` で「◯～◯日/週」表示に変更
- スタッフフォームの fillStaffForm / clearStaffForm: `weeklyHours` 関連を削除
- STEP3テーブル:
  - 週所定の入力欄 → 自動計算の表示に変更
  - 「上書き中」→ ドラフト（未保存）の場合のみ表示
  - 「上書き済み」→ step3に確定データがある場合に表示
  - イベントハンドラ: 変更時は `step3Draft` に書き込む（step3 state には書き込まない）
- `_formatWeeklyDays(monthly, daily)` ヘルパー関数を追加

---

### イベント / アプリケーション

#### [MODIFY] [app.js](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/app.js)
- スタッフ登録:
  - `weeklyHours` の入力リスナー・保存を削除
  - 月所定 / 1日変更時に `weeklyDaysDisplay` を更新
- STEP3保存ボタンのイベントバインディング追加（`_bindStep3`）:
  - ボタン押下 → `step3Draft` の内容を `step3` に確定保存 → Storage保存 → 再描画
- `generateShift`:
  - 生成前に `step3Draft` がある場合は破棄（最後の保存状態に戻す）→ UI再描画

---

### バリデーション

#### [MODIFY] [validator.js](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/validator.js)
- `_checkHours` から週所定チェック（`WEEKLY_HRS`）を削除

---

### CSV

#### [MODIFY] [csv.js](file:///c:/Users/owner/Desktop/Shift-seiseisystem/shift-tool%20-%20%E3%82%B3%E3%83%94%E3%83%BC/shift-tool/csv.js)
- `exportStaff`: `weeklyHours` 列を削除
- `importStaff`: `weeklyHours` の読み取りを削除（CSV列のインデックスがずれるので注意）

---

## Open Questions

> [!IMPORTANT]
> STEP3で「上書き中」のまま別タブ（STEP1やSTEP2など）に移動した場合、上書き中のデータはどうしますか？
> - A. そのまま保持する（STEP3タブに戻れば編集を続けられる）
> - B. 別タブに移動した時点で破棄する
> 
> 現在の計画では **A（保持する）** として実装します。シフト生成時にのみ破棄します。

---

## Verification Plan

### 動作確認項目
1. スタッフ登録フォームで月所定と1日を入力 → 「出勤目安/週」が正しく自動計算・表示されるか
2. スタッフ一覧テーブルに「◯～◯日/週」が表示されるか
3. STEP3の値を変更 → 「上書き中」タグが表示されるか
4. STEP3保存ボタン押下 → 「上書き済み」タグに変わるか
5. STEP3で未保存のまま生成ボタン → 未保存データが破棄されるか
6. 週所定のバリデーションが消えているか
7. CSV出力/入力で週所定が含まれないか
