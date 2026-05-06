export const DEFAULT_LANGUAGE = "zh";

export const messages = {
  zh: {
    bus: {
      eyebrow: "HK BUS ETA",
      title: "香港巴士到站頁面",
      subtitle:
        "保留原本 watchlist、搜尋路線、加入站點、JSON 編輯同即時 ETA refresh 功能，再用 idk-ui 重組成一個完整單頁介面。",
      liveTitle: "即時到站監察",
      liveDescription: "你已經加入 watchlist 嘅站會每 30 秒自動更新，亦可以手動即時 refresh。",
      addStop: "加入站點",
      closeSearch: "收起搜尋",
      syncing: "同步中",
      liveFeed: "即時更新中",
      refresh: "立即更新",
      nextBus: "下一班",
      next: "最快到站",
      etaNumber: "第 {{index}} 班",
      remove: "移除",
      routeSearch: "路線搜尋",
      routeSearchHelp: "輸入巴士號碼、起點、終點或者 routeId，展開公司清單後可以直接把某個 stop 加入 watchlist。",
      searchPlaceholder: "例如 A11、970X、Central、機場",
      searching: "搜尋中",
      ready: "可搜尋",
      searchPrompt: "開始輸入後，系統會即時掃描 route database。",
      searchLoading: "正在載入路線資料...",
      searchFound: "找到 {{count}} 條相關路線。",
      searchNotFound: "暫時搵唔到相關路線。",
      searchFailed: "路線搜尋失敗。",
      companyStops: "{{company}} 站點",
      stopSeq: "序號 {{seq}}: {{stopName}}",
      add: "加入",
      watchStorage: "Watchlist JSON",
      watchStorageHelp: "保留原本 JSON 編輯方式，方便你批量匯入、修改或者備份已儲存站點。",
      hideJson: "收起 JSON",
      editJson: "編輯 JSON",
      storageNote: "格式需為陣列，每項包含 label、routeId、seq。儲存後會同步更新本地 watchlist。",
      saveArray: "儲存 watchlist",
      dataSource: "資料來源",
      restrictedBody: "資料透過 hk-bus-eta 讀取。路線與 ETA 內容視乎原始資料源供應情況。",
      library: "使用套件",
      refreshEvery: "更新頻率",
      lastSync: "最後同步",
      every30s: "每 30 秒",
      invalidArray: "請輸入有效 JSON array。",
      invalidJson: "JSON 格式錯誤。",
      routeIdNotFound: "找不到對應 routeId，請檢查輸入資料。",
      unknownStop: "未知站點",
      fetchEtaFailed: "讀取 ETA 失敗。",
      unableLoadEta: "未能載入 ETA。",
      saveSuccess: "Watchlist 已儲存。",
      addSuccess: "站點已加入 watchlist。",
      addDuplicate: "相同 routeId 同 seq 已經存在於 watchlist。",
      removeSuccess: "站點已從 watchlist 移除。",
      watchDefault: "站點 {{index}}",
      itemValidation: "第 {{index}} 項資料必須包含 routeId 字串同 seq 數字。",
      now: "即將到站",
      minute: "{{count}} 分鐘",
      fromTo: "{{origin}} 往 {{destination}}",
      savedStops: "已存站點",
      storageHint: "localStorage 持久保存",
      autoRefresh: "自動刷新",
      refreshReady: "可手動刷新",
      saved: "已更新",
      duplicate: "已存在",
      noSavedBuses: "你未加入任何站點。可以用右邊搜尋區，或者直接透過 JSON 匯入 watchlist。",
    },
  },
};

export function translate(language, key, values = {}) {
  const locale = messages[language] ?? messages[DEFAULT_LANGUAGE];
  const fallback = messages[DEFAULT_LANGUAGE];
  const template =
    key.split(".").reduce((current, part) => current?.[part], locale) ??
    key.split(".").reduce((current, part) => current?.[part], fallback) ??
    key;

  return String(template).replace(/\{\{(\w+)\}\}/g, (_, token) => {
    const value = values[token];
    return value == null ? "" : String(value);
  });
}
