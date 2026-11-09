# 中二區 造勢物品管理｜GitHub Pages + Firebase

將 `index.html`、`app.js`、`firebase-config.js` 上傳至 GitHub Pages 的 `starteam/` 目錄。保留現有 Firebase 資料，**不需重新匯入初始 JSON**。

## 更多（⋯）選單
- 人員編輯
- 門市編輯
- 匯出 Excel：目前門市三張工作表
- 備份 JSON：從 Firebase 取得最新 `inventory` 完整資料，下載 JSON
- 還原 JSON：選擇本系統備份 JSON，檢查格式、二次確認，先下載目前線上資料救援備份，再覆蓋 Firebase `inventory`

還原是**完整覆蓋**，包括所有門市、庫存、人員、歷史紀錄及封存資料。請在沒有其他夥伴操作時執行，避免覆蓋同時發生的更新。瀏覽器可能封鎖自動救援備份下載，還原前建議先手動按「備份 JSON」確認下載成功。

本系統採免登入公開讀寫，任何能開啟網頁的人都可還原或覆蓋資料，建議僅在可信環境使用並定期離線備份。
