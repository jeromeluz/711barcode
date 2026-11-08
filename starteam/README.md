# 造勢物品管理系統｜GitHub Pages + Firebase

本版新增「門市編輯」按鈕。可修改門市名稱，保留所有物品應有/剩餘數量與歷史紀錄；刪除採四道確認，資料封存於 `inventory/deletedStores`。

## 更新已上線網頁
將 `index.html`、`app.js` 上傳覆蓋 GitHub 專案的 `starteam/` 目錄。其他檔案不必修改。**不要重新匯入 initial-database.json**，否則可能覆蓋正式庫存。

## Firebase 規則
沿用現有 `inventory` 公開讀寫規則即可。免登入代表任何知道資料庫網址的人都可直接修改或刪除資料；四道確認只防止網頁誤按，不是資料庫安全防護。請定期從 Firebase 匯出備份。

## 刪除的行為
刪除門市後，使用中的 `stores` 清單、每項物品的 `stores` 鍵與 `history` 會移除該門市，並將庫存及歷史紀錄封存至 `inventory/deletedStores`。如需復原需從備份手動處理。

## 初始資料
`initial-database.json` 僅供全新空白資料庫初始化，包含順風、東億、敦和、御豪四間門市。

## 歸還超出應有數量
「應有數量」代表門市原本持有的道具數量。歸還後若剩餘超過應有數量，網頁會列出超出明細並要求兩次確認，確認後仍可歸還，並提示至「盤點庫存」修正實際數量。超量歸還會寫入歷史紀錄的 `overLimit` 欄位。Firebase transaction 會在寫入時再次檢查是否已確認，避免略過畫面確認。若應有數量未設定，無法判斷超量，請先確認資料。

更新只需覆蓋 GitHub `starteam/app.js`，不需要重新匯入資料庫。
