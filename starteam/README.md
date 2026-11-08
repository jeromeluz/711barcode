# 造勢物品管理系統｜GitHub Pages + Firebase 免登入版

這是靜態網站，不需要 Node.js，不需要 Firebase Authentication 帳號密碼。所有知道網址的人都能查看、取用、歸還、盤點庫存與編輯人員。

## 上線步驟

1. 到 https://console.firebase.google.com/ 建立 Firebase 專案。
2. 到 Build → Realtime Database 建立資料庫。
3. 在 Realtime Database → Rules 貼上 `database.rules.json` 的完整內容並發布。**此規則允許所有人公開讀寫庫存，請確認可以接受此風險。**
4. 在 Realtime Database → Data 根節點選 Import JSON，匯入 `initial-database.json`。**只在首次初始化時匯入，否則會覆蓋庫存和紀錄。**
5. 在 Firebase Project settings → Your apps 新增 Web App，把提供的設定填入 `firebase-config.js`，其中 `databaseURL` 要使用你的 Realtime Database 網址。
6. 將 `index.html`、`app.js`、`firebase-config.js`、`.nojekyll` 上傳到 GitHub Repository 根目錄。
7. 到 Repository → Settings → Pages，選 Deploy from a branch，`main` 與 `/(root)`，儲存並等待發布。

## 保留功能

- 四門市與 13 種物品的應有、剩餘庫存
- 取用／歸還左右按鈕，多選物品、逐項填數量、一次送出
- 人員編輯、姓名下拉選單
- 盤點全部物品，保留姓名、時間、前後數量
- 取用與歸還紀錄、盤點紀錄分開，依日期分組且預設收合
- 手機版排版、即時同步、庫存不足阻止取用

## 重要提醒

**免登入代表資料庫公開讀寫。任何取得 Firebase 資料庫網址的人，也可能直接修改或刪除資料，並非只能透過網頁操作。姓名紀錄不具備身分驗證能力。** 不建議儲存敏感資料，並請定期到 Firebase Console 匯出 JSON 備份。

若你已經有 Firebase 資料，**不要重新匯入初始 JSON**，只需更新 GitHub 網頁檔與 Firebase 規則。原始 Excel 的御豪銅片應有數量未填，初始資料保留 null。
