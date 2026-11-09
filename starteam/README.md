造勢物品管理系統 GitHub Pages + Firebase 修正版

修正盤點紀錄 quantity 為 undefined 導致 Firebase transaction failed 的問題。
移除每個物品重複的盤點公式說明。
所有「損壞/舊品」文字改為「損壞或舊品」。
盤點會更新應有數量與好壞數量，並依歷史取用／歸還淨額重算剩餘數量。

上傳 app.js 和 index.html 到 GitHub 的 starteam 資料夾即可，不需要重匯資料庫。
注意：歷史紀錄已清空時，未歸還數量會視為 0。
