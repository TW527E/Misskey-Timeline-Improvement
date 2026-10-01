# Misskey Timeline Improvement

像推特（X）一樣：在 [dvd.chat](https://dvd.chat) 這類 **Misskey / Sharkey** 社群網站點開一則貼文，再按「返回」，**時間線會回到你離開時的位置**。

這是一個 userscript（使用者腳本），裝在瀏覽器的 Tampermonkey / Violentmonkey 等擴充套件裡使用。

[English below](#english)

---

## 解決什麼問題

在 Misskey / Sharkey 上滑時間線、點開貼文再返回時，常常會遇到：

- **跳回最上面**：網頁預設只快取最近 3 個頁面。多點了幾則貼文或個人頁再返回，時間線就被整個重新載入，回到最新的貼文。
- **位置跑掉**：就算快取還在，內建的恢復也只是把某則貼文「置中」，不是你剛剛看的位置。
- **重新整理就沒了**：按了重新整理，或手機瀏覽器把背景分頁回收後，位置就不見了。
- **切換分頁就沒了**：在「首頁 / 本地 / 社交 / 全域…」之間切換再切回來，也會回到最上面。

## 功能

- ↩️ **返回 / 前進時回到原位**：同一則貼文、同一個像素位置。
- 🔄 **時間線被重建也找得回來**：自動幫你按「載入更多」，直到找到上次看的貼文。畫面下方會顯示進度，可以按「取消」，或直接滑動畫面就會停止。
- 🔁 **重新整理後也回到原位**（可在設定關閉）。
- 🗂️ **每個時間線分頁各自記住位置**（首頁、本地、社交、清單…）。
- 🔝 離開時在最上面 → 回來也停在最上面，新貼文照常出現。
- 🗑️ 上次看的貼文被刪除了 → 回到它下一則貼文的位置。
- 🔒 只讀寫網頁畫面與瀏覽紀錄，不會呼叫任何 Misskey API，也不會把資料傳到任何地方。紀錄只存在這個分頁的 `sessionStorage`。

## 安裝

1. 先在瀏覽器安裝 userscript 管理器（擇一）：
   - [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox / Safari）
   - [Violentmonkey](https://violentmonkey.github.io/)（Chrome / Edge / Firefox）
   - iPhone / iPad / Mac 的 Safari 可以用 [Userscripts](https://github.com/quoid/userscripts)
2. 點這個連結安裝腳本：
   **[misskey-timeline-improvement.user.js](https://raw.githubusercontent.com/TW527E/Misskey-Timeline-Improvement/main/misskey-timeline-improvement.user.js)**
   （管理器會跳出安裝畫面，按「安裝」即可）
3. 打開你的實例（例如 <https://dvd.chat>）並重新整理。

> **只想在特定網站執行？**
> 腳本預設會在所有網站載入，但只有偵測到 Misskey / Sharkey / CherryPick 時才會啟用，其他網站什麼都不做。
> 如果想限制範圍，可以在 Tampermonkey 的腳本「設定」→「使用者比對（User matches）」加上例如 `https://dvd.chat/*`，並取消勾選原本的比對規則。

## 支援的網站

| 軟體 | 版本 | 狀態 |
| --- | --- | --- |
| Sharkey | 2025.4 以後 | ✅ 已在 dvd.chat（Sharkey 2025.4.7）實測 |
| Misskey | 近期版本 | 🟡 已對照最新原始碼確認頁面結構相同，尚未在實際站台測試 |
| 更舊的版本 | — | ❌ 舊版前端沒有 `data-scroll-anchor`，腳本不會動作 |

電腦版的一般介面與手機版都可以用。Deck（多欄）模式下，欄位本來就不會被重新載入，所以腳本只處理主要頁面。

## 設定

在實例的頁面打開開發者工具的 Console（主控台），貼上下面這段並按 Enter，然後重新整理：

```js
localStorage.setItem('misskey-timeline-improvement:config', JSON.stringify({
  restoreOnReload: false, // 例：重新整理後不要回到原位
}));
```

| 設定 | 預設 | 說明 |
| --- | --- | --- |
| `restoreOnBack` | `true` | 返回 / 前進時回到原位 |
| `restoreOnReload` | `true` | 重新整理（或分頁被瀏覽器回收後重新開啟）時回到原位 |
| `restoreOnTabSwitch` | `true` | 每個時間線分頁各自記住位置 |
| `maxLoadPages` | `30` | 尋找上次的貼文時，最多按幾次「載入更多」 |
| `maxLoadPagesUnordered` | `5` | 同上，用於不是按時間排序的列表（例如推薦時間線） |
| `showToast` | `true` | 載入時在畫面下方顯示進度 |
| `debug` | `false` | 在 Console 印出運作紀錄 |

恢復預設值：`localStorage.removeItem('misskey-timeline-improvement:config')`

這些設定存在瀏覽器裡，所以更新腳本時不會被覆蓋。

## 小提醒

- **滑得很深再返回會比較久**：如果時間線已經被重建，需要重新載入舊貼文（每次約 30 則）。想要每次都瞬間回到原位，可以到「設定 → 環境設定」把 **「快取頁面數」** 調大（最多 10），快取還在的時候就不用重新載入。
- **推薦時間線**（例如 dvd.chat 的「推薦」）不是按時間排序、每次內容都不同。快取還在時可以正常回到原位；快取被清掉後通常找不到原本的貼文，最多試 5 頁就會停下並顯示「找不到上次的位置」。
- 載入時只要滑動畫面、點擊或按鍵，就會立刻停止，把畫面交還給你。

## 運作原理

Misskey / Sharkey 的時間線，每則貼文都帶有 `data-scroll-anchor="<貼文 ID>"` 屬性。

1. 你滑動時，腳本會記下畫面最上方是哪一則貼文、它距離頂端幾像素。紀錄依「瀏覽紀錄中的每一頁」和「每個分頁」分開保存在 `sessionStorage`。
2. 回到時間線時（返回、重新整理、切回分頁），找到那則貼文，捲動到完全相同的位置。
3. 如果時間線被重建、那則貼文還沒載入，就自動按「載入更多」直到它出現。Misskey 的 ID 依時間排序，所以如果已經載入到比它更舊的貼文（代表它被刪除了），就停在下一則。

## 開發

```sh
npm install
npm test        # 用 Playwright 在模擬的 Sharkey 頁面上跑測試
npm run check   # 語法檢查
```

測試用的模擬頁面在 [`test/fixtures/mock-misskey.html`](test/fixtures/mock-misskey.html)，重現了 Sharkey 2025.4 / Misskey 2025.x 的頁面結構（頁面快取、內建的置中恢復、非同步渲染的貼文等）。

問題回報與建議：[Issues](https://github.com/TW527E/Misskey-Timeline-Improvement/issues)

---

## English

A userscript that makes **Misskey / Sharkey** timelines (e.g. [dvd.chat](https://dvd.chat)) behave like Twitter/X: open a note, go back, and you're exactly where you left off.

- Returns to the same note at the same pixel offset on back / forward navigation.
- If the timeline was rebuilt (the page cache only keeps 3 pages by default), it presses "load more" for you until the note shows up. A small toast shows progress; scrolling or "Cancel" stops it.
- Also works after a reload, and remembers a separate position for each timeline tab.
- If you left from the top, you come back to the top. If the note was deleted, it lands on the next one.
- Touches only the DOM and the History API. It never calls the Misskey API. Positions are kept in this tab's `sessionStorage`.

**Install:** get [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) (or [Userscripts](https://github.com/quoid/userscripts) for Safari), then open [misskey-timeline-improvement.user.js](https://raw.githubusercontent.com/TW527E/Misskey-Timeline-Improvement/main/misskey-timeline-improvement.user.js).

**Compatibility:** Sharkey 2025.4+ (tested on dvd.chat, Sharkey 2025.4.7). Recent Misskey uses the same page structure (checked against the current source, not yet tested on a live instance). The script loads on every site but only activates on Misskey / Sharkey / CherryPick.

**Settings:** see the table above. Set them with `localStorage.setItem('misskey-timeline-improvement:config', JSON.stringify({ ... }))` in the console, then reload.

## License

[MIT](LICENSE)
