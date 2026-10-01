# Misskey Timeline Improvement

像推特（X）一樣：在 [dvd.chat](https://dvd.chat) 這類 **Misskey / Sharkey** 社群網站，**時間線會記住你看到哪裡**。點開貼文再返回、重新整理、甚至關掉分頁明天再打開，都會回到上次離開的位置。

這是一個 userscript（使用者腳本），裝在瀏覽器的 Tampermonkey / Violentmonkey 等擴充套件裡使用。

[English below](#english)

---

## Misskey / Sharkey 內建的和這個腳本多做的

Misskey / Sharkey 本身就有「返回上一頁時回到原位」的功能：它會把最近幾個頁面留在記憶體裡（預設 3 頁），返回時直接拿出來。所以**點開一則貼文馬上按返回**，本來就大致會回到原位。

但內建的功能只在這種情況有效，下面這些情況就會跳回最上面或位置跑掉：

| 情況 | 內建 | 裝了腳本 |
| --- | --- | --- |
| 點開一則貼文，馬上返回 | 🟡 回到附近（把某則貼文「置中」，會偏掉一點） | ✅ 同一則貼文、同一個像素位置 |
| 點開貼文 → 再點進個人頁 → 再點其他貼文…，連續返回好幾頁 | ❌ 超過快取數量就被丟掉，回到最上面 | ✅ 自動載入舊貼文，找回原位 |
| 按重新整理、手機瀏覽器回收背景分頁 | ❌ 回到最上面 | ✅ 回到原位 |
| 在「首頁 / 本地 / 社交…」之間切換再切回來 | ❌ 回到最上面 | ✅ 每個分頁各自記住位置 |
| **關掉分頁，下次（例如隔天）再打開時間線** | ❌ 從最新的貼文開始 | ✅ **從上次看到的地方繼續** |
| 從別的頁面按側欄的「首頁」回到時間線 | 🟡 快取還在才會回去（置中，會偏一點） | 🟡 快取被清掉也會回到上次的位置；快取還在時沿用內建的恢復 |
| 「发现 / 探索」頁的推薦、精選 | 🟡 同上，快取還在才會回去 | 🟡 快取還在時精準回到原位；推薦內容每次重新載入都不同，快取被清掉後就從新的內容開始 |

## 功能

- 📖 **下次打開也從上次的地方繼續**：關掉分頁、隔天再打開時間線，會自動回到上次看到的貼文（同一台裝置、同一個帳號）。如果這段時間新貼文太多（要載入超過 10 頁約 300 則），就停在最新的貼文並提示你。
- ↩️ **返回 / 前進時回到原位**：同一則貼文、同一個像素位置。
- 🔄 **時間線被重建也找得回來**：自動幫你按「載入更多」，直到找到上次看的貼文。畫面下方會顯示進度，可以按「取消」，或直接滑動畫面就會停止。
- 🔁 **重新整理後也回到原位**（可在設定關閉）。
- 🗂️ **每個時間線分頁各自記住位置**（首頁、本地、社交、清單…）。
- 🧭 **「发现 / 探索」頁**（`/explore`，dvd.chat 的推薦流也在這裡）一樣會記住位置。
- 🔝 離開時在最上面 → 回來也停在最上面，新貼文照常出現。
- 🗑️ 上次看的貼文被刪除了 → 回到它下一則貼文的位置。
- 🔒 只讀寫網頁畫面與瀏覽紀錄，不會呼叫任何 Misskey API，也不會把資料傳到任何地方。紀錄只存在你自己的瀏覽器裡（`sessionStorage` 與 `localStorage`），內容只有貼文 ID 和捲動位置。

## 安裝

1. 先在瀏覽器安裝 userscript 管理器（擇一）：
   - [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox / Safari）
   - [Violentmonkey](https://violentmonkey.github.io/)（Chrome / Edge / Firefox）
   - iPhone / iPad / Mac 的 Safari 可以用 [Userscripts](https://github.com/quoid/userscripts)
2. 點這個連結安裝腳本：
   **[misskey-timeline-improvement.user.js](https://raw.githubusercontent.com/TW527E/Misskey-Timeline-Improvement/main/misskey-timeline-improvement.user.js)**
   （管理器會跳出安裝畫面，按「安裝」即可）
3. 打開你的實例（例如 <https://dvd.chat>）並重新整理。

### 預設會執行的網站

腳本只會在下面這些網站執行，不會注入其他網站：

| 網站 | 軟體 |
| --- | --- |
| [dvd.chat](https://dvd.chat) | Sharkey |
| [misskey.io](https://misskey.io) | Misskey |
| [misskey.design](https://misskey.design) | Misskey |
| [nijimiss.moe](https://nijimiss.moe) | Misskey |
| [sushi.ski](https://sushi.ski) | Misskey |
| [misskey.art](https://misskey.art) | Misskey |
| [voskey.icalo.net](https://voskey.icalo.net) | Misskey |
| [misskey.niri.la](https://misskey.niri.la) | Misskey |
| [misskey.cloud](https://misskey.cloud) | Misskey |
| [transfem.social](https://transfem.social) | Sharkey |
| [blahaj.zone](https://blahaj.zone) | Sharkey |

### 加入你自己的實例

清單裡沒有你用的站，可以自己加上去（不用改腳本，更新腳本時也不會被蓋掉）：

- **Tampermonkey**：打開腳本的編輯畫面 →「設定」分頁 → 在「使用者比對（User matches）」按「新增」，輸入例如 `https://your.instance/*`，然後儲存。
- **Violentmonkey**：打開腳本的編輯畫面 →「設定」分頁 → 在「@match 規則」加上例如 `https://your.instance/*`（保留原本的規則），然後儲存。

也歡迎開 [Issue](https://github.com/TW527E/Misskey-Timeline-Improvement/issues) 請我把常用的站加進預設清單。

## 支援的網站

| 軟體 | 版本 | 狀態 |
| --- | --- | --- |
| Sharkey | 2025.4 以後 | ✅ 已在 dvd.chat（Sharkey 2025.4.7）實測 |
| Misskey | 近期版本 | 🟡 已確認 misskey.io 和最新原始碼的頁面結構相同，尚未實際測試返回 |
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
| `restoreOnOpen` | `true` | 下次打開時間線（新分頁、隔天、按「首頁」）時，從上次的地方繼續 |
| `maxLoadPages` | `30` | 尋找上次的貼文時，最多按幾次「載入更多」 |
| `maxLoadPagesOnOpen` | `10` | 同上，用於「下次打開」的情況（距離上次可能已經有很多新貼文） |
| `maxLoadPagesUnordered` | `5` | 同上，用於不是按時間排序的列表（例如推薦時間線） |
| `showToast` | `true` | 載入時在畫面下方顯示進度 |
| `debug` | `false` | 在 Console 印出運作紀錄 |

恢復預設值：`localStorage.removeItem('misskey-timeline-improvement:config')`

這些設定存在瀏覽器裡，所以更新腳本時不會被覆蓋。

## 小提醒

- **滑得很深再返回會比較久**：如果時間線已經被重建，需要重新載入舊貼文（每次約 30 則）。想要每次都瞬間回到原位，可以到「設定 → 環境設定」把 **「快取頁面數」** 調大（最多 10），快取還在的時候就不用重新載入。
- **推薦、精選這類不按時間排序的列表**（例如 dvd.chat 時間線的 ✨ 分頁、「发现」頁）：快取還在、原本的貼文還在畫面上時，會精準回到原位。但這種列表每次重新載入內容都不一樣，快取被清掉之後就找不到原本的貼文了。這時腳本不會自動往下載入，也不會額外向伺服器要推薦內容，直接從新的內容開始。
- 載入時只要滑動畫面、點擊或按鍵，就會立刻停止，把畫面交還給你。
- 想直接看最新的貼文：在時間線上再點一次側欄的「首頁」就會捲到最上面，下次打開也會從最上面開始。
- 「下次打開」的位置是**每台裝置、每個帳號分開記**的，電腦和手機不會互相同步。
- 「下次打開」只用在時間線（首頁的各個分頁、清單、天線、頻道、发现頁），打開別人的個人頁不會跳到以前看過的位置。

## 運作原理

Misskey / Sharkey 的時間線，每則貼文都帶有 `data-scroll-anchor="<貼文 ID>"` 屬性。

1. 你滑動時，腳本會記下畫面最上方是哪一則貼文、它距離頂端幾像素。紀錄依「瀏覽紀錄中的每一頁」和「每個分頁」分開保存在 `sessionStorage`；每個時間線最後的位置另外存一份在 `localStorage`（依帳號分開），給「下次打開」用。
2. 回到時間線時（返回、重新整理、切回分頁、下次打開），找到那則貼文，捲動到完全相同的位置。
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

A userscript that makes **Misskey / Sharkey** timelines (e.g. [dvd.chat](https://dvd.chat)) remember where you were: go back from a note, reload, or close the tab and open the timeline again tomorrow, and you continue where you left off.

Misskey / Sharkey already keep the last few pages (3 by default) in memory, so going straight back from a note roughly works. They only center a note rather than keeping the exact spot, and you end up at the top once the page cache is evicted, after a reload, after switching timeline tabs, or when you open the timeline again later.

- Continues where you left off when you open a timeline again later (new tab, next day, Home button). Positions are kept per device and per account. If too many notes arrived since (more than 10 pages to load), it stays at the newest notes and tells you.
- Returns to the same note at the same pixel offset on back / forward navigation.
- If the timeline was rebuilt (the page cache only keeps 3 pages by default), it presses "load more" for you until the note shows up. A small toast shows progress; scrolling or "Cancel" stops it.
- Also works after a reload, and remembers a separate position for each timeline tab, including the Explore / Discover page.
- Feeds that aren't ordered by time (recommendations, featured notes) come back exactly while the page cache still has them. Once rebuilt they are different, so the script doesn't fetch more of them looking for the old spot.
- If you left from the top, you come back to the top. If the note was deleted, it lands on the next one.
- Touches only the DOM and the History API. It never calls the Misskey API. Positions (note IDs and scroll offsets) stay in your browser's `sessionStorage` / `localStorage`.

**Install:** get [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) (or [Userscripts](https://github.com/quoid/userscripts) for Safari), then open [misskey-timeline-improvement.user.js](https://raw.githubusercontent.com/TW527E/Misskey-Timeline-Improvement/main/misskey-timeline-improvement.user.js).

**Sites:** by default it runs only on dvd.chat, misskey.io, misskey.design, nijimiss.moe, sushi.ski, misskey.art, voskey.icalo.net, misskey.niri.la, misskey.cloud, transfem.social and blahaj.zone. To add your instance, add a user match such as `https://your.instance/*` in the script's settings in Tampermonkey / Violentmonkey (this survives script updates).

**Compatibility:** Sharkey 2025.4+ (tested on dvd.chat, Sharkey 2025.4.7). Recent Misskey uses the same page structure (checked on misskey.io and against the current source, back navigation not yet tested there).

**Settings:** see the table above. Set them with `localStorage.setItem('misskey-timeline-improvement:config', JSON.stringify({ ... }))` in the console, then reload.

## License

[MIT](LICENSE)
