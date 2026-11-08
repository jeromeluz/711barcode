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


## 已設定 Firebase 專案
此版本已填入 starteam-a1367 的 Web App 設定。請在 Firebase Console 的 Realtime Database → Rules 貼上 database.rules.json 的內容並發布。首次使用時在 Data 頁面匯入 initial-database.json 到資料庫根節點（已有正式資料請勿覆蓋）。然後將本資料夾內檔案上傳 GitHub repository 根目錄並啟用 Pages。


## 連線中問題修正
此版修正 Firebase 不儲存空陣列造成 history / people 缺少時頁面無法渲染的問題。
若仍有錯誤，畫面狀態列會顯示詳細原因。
上傳 GitHub 時只需更新 `app.js` 和 `index.html`，**不要重新匯入 initial-database.json**，避免覆蓋正式資料。
建議使用 Ctrl+Shift+R 強制重新整理或手機無痕視窗測試。


## 門市更名修正
若在 Firebase 將 `inventory/stores` 的「大村村中」改為「順風」，但 `inventory/items/*/stores` 仍是舊名稱，新版會自動將每項物品的舊庫存鍵搬到「順風」，保留原有 expected / remaining 數值，不會重設庫存。
上傳 `app.js` 覆蓋 GitHub Pages 的 `starteam/app.js`，重新整理即可。第一次載入會使用 Firebase 交易修復資料。建議更新前在 Firebase Data 頁面匯出 JSON 備份。
