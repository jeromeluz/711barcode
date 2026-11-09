# 造勢物品管理系統（GitHub Pages + Firebase）

本版保留原有功能，並新增：
- 門市庫存只顯示「可借用」一欄（等同原本剩餘數量）
- 「已取用差額」改成「已取用」
- 人員編輯與門市編輯收進「⋯」選單
- 「匯出 Excel」：以目前選擇的門市匯出單一 XLSX 活頁簿，內含「門市物品庫存」「借用歸還紀錄」「盤點紀錄」三張工作表。匯出所有歷史紀錄，不受畫面 10 筆限制。

將 index.html 和 app.js 上傳覆蓋 GitHub 的 starteam/，保留原本 firebase-config.js。不需要重新匯入資料庫。

Excel 匯出使用瀏覽器載入 SheetJS CDN，匯出時需要網路連線。

提醒：Firebase 公開讀寫，請定期備份。
