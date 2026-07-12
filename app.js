const requiredClientModules = [
  ["MiraBoardSecurity", "frontend_security.js"],
  ["MiraBoardContracts", "frontend_contracts.js"],
  ["MiraBoardCache", "frontend_cache.js"],
  ["MiraBoardDataUtils", "data_utils.js"],
  ["MiraBoardMarkdown", "markdown_renderer.js"],
];
const missingClientModules = requiredClientModules.filter(([name]) => !globalThis[name]);

if (missingClientModules.length) {
  const body = document.body || document.documentElement;
  if (body) {
    body.innerHTML = "";
    const shell = document.createElement("div");
    shell.className = "app-shell";
    const main = document.createElement("main");
    main.className = "main-surface";
    main.style.minHeight = "100vh";
    main.style.display = "grid";
    main.style.placeItems = "center";
    const panel = document.createElement("section");
    panel.className = "empty-state";
    panel.style.maxWidth = "720px";
    panel.style.margin = "48px auto";
    panel.style.textAlign = "left";
    const title = document.createElement("h1");
    title.textContent = "资源加载失败";
    const message = document.createElement("p");
    message.textContent = `MiraBoard 的基础脚本未能完整加载：${missingClientModules.map(([, file]) => file).join("、")}。请刷新页面，或确认本地文件没有缺失。`;
    const hint = document.createElement("p");
    hint.textContent = "页面已保留本地提示，不会直接白屏。";
    panel.append(title, message, hint);
    main.append(panel);
    shell.append(main);
    body.append(shell);
  }
  throw new Error(`MiraBoard client modules missing: ${missingClientModules.map(([, file]) => file).join(", ")}`);
}

const { escapeHtml, safeExternalUrl } = globalThis.MiraBoardSecurity;
const { assertReadContract, assertOperationContract } = globalThis.MiraBoardContracts;
const { readSnapshot, writeSnapshot } = globalThis.MiraBoardCache;
const { parseCsv, csvNumberOrNull } = globalThis.MiraBoardDataUtils;
const { buildMemoSummaryMarkdown, renderMarkdownPreview } = globalThis.MiraBoardMarkdown;

const navItems = [
  ["overview", "研", "研究总览"],
  ["feed", "流", "信息流"],
  ["portfolio", "益", "投资收益"],
  ["library", "资", "资料库"],
  ["sources", "源", "数据源状态"],
  ["queue", "更", "更新队列"],
  ["settings", "设", "设置"],
];

const INDUSTRY_ANALYSIS_TARGETS = {
  "A股铝产业链": ["000807.SZ", "002128.SZ"],
  "化工行业": ["600096.SH", "600309.SH", "600989.SH"],
};
const INDUSTRY_ANALYSIS_ALL_EQUITIES = new Set(["行业贝塔反弹"]);

const objects = [
  { ticker: "600276.SH", name: "恒瑞医药", market: "A股", price: "待接入", change: "", trend: "反转尝试", state: "watch_only", stale: "needs_refresh", color: "blue" },
  { ticker: "000807.SZ", name: "云铝股份", market: "A股", price: "待接入", change: "", trend: "结构改善", state: "starter_only", stale: "fresh", color: "green" },
  { ticker: "00700.HK", name: "腾讯控股", market: "港股", price: "待接入", change: "", trend: "区间消化", state: "hold", stale: "fresh", color: "green" },
  { ticker: "600989.SH", name: "宝丰能源", market: "A股", price: "待接入", change: "", trend: "弱反弹/派发风险", state: "watch_only", stale: "stale", color: "amber" },
  { ticker: "600096.SH", name: "云天化", market: "A股", price: "待接入", change: "", trend: "接近失效位", state: "needs_refresh", stale: "stale", color: "red" },
  { ticker: "09992.HK", name: "泡泡玛特", market: "港股", price: "待接入", change: "", trend: "上行确认", state: "working_view", stale: "fresh", color: "green" },
];

const libraryDocs = [
  {
    id: "book-options",
    title: "期权投资策略（原书第5版）",
    type: "书籍 / PDF",
    path: "Mira/期权投资策略（原书第5版）.pdf",
    tags: ["期权", "风险管理", "策略"],
    summary: "用于 instrument strategy gate 的背景阅读。资料库只做预览和索引，不把书籍内容写入 Mira 结论。",
    outline: ["第 1 部分：期权基础与价格行为", "第 2 部分：波动率、希腊字母与风险", "第 3 部分：组合策略与情境使用"],
    category: "industry",
  },
  {
    id: "pharma-policy",
    title: "创新药政策与 FDA 风险观察",
    type: "行业资料 / Markdown",
    path: "private/research/600276.SH_恒瑞医药/policy-monitor-2026-06-23.md",
    tags: ["医药", "政策", "恒瑞"],
    summary: "记录政策信号、法律效力、公司 thesis 风险映射；可在恒瑞详情页作为相关资料显示。",
    outline: ["政策事件时间线", "对出海管线和 FDA 审批节奏的影响", "must_refresh_if 与证据缺口"],
    category: "industry",
  },
  {
    id: "aluminum-chain",
    title: "全球铝产业链研究笔记",
    type: "行业资料 / Markdown",
    path: "private/research/GLOBAL_ALUMINUM_铝/working-view.md",
    tags: ["有色", "铝", "周期"],
    summary: "用于云铝股份和铝产业链对象的上游资料预览，关注价格、成本、供给约束与利润传导。",
    outline: ["铝价与利润传导", "供给约束与水电铝成本", "A 股链条映射"],
    category: "industry",
  },
  {
    id: "coal-dashboard",
    title: "煤炭行业五年利润与供需框架",
    type: "行业资料 / CSV + MD",
    path: "private/research/COAL_煤炭/",
    tags: ["煤炭", "周期", "利润"],
    summary: "聚合煤炭行业利润、价格和政策变量，适合连接中煤能源、宝丰能源等对象。",
    outline: ["2022 高利润来源", "价格-成本-政策三变量", "行业 beta 监控项"],
    category: "industry",
  },
];

const deepReports = [
  {
    title: "investment-memo.md",
    type: "Mira 深度研究",
    path: "private/research/600276.SH_恒瑞医药/investment-memo.md",
    date: "2026-06-23",
    summary: "恒瑞当前保持 working_view：创新药出海与政策风险是核心变量，价格层面只能作为市场定价信号。",
  },
];

const objectLibraryFiles = [
  {
    title: "report-readout-国金证券-20260620.md",
    type: "研报解读",
    path: "private/research/600276.SH_恒瑞医药/report-readout-国金证券-20260620.md",
    date: "2026-06-20",
    summary: "拆解卖方报告中的收入、管线、估值和政策假设，并映射到 Mira evidence-log 与 claim map。",
  },
  {
    title: "policy-monitor-2026-06-23.md",
    type: "政策监控",
    path: "private/research/600276.SH_恒瑞医药/policy-monitor-2026-06-23.md",
    date: "2026-06-23",
    summary: "跟踪美国/FDA 相关政策信号，区分政策信号强度和法律约束力，更新 thesis 风险边界。",
  },
  {
    title: "H3_AP202606221823720809_1国金证券.pdf",
    type: "PDF 附件",
    path: "private/research/600276.SH_恒瑞医药/H3_AP202606221823720809_1国金证券.pdf",
    date: "2026-06-22",
    summary: "原始研报 PDF 附件。v1 原型展示元信息，后续接入 PDF 嵌入预览和页码定位。",
  },
];

const activity = [
  ["price", "股价行情已刷新", "technical-analysis-check.csv / evidence-log.csv appended", "2026-06-25 16:14"],
  ["news", "行业新闻扫描完成", "monitor-2026-06-25.md created; source freshness partial", "2026-06-25 16:10"],
  ["warn", "source_gap", "未发现发行人公告，新闻仅作事件发现", "2026-06-25 16:05"],
];

const bootstrapMeta = {};
let providerStatusData = { status: "unavailable", providers: {} };
let operationCatalogData = { status: "unavailable", operations: [] };
let marketCalendarData = null;
let marketCalendarPromise = null;
let portfolioPerformanceData = null;
let portfolioPositionReviewData = { status: "missing", reviews: [] };
let selectedObjectIndex = 0;
let researchSyncInFlight = false;
const sourcePreviewCache = new Map();
const quoteRequestInFlight = new Set();
const portfolioQuoteCache = new Map();
let overviewQuoteArchiveRows = [];
let overviewQuoteArchiveDate = "";
let overviewPriceHistoryRows = [];
let portfolioAutoRefreshPromise = null;
let portfolioAutoRefreshAttemptDate = "";
let marketSessionData = null;
let portfolioDailyProfitReady = false;
let portfolioDailyProfitSourceDate = "";
let pendingPreviewConfirmation = null;
let marketPulseData = { status: "unavailable", items: [], message: "金融市场数据尚未读取。" };
const researchFeedData = {
  held: { status: "idle", items: [] },
  watchlist: { status: "idle", items: [] },
};
let activeFeedScope = "held";
const HIDDEN_LIBRARY_KEY = "miraboard.hiddenMethodologyDocs.v1";
const PORTFOLIO_REFRESH_STATE_KEY = "miraboard.portfolioRefreshState.v1";
const APP_SNAPSHOT_CACHE_KEY = "miraboard.appSnapshot.v1";
const APP_SNAPSHOT_CACHE_VERSION = 1;

const portfolioPositions = [
  { account: "stock", code: "601898.SH", displayCode: "601898", name: "中煤能源", quantity: 30300, cost: 17.296, price: 12.510, marketValue: 379053.00, costBasis: 524083.64, profit: -145030.64, previousClose: null },
  { account: "stock", code: "002128.SZ", displayCode: "002128", name: "电投能源", quantity: 11100, cost: 29.603, price: 23.980, marketValue: 266178.00, costBasis: 328593.97, profit: -62415.97, previousClose: null },
  { account: "stock", code: "600276.SH", displayCode: "600276", name: "恒瑞医药", quantity: 6400, cost: 53.53320625, price: 57.040, marketValue: 365056.00, costBasis: 342612.52, profit: 22443.48, previousClose: 55.610, financing: true, financingPrincipal: 113812.52 },
  { account: "stock", code: "002714.SZ", displayCode: "002714", name: "牧原股份", quantity: 3000, cost: 38.83388333, price: 38.100, marketValue: 114300.00, costBasis: 116501.65, profit: -2201.65, previousClose: 37.110, financing: true, financingPrincipal: 116501.65 },
  { account: "stock", code: "159992.SZ", displayCode: "159992", name: "创新药", quantity: 318200, cost: 0.773, price: 0.753, marketValue: 239604.60, costBasis: 245993.20, profit: -6388.60, previousClose: null },
  { account: "option", code: "10011641", underlying: "588000", name: "沪-科创50购9月2100", optionType: "认购", quantity: 15, cost: 0.14085, price: 0.30790, marketValue: 46185.00, costBasis: 21127.50, profit: 25057.50, previousClose: 0.30620, multiplier: 10000 },
  { account: "option", code: "10011041", underlying: "588000", name: "沪-科创50沽9月1800", optionType: "认沽", quantity: 20, cost: 0.13665, price: 0.04930, marketValue: 9860.00, costBasis: 27330.00, profit: -17470.00, previousClose: 0.05500, multiplier: 10000 },
  { account: "option", code: "10011563", underlying: "588000", name: "沪-科创50沽9月1900", optionType: "认沽", quantity: 20, cost: 0.18345, price: 0.07250, marketValue: 14500.00, costBasis: 36690.00, profit: -22190.00, previousClose: 0.07830, multiplier: 10000 },
  { account: "option", code: "10011035", underlying: "588000", name: "沪-科创50沽9月1500", optionType: "认沽", quantity: 71, cost: 0.05219, price: 0.01330, marketValue: 9443.00, costBasis: 37052.83, profit: -27609.83, previousClose: 0.01530, multiplier: 10000 },
  { account: "option", code: "90007593", underlying: "159919", name: "深-沪深300ETF沽7月4800", optionType: "认沽", quantity: 40, cost: 0.00940, price: 0.00620, marketValue: 2480.00, costBasis: 3760.00, profit: -1280.00, previousClose: 0.00810, multiplier: 10000, quoteNote: "Greeks source_gap: Sina returned invalid IV/Delta/Gamma" },
];
const portfolioAccounts = {
  stock: { totalAssets: 1283826.38, marketValue: 1410786.40, cash: 0.00, profit: -146998.58, financingLiability: 226960.02, financingInterest: null },
  option: { totalAssets: 83039.53, marketValue: 82468.00, cash: 571.53, initialCapital: 100000.00, profit: -16960.47 },
};
const portfolioAdditionalCash = 100000.00;
const portfolioCash = portfolioAccounts.stock.cash + portfolioAccounts.option.cash + portfolioAdditionalCash;
const trackedEtfs = [
  { ticker: "588000.SH", name: "科创50ETF" },
  { ticker: "159992.SZ", name: "创新药ETF" },
];

async function loadBootstrap() {
  const sources = ["/api/read/bootstrap", "./data/bootstrap.json"];

  for (const source of sources) {
    try {
      const response = await fetchWithTimeout(source, { cache: "no-store" }, 5000);
      if (!response.ok) continue;
      const rawData = await response.json();
      const data = source.startsWith("/api/") ? assertReadContract(rawData, "bootstrap") : rawData;
      replaceArray(navItems, data.navItems);
      replaceArray(objects, data.objects);
      replaceLibraryDocs(data.libraryDocs);
      replaceArray(deepReports, data.deepReports);
      replaceArray(objectLibraryFiles, data.objectLibraryFiles);
      replaceArray(activity, data.activity);
      Object.assign(bootstrapMeta, data.meta || {}, { loadedFrom: source, apiConnected: source.startsWith("/api/") });
      integrateIndustryAnalysisObjects();
      ensurePortfolioHoldingsInObjects();
      return;
    } catch (error) {
      Object.assign(bootstrapMeta, { loadWarning: error.message });
    }
  }

  Object.assign(bootstrapMeta, { loadedFrom: "embedded-fallback", apiConnected: false });
  integrateIndustryAnalysisObjects();
  ensurePortfolioHoldingsInObjects();
}

function integrateIndustryAnalysisObjects() {
  const industryObjects = objects.filter(object => object.market === "行业分析");
  const equityObjects = objects.filter(object => ["A股", "港股", "美股", "ETF"].includes(object.market));
  industryObjects.forEach(industryObject => {
    const targetTickers = INDUSTRY_ANALYSIS_ALL_EQUITIES.has(industryObject.name)
      ? new Set(equityObjects.map(object => String(object.ticker || "").toUpperCase()))
      : new Set(INDUSTRY_ANALYSIS_TARGETS[industryObject.name] || []);
    equityObjects.forEach(target => {
      if (!targetTickers.has(String(target.ticker || "").toUpperCase())) return;
      const existing = new Set((target.industryFiles || []).map(file => file.path));
      const linked = (industryObject.files || [])
        .filter(file => file.path && !existing.has(file.path))
        .map(file => ({
          ...file,
          category: "industry_analysis",
          industryAnalysis: industryObject.name,
          summary: file.summary || `关联行业分析：${industryObject.name}`,
        }));
      target.industryFiles = [...(target.industryFiles || []), ...linked];
    });
  });
  objects.splice(0, objects.length, ...objects.filter(object => object.market !== "行业分析"));
  navItems.splice(0, navItems.length, ...navItems.filter(item => item[0] !== "industry"));
}

async function loadMarketCalendar() {
  if (marketCalendarPromise) return marketCalendarPromise;
  marketCalendarPromise = (async () => {
    const sources = ["/api/read/market-calendar", "./data/a-share-market-calendar.json"];
    for (const source of sources) {
      try {
        const response = await fetchWithTimeout(source, { cache: "no-store" }, 5000);
        if (!response.ok) continue;
        const rawData = await response.json();
        marketCalendarData = source.startsWith("/api/")
          ? assertReadContract(rawData, "market-calendar")
          : rawData;
        return marketCalendarData;
      } catch {
        // Continue to the offline copy. Unknown calendars must remain explicit.
      }
    }
    marketCalendarData = { status: "missing", years: {} };
    return marketCalendarData;
  })();
  return marketCalendarPromise;
}

async function loadMarketSession() {
  try {
    marketSessionData = assertReadContract(
      await fetchJsonWithTimeout("/api/read/market-session", {}, 5000),
      "market-session",
    );
  } catch {
    await loadMarketCalendar();
    marketSessionData = buildLocalMarketSessionFallback();
  }
  return marketSessionData;
}

function beijingDateParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short",
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function beijingDateIso(date = new Date()) {
  const parts = beijingDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatBeijingTime(date = new Date(), includeDate = true) {
  const parts = beijingDateParts(date);
  const time = `${parts.hour}:${parts.minute}`;
  return includeDate ? `${parts.year}-${parts.month}-${parts.day} ${time}` : time;
}

function buildLocalMarketSessionFallback(now = new Date()) {
  const parts = beijingDateParts(now);
  const marketDate = `${parts.year}-${parts.month}-${parts.day}`;
  const holidayRanges = Array.isArray(marketCalendarData?.years?.[parts.year])
    ? marketCalendarData.years[parts.year]
    : [];
  const calendarKnown = holidayRanges.length > 0;
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const isHoliday = holidayRanges.some(([start, end]) => marketDate >= start && marketDate <= end);
  const isTradingDay = calendarKnown && !isWeekend && !isHoliday;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const phase = !calendarKnown ? "calendar_unknown"
    : !isTradingDay ? "closed_day"
      : minutes < 9 * 60 + 15 ? "pre_open"
        : minutes < 15 * 60 ? "trading" : "closed";
  const messages = {
    calendar_unknown: "A股交易日历尚未配置，已跳过自动刷新",
    closed_day: "A股今日休市，已跳过自动刷新",
    pre_open: "A股尚未开盘，已跳过自动刷新",
    trading: "A股交易时段",
    closed: "A股已收盘",
  };
  const expectedQuoteDate = isTradingDay && ["trading", "closed"].includes(phase)
    ? marketDate
    : previousLocalAShareTradingDate(marketDate, holidayRanges);
  return {
    status: "fallback",
    market: "A股",
    marketDate,
    calendarKnown,
    isTradingDay,
    phase,
    expectedQuoteDate,
    autoRefreshAllowed: isTradingDay && phase === "closed",
    archiveAllowed: calendarKnown && phase !== "trading" && phase !== "calendar_unknown" && Boolean(expectedQuoteDate),
    message: messages[phase],
  };
}

function previousLocalAShareTradingDate(marketDate, holidayRanges) {
  const cursor = new Date(`${marketDate}T00:00:00Z`);
  for (let offset = 0; offset < 370; offset += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidate = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    const isHoliday = holidayRanges.some(([start, end]) => candidate >= start && candidate <= end);
    if (weekday !== 0 && weekday !== 6 && !isHoliday) return candidate;
  }
  return "";
}

async function loadProviderStatus() {
  try {
    providerStatusData = await fetchReadJson("/api/read/provider-status", "provider-status");
  } catch (error) {
    providerStatusData = { status: "unavailable", message: error.message, providers: {} };
  }
}

async function loadMarketPulse() {
  try {
    marketPulseData = await fetchReadJson("/api/read/market-pulse", "market-pulse");
  } catch (error) {
    marketPulseData = { status: "unavailable", items: [], message: `金融市场数据不可用：${error.message}` };
  }
  return marketPulseData;
}

function holdingFeedSymbols() {
  const symbols = new Set();
  portfolioPositions.forEach(position => {
    const code = position.account === "option" ? position.underlying : position.code;
    const normalized = normalizePortfolioCode(code, "stock");
    if (normalized) symbols.add(normalized);
  });
  return [...symbols];
}

function watchlistFeedSymbols() {
  const holdings = new Set(holdingFeedSymbols());
  return objects
    .map(object => String(object.ticker || "").trim().toUpperCase())
    .filter(symbol => symbol && !holdings.has(symbol))
    .slice(0, 12);
}

async function loadResearchFeed(scope = activeFeedScope) {
  const symbols = scope === "held" ? holdingFeedSymbols() : watchlistFeedSymbols();
  if (!symbols.length) {
    researchFeedData[scope] = { status: "source_gap", items: [], message: "当前范围没有可用于行业新闻关联的标的。" };
    renderResearchFeed();
    return researchFeedData[scope];
  }
  researchFeedData[scope] = { status: "loading", items: [], message: "正在读取关联行业新闻…" };
  renderResearchFeed();
  try {
    researchFeedData[scope] = await fetchReadJson(`/api/read/research-feed?symbols=${encodeURIComponent(symbols.join(","))}`, "research-feed");
  } catch (error) {
    researchFeedData[scope] = { status: "unavailable", items: [], message: `行业新闻不可用：${error.message}` };
  }
  renderResearchFeed();
  return researchFeedData[scope];
}

async function loadPositionReviews() {
  try {
    portfolioPositionReviewData = await fetchReadJson("/api/read/position-reviews", "position-reviews");
  } catch (error) {
    portfolioPositionReviewData = { status: "missing", message: error.message, reviews: [] };
  }
}

async function loadOperationCatalog() {
  try {
    operationCatalogData = await fetchReadJson("/api/read/operations", "operations-catalog");
  } catch (error) {
    operationCatalogData = { status: "unavailable", message: error.message, operations: [] };
  }
  return operationCatalogData;
}

async function syncResearchObjects() {
  if (researchSyncInFlight) return false;
  researchSyncInFlight = true;
  try {
    const payload = await fetchReadJson("/api/read/bootstrap", "bootstrap");
    if (!Array.isArray(payload.objects)) return false;

    const selected = getSelectedObject();
    const selectedKey = selected.path || selected.ticker || "";
    const runtimeByKey = new Map(objects.map(object => [object.path || object.ticker || "", object]));
    const nextObjects = payload.objects.map(object => {
      const previous = runtimeByKey.get(object.path || object.ticker || "");
      return previous ? {
        ...object,
        quote: previous.quote,
      } : object;
    });
    replaceArray(objects, nextObjects);
    replaceLibraryDocs(payload.libraryDocs);
    replaceArray(deepReports, payload.deepReports);
    replaceArray(objectLibraryFiles, payload.objectLibraryFiles);
    replaceArray(activity, payload.activity);
    Object.assign(bootstrapMeta, payload.meta || {}, { loadedFrom: "/api/read/bootstrap", apiConnected: true });
    ensurePortfolioHoldingsInObjects();

    const nextSelectedIndex = objects.findIndex(object => (object.path || object.ticker || "") === selectedKey);
    selectedObjectIndex = nextSelectedIndex >= 0 ? nextSelectedIndex : Math.min(selectedObjectIndex, Math.max(0, objects.length - 1));
    renderMetrics();
    renderCards(getActiveOverviewFilter());
    renderRadar();
    renderRadarFocus();
    renderTargets(getActiveTargetFilter());
    renderLibrary();
    renderLibraryFilters();
    renderLibraryCategoryFilters();
    renderSourceStatus();
    if (document.getElementById("industryView")?.classList.contains("active")) renderIndustryView();
    if (document.getElementById("sourcesView")?.classList.contains("active")) renderSourceStatusView();
    if (document.getElementById("detailView")?.classList.contains("active")) {
      renderDetailShell();
      renderReader(getActiveMemoTab());
    }
    persistAppSnapshot("data_source_refresh");
    return true;
  } catch {
    return false;
  } finally {
    researchSyncInFlight = false;
  }
}

async function loadPortfolioPerformance() {
  try {
    const responses = await Promise.all([
      fetchWithTimeout("./data/portfolio-daily.csv", { cache: "no-store" }, 5000),
      fetchWithTimeout("./data/portfolio-transactions.csv", { cache: "no-store" }, 5000),
      fetchWithTimeout("./data/portfolio-daily-positions.csv", { cache: "no-store" }, 5000),
    ]);
    if (!responses.every(response => response.ok)) throw new Error("portfolio CSV missing");
    const dailyRows = parseCsv(await responses[0].text());
    const transactionRows = parseCsv(await responses[1].text());
    const positionRows = parseCsv(await responses[2].text());
    const series = dailyRows.filter(row => row.account === "stock").map(row => ({
      date: row.date, value: Number(row.total_assets), twrIndex: Number(row.twr_index),
      dailyReturn: row.daily_return_pct === "" ? null : Number(row.daily_return_pct),
      externalFlow: Number(row.external_flow || 0), activeHoldings: Number(row.active_holdings || 0),
      estimate: row.data_status === "complete" ? "daily_csv_archive" : "historical_estimate",
    })).sort((a, b) => a.date.localeCompare(b.date));
    const transactions = transactionRows.map(row => ({
      date: row.date, time: row.time, code: row.code, name: row.name, category: row.category,
      direction: row.direction, quantity: Number(row.quantity || 0), averagePrice: Number(row.average_price || 0),
      amount: Number(row.amount || 0), fee: row.fee === "" ? null : Number(row.fee),
      cashBalance: row.cash_balance === "" ? null : Number(row.cash_balance),
      shareBalance: row.share_balance === "" ? null : Number(row.share_balance), sourceRef: row.source_ref,
    }));
    const latestDate = positionRows.map(row => row.date).sort().at(-1) || "";
    const latestPositions = positionRows.filter(row => row.date === latestDate);
    latestPositions.forEach(row => {
      const position = portfolioPositions.find(item => normalizePortfolioCode(item.code, item.account) === normalizePortfolioCode(row.code, row.account));
      if (!position) return;
      position.price = Number(row.close_price); position.previousClose = Number(row.previous_close);
      position.marketValue = Number(row.market_value); position.profit = Number(row.floating_profit);
      position.quoteStatus = row.quote_status;
    });
    portfolioDailyProfitReady = latestPositions.length === portfolioPositions.length && latestPositions.every(row => row.quote_status === "ok");
    portfolioDailyProfitSourceDate = portfolioDailyProfitReady ? latestDate : "";
    portfolioPerformanceData = {
      status: "csv_archive", scope: "stock_account", sourceFile: "portfolio-transactions.csv + portfolio-daily.csv",
      period: { start: series[0]?.date || "", end: series.at(-1)?.date || "" }, series, transactions,
      benchmark: { status: "ok", name: "沪深300", series: dailyRows.filter(row => row.benchmark_close !== "").map(row => ({ date: row.date, close: Number(row.benchmark_close) })) },
    };
    const statusNode = document.getElementById("portfolioUpdatedAt");
    if (statusNode && latestDate) statusNode.textContent = `${latestDate} 收盘归档已载入 · 仅使用本地 CSV`;
  } catch {
    portfolioPerformanceData = null;
    portfolioDailyProfitReady = false;
    portfolioDailyProfitSourceDate = "";
    const statusNode = document.getElementById("portfolioUpdatedAt");
    if (statusNode) statusNode.textContent = "内置账户快照 · 非实时 · 本地 CSV 未加载";
  }
}

function applyOverviewQuoteArchiveRows(rows) {
  rows.forEach(row => {
    const quote = {
      status: row.status || "source_gap",
      symbol: row.symbol,
      normalizedSymbol: row.symbol,
      market: row.market,
      price: csvNumberOrNull(row.price),
      previousClose: csvNumberOrNull(row.previous_close),
      change: csvNumberOrNull(row.change),
      changePct: csvNumberOrNull(row.change_pct),
      volume: csvNumberOrNull(row.volume),
      volumeRatio: csvNumberOrNull(row.volume_ratio),
      industry: row.industry || "",
      provider: `local_csv:${row.provider || "unknown"}`,
      sourceDate: row.source_date || "",
      asOf: row.as_of || row.archived_at || "",
      message: row.message || "",
      cached: true,
    };
    applyQuoteToLinkedState(row.symbol, quote, "stock");
  });
}

function applyOverviewPriceHistoryRows(rows) {
  const grouped = new Map();
  rows.forEach(row => {
    const key = normalizePortfolioCode(row.symbol, "stock");
    if (!key || !row.date || csvNumberOrNull(row.close) == null) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      date: row.date,
      open: csvNumberOrNull(row.open),
      high: csvNumberOrNull(row.high),
      low: csvNumberOrNull(row.low),
      close: csvNumberOrNull(row.close),
      volume: csvNumberOrNull(row.volume),
      amount: csvNumberOrNull(row.amount),
      source: row.source || "tushare",
    });
  });
  grouped.forEach((history, key) => {
    history.sort((a, b) => a.date.localeCompare(b.date));
    const object = objects.find(item => normalizePortfolioCode(item.ticker, "stock") === key);
    if (!object) return;
    object.quote = { ...(object.quote || {}), history, historyProvider: "local_csv:tushare" };
  });
}

async function loadOverviewPriceHistory() {
  try {
    const response = await fetchWithTimeout("./data/overview-price-history.csv", { cache: "no-store" }, 5000);
    if (!response.ok) throw new Error("overview history CSV missing");
    overviewPriceHistoryRows = parseCsv(await response.text()).filter(row => row.symbol && row.date);
    applyOverviewPriceHistoryRows(overviewPriceHistoryRows);
    return overviewPriceHistoryRows;
  } catch {
    overviewPriceHistoryRows = [];
    return [];
  }
}

async function loadOverviewQuoteArchive() {
  const statusNode = document.getElementById("overviewQuoteStatus");
  try {
    const response = await fetchWithTimeout("./data/overview-quotes.csv", { cache: "no-store" }, 5000);
    if (!response.ok) throw new Error("overview quote CSV missing");
    const rows = parseCsv(await response.text()).filter(row => row.archive_date && row.symbol);
    const latestDate = rows.map(row => row.archive_date).sort().at(-1) || "";
    overviewQuoteArchiveDate = latestDate;
    overviewQuoteArchiveRows = rows.filter(row => row.archive_date === latestDate);
    applyOverviewQuoteArchiveRows(overviewQuoteArchiveRows);
    await loadOverviewMiraLevelsForArchive(overviewQuoteArchiveRows);
    if (statusNode) statusNode.textContent = latestDate ? `本地行情 · ${latestDate}` : "暂无本地行情";
    return overviewQuoteArchiveRows;
  } catch {
    overviewQuoteArchiveDate = "";
    overviewQuoteArchiveRows = [];
    if (statusNode) statusNode.textContent = "暂无本地行情";
    return [];
  }
}

async function loadOverviewMiraLevelsForArchive(rows) {
  const targets = rows
    .filter(row => row.symbol)
    .map(row => ({
      symbol: row.symbol,
      market: row.market || "",
      price: csvNumberOrNull(row.price),
    }));
  if (!targets.length) return [];
  try {
    const symbols = targets.map(row => encodeURIComponent(row.symbol)).join(",");
    const markets = targets.map(row => encodeURIComponent(row.market)).join(",");
    const prices = targets.map(row => row.price == null ? "" : encodeURIComponent(String(row.price))).join(",");
    const payload = await fetchReadJson(`/api/read/mira-levels?symbols=${symbols}&markets=${markets}&prices=${prices}`, "mira-levels", { timeoutMs: 10000 });
    const items = Array.isArray(payload.items) ? payload.items : [];
    items.forEach(item => {
      const key = normalizePortfolioCode(item.symbol, "stock");
      const object = objects.find(candidate => normalizePortfolioCode(candidate.ticker, "stock") === key);
      if (!object || !Array.isArray(item.miraLevels)) return;
      object.quote = {
        ...(object.quote || {}),
        miraLevels: item.miraLevels,
        miraLevelSource: "mira_files",
      };
    });
    return items;
  } catch (error) {
    Object.assign(bootstrapMeta, { miraLevelWarning: error.message });
    return [];
  }
}

function currentOverviewArchiveDate() {
  return marketSessionData?.expectedQuoteDate || buildLocalMarketSessionFallback().expectedQuoteDate;
}

function overviewArchiveRowFor(symbol) {
  const key = normalizePortfolioCode(symbol, "stock");
  return overviewQuoteArchiveRows.find(row => normalizePortfolioCode(row.symbol, "stock") === key);
}

function ensurePortfolioHoldingsInObjects() {
  const knownTickers = new Set(objects.map(object => String(object.ticker || "").toUpperCase()));
  portfolioPositions
    .filter(position => position.account === "stock" && !knownTickers.has(String(position.code || "").toUpperCase()))
    .forEach(position => {
      objects.push({
        ticker: position.code,
        name: position.name,
        market: isTrackedEtf(position.code) ? "ETF" : "A股",
        price: formatPortfolioMoney(position.price, 3),
        change: "",
        trend: "持仓标的 · 研究待建立",
        state: "portfolio_only",
        stale: "needs_refresh",
        color: "green",
        path: "",
        fileCount: 0,
        latestModifiedAt: null,
        files: [],
      });
    });
  ensureTrackedEtfsInObjects();
}

function isTrackedEtf(ticker) {
  const normalized = String(ticker || "").toUpperCase();
  return trackedEtfs.some(etf => etf.ticker === normalized);
}

function ensureTrackedEtfsInObjects() {
  trackedEtfs.forEach(etf => {
    const existing = objects.find(object => String(object.ticker || "").toUpperCase() === etf.ticker);
    if (existing) {
      existing.market = "ETF";
      existing.name = etf.name;
      return;
    }
    objects.push({
      ticker: etf.ticker,
      name: etf.name,
      market: "ETF",
      price: "待接入",
      change: "",
      trend: "走势判断待读取",
      state: "portfolio_only",
      stale: "needs_refresh",
      color: "green",
      path: "",
      fileCount: 0,
      latestModifiedAt: null,
      files: [],
    });
  });
}

function replaceArray(target, next) {
  if (!Array.isArray(next)) return;
  target.splice(0, target.length, ...next);
}

function replaceLibraryDocs(data) {
  if (!Array.isArray(data)) return;
  // 直接用 API / JSON 数据覆盖，包含全部 lessons + industry + methods
  libraryDocs.splice(0, libraryDocs.length, ...data);
}

function buildAppSnapshotData({ compact = false } = {}) {
  const cachedObjects = objects.map(object => {
    if (!compact || !object?.quote?.history) return object;
    const quote = { ...object.quote };
    delete quote.history;
    return { ...object, quote };
  });
  return {
    navItems,
    objects: cachedObjects,
    libraryDocs,
    deepReports,
    objectLibraryFiles,
    activity,
    bootstrapMeta,
    overviewQuoteArchiveRows,
    overviewQuoteArchiveDate,
    overviewPriceHistoryRows: compact ? [] : overviewPriceHistoryRows,
    portfolioPositions,
    portfolioAccounts,
    portfolioPerformanceData,
    portfolioPositionReviewData,
    portfolioDailyProfitReady,
    portfolioDailyProfitSourceDate,
    providerStatusData,
    operationCatalogData,
    marketCalendarData,
    marketSessionData,
    marketPulseData,
    researchFeedData,
    activeFeedScope,
    selectedObjectIndex,
  };
}

function persistAppSnapshot(reason = "manual_refresh") {
  let result = writeSnapshot(
    localStorage,
    APP_SNAPSHOT_CACHE_KEY,
    APP_SNAPSHOT_CACHE_VERSION,
    buildAppSnapshotData(),
    { reason },
  );
  if (!result.ok) {
    result = writeSnapshot(
      localStorage,
      APP_SNAPSHOT_CACHE_KEY,
      APP_SNAPSHOT_CACHE_VERSION,
      buildAppSnapshotData({ compact: true }),
      { reason, compact: true },
    );
  }
  return result.ok;
}

function restoreAppSnapshot() {
  const snapshot = readSnapshot(localStorage, APP_SNAPSHOT_CACHE_KEY, APP_SNAPSHOT_CACHE_VERSION);
  const data = snapshot?.data;
  if (!data || !Array.isArray(data.objects) || !data.objects.length) return null;

  replaceArray(navItems, data.navItems);
  replaceArray(objects, data.objects);
  replaceLibraryDocs(data.libraryDocs);
  replaceArray(deepReports, data.deepReports);
  replaceArray(objectLibraryFiles, data.objectLibraryFiles);
  replaceArray(activity, data.activity);
  replaceArray(overviewQuoteArchiveRows, data.overviewQuoteArchiveRows);
  replaceArray(overviewPriceHistoryRows, data.overviewPriceHistoryRows);
  replaceArray(portfolioPositions, data.portfolioPositions);
  Object.assign(portfolioAccounts, data.portfolioAccounts || {});
  Object.assign(bootstrapMeta, data.bootstrapMeta || {}, {
    loadedFrom: "local-cache",
    cacheSavedAt: snapshot.savedAt || "",
    cacheReason: snapshot.reason || "",
  });
  overviewQuoteArchiveDate = data.overviewQuoteArchiveDate || "";
  portfolioPerformanceData = data.portfolioPerformanceData || null;
  portfolioPositionReviewData = data.portfolioPositionReviewData || { status: "missing", reviews: [] };
  portfolioDailyProfitReady = data.portfolioDailyProfitReady === true;
  portfolioDailyProfitSourceDate = data.portfolioDailyProfitSourceDate || "";
  providerStatusData = data.providerStatusData || providerStatusData;
  operationCatalogData = data.operationCatalogData || operationCatalogData;
  marketCalendarData = data.marketCalendarData || marketCalendarData;
  marketSessionData = data.marketSessionData || marketSessionData;
  marketPulseData = data.marketPulseData || marketPulseData;
  if (data.researchFeedData) Object.assign(researchFeedData, data.researchFeedData);
  activeFeedScope = data.activeFeedScope === "watchlist" ? "watchlist" : "held";
  selectedObjectIndex = Math.max(0, Math.min(Number(data.selectedObjectIndex || 0), objects.length - 1));
  ensurePortfolioHoldingsInObjects();
  return snapshot;
}

function cachedSnapshotLabel(snapshot) {
  const savedAt = snapshot?.savedAt ? new Date(snapshot.savedAt) : null;
  if (!savedAt || Number.isNaN(savedAt.getTime())) return "已载入上次缓存";
  return `上次缓存 · ${savedAt.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`;
}

function renderNav() {
  const nav = document.getElementById("navList");
  nav.innerHTML = navItems.map(([id, icon, label]) => `
    <button class="nav-item ${id === "overview" ? "active" : ""}" data-view="${id}">
      <span class="nav-icon">${icon}</span><span>${label}</span>
    </button>`).join("");
  nav.addEventListener("click", event => {
    const btn = event.target.closest("button[data-view]");
    if (!btn) return;
    setView(btn.dataset.view);
  });
}

function setView(view) {
  document.body.classList.toggle("portfolio-active", view === "portfolio");
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const title = document.getElementById("sectionTitle");
  const eyebrow = document.getElementById("sectionEyebrow");
  const labels = Object.fromEntries(navItems.map(([id,, label]) => [id, label]));
  eyebrow.textContent = labels[view] || "模块";
  title.textContent = view === "overview" ? "今日研究状态" : labels[view];
  if (view === "overview") {
    document.getElementById("overviewView").classList.add("active");
  } else if (view === "feed") {
    document.getElementById("feedView").classList.add("active");
    renderMarketPulse();
    renderResearchFeed();
    if (researchFeedData[activeFeedScope].status === "idle") loadResearchFeed(activeFeedScope);
  } else if (view === "radar") {
    document.getElementById("radarView").classList.add("active");
  } else if (view === "portfolio") {
    document.getElementById("portfolioView").classList.add("active");
    renderPortfolio();
  } else if (view === "industry") {
    document.getElementById("industryView").classList.add("active");
    renderIndustryView();
  } else if (view === "targets") {
    document.getElementById("targetsView").classList.add("active");
  } else if (view === "library") {
    document.getElementById("libraryView").classList.add("active");
  } else if (view === "sources") {
    document.getElementById("sourcesView").classList.add("active");
    renderSourceStatusView();
  } else if (view === "queue") {
    document.getElementById("queueView").classList.add("active");
    renderUpdateQueue();
  } else if (view === "settings") {
    document.getElementById("settingsView").classList.add("active");
    renderSettingsView();
  } else {
    document.getElementById("placeholderTitle").textContent = labels[view];
    document.getElementById("placeholderView").classList.add("active");
  }
}

function portfolioMultiplier(position) {
  return position.account === "option" ? position.multiplier : 1;
}

function normalizePortfolioCode(code, account = "") {
  const value = String(code || "").trim().toUpperCase();
  if (!value || account === "option" || /^\d{8}$/.test(value) || /\.(SH|SZ|BJ)$/.test(value)) return value;
  if (/^(5|6|9)\d{5}$/.test(value)) return `${value}.SH`;
  if (/^(0|1|2|3)\d{5}$/.test(value)) return `${value}.SZ`;
  if (/^(4|8)\d{5}$/.test(value)) return `${value}.BJ`;
  return value;
}

function applyQuoteToLinkedState(symbol, quote, account = "") {
  const inferredAccount = account || (/^\d{8}$/.test(String(symbol || "").trim()) ? "option" : "stock");
  const key = normalizePortfolioCode(symbol, inferredAccount);
  if (!key || !quote) return;

  const object = objects.find(item => normalizePortfolioCode(item.ticker, "stock") === key);
  if (object) {
    const localHistory = object.quote?.history;
    const localLevels = Array.isArray(object.quote?.miraLevels) ? object.quote.miraLevels : [];
    const nextQuote = Array.isArray(quote.miraLevels) && quote.miraLevels.length
      ? quote
      : localLevels.length
      ? { ...quote, miraLevels: localLevels, miraLevelSource: object.quote?.miraLevelSource || "mira_files" }
      : quote;
    object.quote = localHistory?.length && !nextQuote.history ? { ...nextQuote, history: localHistory, historyProvider: object.quote.historyProvider } : nextQuote;
    applyQuoteToDetailSummary(object, object.quote);
  }

  const price = toFiniteNumberOrNull(quote.price);
  if (quote.status === "ok" && price != null) {
    // 已清仓但当日有交易的代码没有持仓行，仍需保留行情用于今日收益计算与恢复。
    portfolioQuoteCache.set(key, quote);
  }

  const position = portfolioPositions.find(item => normalizePortfolioCode(item.code, item.account) === key);
  if (!position) return;
  if (quote.status !== "ok") {
    if (toFiniteNumberOrNull(position.previousClose) == null) {
      position.quoteStatus = "failed";
      position.quoteError = quote.message || quote.status || "行情数据不完整";
    }
    return;
  }

  const previousClose = toFiniteNumberOrNull(quote.previousClose);
  if (price == null) return;
  position.price = price;
  position.previousClose = previousClose;
  position.quoteStatus = "ok";
  position.quoteError = "";
  position.marketValue = portfolioMultiplier(position) * position.quantity * price;
  position.profit = position.marketValue - position.costBasis;
  if (position.account === "option") position.optionQuote = quote;
}

function portfolioMarketValue(position) {
  if (Number.isFinite(position.marketValue)) return position.marketValue;
  return position.quantity * portfolioMultiplier(position) * position.price;
}

function portfolioProfit(position) {
  if (Number.isFinite(position.profit)) return position.profit;
  return position.quantity * portfolioMultiplier(position) * (position.price - position.cost);
}

function portfolioDailyProfit(position) {
  if (!Number.isFinite(position.previousClose)) return null;
  return position.quantity * portfolioMultiplier(position) * (position.price - position.previousClose);
}

function inferPortfolioTransactionAccount(row) {
  const code = String(row?.code || "").trim();
  if (/^\d{8}$/.test(code)) return "option";
  return "stock";
}

function isPortfolioBuyTransaction(row) {
  const direction = String(row?.direction || row?.category || "");
  return /买入|申购/.test(direction);
}

function isPortfolioSellTransaction(row) {
  const direction = String(row?.direction || row?.category || "");
  return /卖出/.test(direction);
}

function getPortfolioAsOfDate() {
  const transactionDates = (portfolioPerformanceData?.transactions || [])
    .map(row => String(row?.date || "").trim())
    .filter(Boolean)
    .sort();
  return transactionDates[transactionDates.length - 1] || beijingDateIso();
}

function getPortfolioTransactionsForDate(account, asOfDate = getPortfolioAsOfDate()) {
  return (portfolioPerformanceData?.transactions || []).filter(row =>
    String(row?.date || "").trim() === asOfDate && inferPortfolioTransactionAccount(row) === account
  );
}

function getPortfolioQuote(code) {
  const key = normalizePortfolioCode(code);
  if (!key) return null;
  if (portfolioQuoteCache.has(key)) return portfolioQuoteCache.get(key);
  const position = portfolioPositions.find(item => normalizePortfolioCode(item.code, item.account) === key);
  if (!position) return null;
  return {
    price: toFiniteNumberOrNull(position.price),
    previousClose: toFiniteNumberOrNull(position.previousClose),
  };
}

function toFiniteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function computePortfolioAccountDailyProfit(account, asOfDate = portfolioDailyProfitSourceDate || getPortfolioAsOfDate()) {
  const endPositions = portfolioPositions.filter(position => position.account === account);
  const endQtyByCode = new Map();
  const positionByCode = new Map();
  endPositions.forEach(position => {
    const code = normalizePortfolioCode(position.code, account);
    endQtyByCode.set(code, Number(position.quantity || 0));
    positionByCode.set(code, position);
  });

  const todayTransactions = getPortfolioTransactionsForDate(account, asOfDate);
  const codes = new Set([...endQtyByCode.keys()]);
  const netQtyByCode = new Map();
  let netTradeCash = 0;

  todayTransactions.forEach(row => {
    const code = normalizePortfolioCode(row.code, account);
    if (!code) return;
    codes.add(code);
    const quantity = Number(row.quantity || 0);
    const current = netQtyByCode.get(code) || 0;
    if (isPortfolioBuyTransaction(row)) {
      netQtyByCode.set(code, current + quantity);
      netTradeCash -= Number(row.amount || 0) + Number(row.fee || 0);
    } else if (isPortfolioSellTransaction(row)) {
      netQtyByCode.set(code, current - quantity);
      netTradeCash += Number(row.amount || 0) - Number(row.fee || 0);
    }
  });

  const endCash = account === "stock" ? portfolioAccounts.stock.cash + portfolioAdditionalCash : portfolioAccounts.option.cash;
  const startCash = endCash - netTradeCash;
  let startValue = 0;
  let endValue = 0;
  let missingQuote = false;

  codes.forEach(code => {
    const endQty = Number(endQtyByCode.get(code) || 0);
    const netQty = Number(netQtyByCode.get(code) || 0);
    const startQty = endQty - netQty;
    const quote = getPortfolioQuote(code);
    const multiplier = Number(positionByCode.get(code)?.multiplier || (account === "option" ? 10000 : 1));
    const endPrice = toFiniteNumberOrNull(quote?.price);
    const previousClose = toFiniteNumberOrNull(quote?.previousClose);

    if (startQty > 0) {
      if (!Number.isFinite(previousClose)) {
        missingQuote = true;
        return;
      }
      startValue += startQty * multiplier * previousClose;
    }
    if (endQty > 0) {
      if (!Number.isFinite(endPrice)) {
        missingQuote = true;
        return;
      }
      endValue += endQty * multiplier * endPrice;
    }
  });

  if (missingQuote) return null;
  return (endValue + endCash) - (startValue + startCash);
}

function computePortfolioDailyProfit(filter = getActivePortfolioFilter()) {
  if (!portfolioDailyProfitReady) return null;
  if (filter === "stock") return computePortfolioAccountDailyProfit("stock");
  if (filter === "option") return computePortfolioAccountDailyProfit("option");
  const stockDaily = computePortfolioAccountDailyProfit("stock");
  const optionDaily = computePortfolioAccountDailyProfit("option");
  if (!Number.isFinite(stockDaily) || !Number.isFinite(optionDaily)) return null;
  return stockDaily + optionDaily;
}

function formatPortfolioMoney(value, decimals = 2) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatPortfolioSigned(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPortfolioMoney(value)}`;
}

function getPortfolioPositions(filter = getActivePortfolioFilter()) {
  return portfolioPositions.filter(position => filter === "all" || position.account === filter);
}

function portfolioCashForFilter(filter = getActivePortfolioFilter()) {
  if (filter === "stock") return portfolioAccounts.stock.cash + portfolioAdditionalCash;
  if (filter === "option") return portfolioAccounts.option.cash;
  return portfolioCash;
}

function portfolioSnapshot(filter = getActivePortfolioFilter()) {
  const positions = getPortfolioPositions(filter);
  const marketValue = positions.reduce((sum, position) => sum + portfolioMarketValue(position), 0);
  const positionCostBasis = positions.reduce((sum, position) => sum + Number(position.costBasis || 0), 0);
  const profit = positions.reduce((sum, position) => sum + portfolioProfit(position), 0);
  const costBasis = positionCostBasis;
  const cash = portfolioCashForFilter(filter);
  const financingLiability = filter === "option" ? 0 : Number(portfolioAccounts.stock.financingLiability || 0);
  const dailyProfit = computePortfolioDailyProfit(filter);
  return {
    positions,
    marketValue,
    costBasis,
    profit,
    cash,
    financingLiability,
    totalAssets: marketValue + cash - financingLiability,
    totalReturn: costBasis ? profit / costBasis * 100 : null,
    dailyProfit: Number.isFinite(dailyProfit) ? dailyProfit : null,
  };
}

function syncPortfolioSeriesToLatestQuote() {
  const series = portfolioPerformanceData?.series;
  const sourceDate = portfolioDailyProfitSourceDate;
  if (!Array.isArray(series) || !series.length || !sourceDate) return false;
  const existingIndex = series.findIndex(point => point.date === sourceDate);
  const baseIndex = existingIndex >= 0 ? existingIndex - 1 : series.length - 1;
  const last = series[baseIndex];
  if (!last?.date || sourceDate < last.date) return false;

  const snapshot = portfolioSnapshot("stock");
  const previousValue = Number(last.value);
  const previousIndex = Number(last.twrIndex);
  if (!Number.isFinite(snapshot.totalAssets) || !Number.isFinite(previousValue) || previousValue <= 0 || !Number.isFinite(previousIndex)) return false;

  // The additional cash was introduced after the imported curve's final brokerage snapshot.
  const externalFlow = existingIndex >= 0
    ? Number(series[existingIndex].externalFlow || 0)
    : series.some(point => point.estimate === "latest_quote_gap" || point.estimate === "daily_csv_archive") ? 0 : portfolioAdditionalCash;
  const periodReturn = (snapshot.totalAssets - externalFlow) / previousValue - 1;
  if (!Number.isFinite(periodReturn) || Math.abs(periodReturn) >= 0.5) return false;

  const nextPoint = {
    date: sourceDate,
    value: Number(snapshot.totalAssets.toFixed(2)),
    twrIndex: Number((previousIndex * (1 + periodReturn)).toFixed(4)),
    dailyReturn: Number((periodReturn * 100).toFixed(4)),
    externalFlow,
    activeHoldings: portfolioPositions.filter(position => position.account === "stock" && Number(position.quantity) > 0).length,
    estimate: "latest_quote_gap",
  };
  if (existingIndex >= 0) series[existingIndex] = nextPoint;
  else series.push(nextPoint);
  portfolioPerformanceData.period.end = sourceDate;
  portfolioPerformanceData.latestPointEstimate = true;
  return true;
}

async function syncPortfolioBenchmarkToLatest() {
  const benchmark = portfolioPerformanceData?.benchmark;
  if (!benchmark || !Array.isArray(benchmark.series)) return false;
  try {
    const quote = await fetchReadJson("/api/read/quote?symbol=000300.SH&market=A%E8%82%A1", "quote", { timeoutMs: 12000 });
    if (quote?.status !== "ok" || !Array.isArray(quote.history)) return false;
    const knownDates = new Set(benchmark.series.map(point => point.date));
    quote.history.forEach(point => {
      const close = toFiniteNumberOrNull(point.close);
      if (point.date && close != null && !knownDates.has(point.date)) {
        benchmark.series.push({ date: point.date, close });
      }
    });
    benchmark.series.sort((a, b) => a.date.localeCompare(b.date));
    benchmark.status = "ok";
    benchmark.source = quote.provider || benchmark.source || "quote";
    return true;
  } catch {
    return false;
  }
}

function renderPortfolio() {
  const filter = getActivePortfolioFilter();
  renderPortfolioMetrics(filter);
  renderPortfolioPerformance(filter);
  renderPortfolioContribution(filter);
  renderPortfolioHoldings(filter);
  renderPortfolioAllocation(filter);
  renderPortfolioOptionRisk(filter);
  renderPortfolioPositionReviews();
  const optionAnalysis = document.getElementById("portfolioOptionAnalysis");
  if (optionAnalysis) optionAnalysis.hidden = filter !== "option";
  if (filter === "option") {
    renderPortfolioGreeks(filter);
    renderPortfolioStress(filter);
    renderPortfolioStrategies(filter);
  }
  const labels = { all: "全部组合", stock: "股票账户", option: "期权账户" };
  const scope = document.getElementById("portfolioTableScope");
  if (scope) scope.textContent = labels[filter] || labels.all;
}

function renderPortfolioPositionReviews() {
  const summary = document.getElementById("portfolioPositionReviewSummary");
  const cutoff = document.getElementById("portfolioPositionReviewDate");
  if (!summary) return;
  const payload = portfolioPositionReviewData || {};
  if (cutoff) cutoff.textContent = payload.reviewDate ? `复盘日期 ${payload.reviewDate}` : "尚未生成";
  if (payload.status !== "ok") {
    summary.innerHTML = `<div class="position-review-empty"><strong>暂无完整组合复盘</strong><span>${escapeHtml(payload.message || "请先生成完整组合复盘文件")}</span></div>`;
    return;
  }
  const overview = payload.summary || {};
  const metricItems = [
    ["股票持仓盈亏", overview.stockPositionProfit],
    ["期权持仓盈亏", overview.optionPositionProfit],
    ["未平仓合计", overview.openPositionProfit],
  ];
  summary.innerHTML = metricItems.map(([label, value]) => {
    const numeric = typeof value === "number";
    return `<div><span>${escapeHtml(label)}</span><strong class="${numeric ? (value >= 0 ? "profit-up" : "profit-down") : ""}">${numeric ? formatPortfolioMoney(value) : escapeHtml(value ?? "--")}</strong></div>`;
  }).join("") + (payload.summaryPath
    ? `<button class="ghost-btn position-review-summary-button" type="button" data-position-review-path="${escapeHtml(payload.summaryPath)}">预览完整组合复盘</button>`
    : `<div><span>组合复盘文件</span><strong>尚未生成</strong></div>`);
}

function getUnderlyingQuote(code) {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return null;
  return portfolioQuoteCache.get(`underlying:${raw}`) || portfolioQuoteCache.get(`underlying:${normalizePortfolioCode(raw, "stock")}`) || null;
}

function optionAnalytics(filter = getActivePortfolioFilter()) {
  const positions = getPortfolioPositions(filter).filter(position => position.account === "option");
  const analytics = {
    positions,
    covered: 0,
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    ivValues: [],
    expiryCounts: new Map(),
    underlyingCodes: new Set(),
    matchedUnderlying: false,
    scenarioReady: 0,
  };
  const stockCodes = new Set(portfolioPositions.filter(position => position.account === "stock").map(position => normalizePortfolioCode(position.code, "stock")));

  positions.forEach(position => {
    const quote = position.optionQuote || getPortfolioQuote(position.code) || {};
    const delta = toFiniteNumberOrNull(quote.delta);
    const gamma = toFiniteNumberOrNull(quote.gamma);
    const theta = toFiniteNumberOrNull(quote.theta);
    const vega = toFiniteNumberOrNull(quote.vega);
    const scale = Number(position.quantity || 0) * portfolioMultiplier(position);
    const underlyingCode = String(quote.underlyingCode || "").trim().toUpperCase();
    if ([delta, gamma, theta, vega].every(value => value != null)) {
      analytics.covered += 1;
      analytics.delta += delta * scale;
      analytics.gamma += gamma * scale;
      analytics.theta += theta * scale;
      analytics.vega += vega * scale;
    }
    const iv = toFiniteNumberOrNull(quote.impliedVolatility);
    if (iv != null) analytics.ivValues.push(iv);
    if (quote.expiryDate) analytics.expiryCounts.set(quote.expiryDate, (analytics.expiryCounts.get(quote.expiryDate) || 0) + 1);
    if (underlyingCode) {
      analytics.underlyingCodes.add(underlyingCode);
      analytics.matchedUnderlying ||= stockCodes.has(normalizePortfolioCode(underlyingCode, "stock"));
      if (getUnderlyingQuote(underlyingCode)?.status === "ok" && delta != null && gamma != null && vega != null) analytics.scenarioReady += 1;
    }
  });
  return analytics;
}

function formatExposure(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function renderPortfolioGreeks(filter = "all") {
  const grid = document.getElementById("portfolioGreeksGrid");
  if (!grid) return;
  const analytics = optionAnalytics(filter);
  const status = document.getElementById("portfolioGreeksStatus");
  const coverage = document.getElementById("portfolioGreeksCoverage");
  const notes = document.getElementById("portfolioRiskNotes");
  if (!analytics.positions.length) {
    grid.innerHTML = `<div class="analysis-empty-state"><strong>当前筛选不含期权</strong><span>切换到全部组合或期权账户查看 Greeks 风险。</span></div>`;
    if (status) status.textContent = "无可分析期权持仓";
    if (coverage) coverage.textContent = "0/0 合约";
    if (notes) notes.innerHTML = "";
    return;
  }
  const metrics = [
    ["净 Delta", formatExposure(analytics.delta), "标的等价份额"],
    ["净 Gamma", formatExposure(analytics.gamma), "按行情源口径汇总"],
    ["净 Theta", formatExposure(analytics.theta), "时间衰减暴露"],
    ["净 Vega", formatExposure(analytics.vega), "波动率暴露"],
  ];
  grid.innerHTML = metrics.map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><em>${note}</em></article>`).join("");
  if (status) status.textContent = analytics.covered ? `行情源 Greeks · ${analytics.ivValues.length} 个合约含 IV` : "Greeks 尚未取得";
  if (coverage) coverage.textContent = `${analytics.covered}/${analytics.positions.length} 合约`;
  const expiries = [...analytics.expiryCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const nearest = expiries[0]?.[0] || "待行情确认";
  const concentration = expiries.length === 1 ? "到期集中" : expiries.length > 1 ? `${expiries.length} 个到期日` : "到期日待确认";
  if (notes) notes.innerHTML = `
    <div><span>最近到期</span><strong>${escapeHtml(nearest)}</strong></div>
    <div><span>期限分布</span><strong>${escapeHtml(concentration)}</strong></div>
    <div><span>标的匹配</span><strong>${analytics.matchedUnderlying ? "已有现货持仓" : "未发现匹配现货"}</strong></div>
    <div><span>数据边界</span><strong>${analytics.covered === analytics.positions.length ? "可用于风险近似" : "source_gap"}</strong></div>`;
}

function optionScenarioLegs(analytics) {
  const legs = [];
  analytics.positions.forEach(position => {
    const quote = position.optionQuote || getPortfolioQuote(position.code) || {};
    const underlying = getUnderlyingQuote(quote.underlyingCode);
    const spot = toFiniteNumberOrNull(underlying?.price);
    const strike = toFiniteNumberOrNull(quote.strikePrice);
    const volatility = toFiniteNumberOrNull(quote.impliedVolatility);
    if ([spot, strike, volatility].some(value => value == null) || !quote.expiryDate || !quote.optionType) return;
    legs.push({
      symbol: position.code,
      optionType: quote.optionType,
      spot,
      strike,
      volatility,
      quantity: Number(position.quantity || 0),
      multiplier: portfolioMultiplier(position),
      asOfDate: quote.sourceDate || underlying?.sourceDate,
      expiryDate: quote.expiryDate,
    });
  });
  return legs;
}

function estimateOptionStressCurve(analytics) {
  if (!globalThis.MiraOptionMath?.estimateCurve) return { points: [] };
  return globalThis.MiraOptionMath.estimateCurve(
    optionScenarioLegs(analytics),
    { minMove: -0.3, maxMove: 0.3, steps: 24, ivShift: 0 },
    { rate: 0.015, dividendYield: 0 },
  );
}

function formatStressAxisMoney(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function stressCurveSvg(points) {
  const width = 720; const height = 300;
  const margin = { top: 20, right: 24, bottom: 42, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map(point => Number(point.pnl));
  let minY = Math.min(0, ...values); let maxY = Math.max(0, ...values);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const padding = (maxY - minY) * 0.1;
  minY -= padding; maxY += padding;
  const x = move => margin.left + ((move + 0.3) / 0.6) * plotWidth;
  const y = value => margin.top + (maxY - value) / (maxY - minY) * plotHeight;
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.priceMove).toFixed(2)},${y(point.pnl).toFixed(2)}`).join(" ");
  const xTicks = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];
  const yTicks = Array.from({ length: 5 }, (_, index) => minY + (maxY - minY) * index / 4);
  const grid = yTicks.map(value => `<g><line class="stress-grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}"></line><text class="stress-axis-label" x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${escapeHtml(formatStressAxisMoney(value))}</text></g>`).join("");
  const ticks = xTicks.map(value => `<g><line class="stress-tick" x1="${x(value)}" x2="${x(value)}" y1="${height - margin.bottom}" y2="${height - margin.bottom + 5}"></line><text class="stress-axis-label" x="${x(value)}" y="${height - 17}" text-anchor="middle">${value > 0 ? "+" : ""}${Math.round(value * 100)}%</text></g>`).join("");
  const hitPoints = points.map(point => `<circle class="stress-hit-point" cx="${x(point.priceMove)}" cy="${y(point.pnl)}" r="7"><title>标的 ${point.priceMove > 0 ? "+" : ""}${Math.round(point.priceMove * 1000) / 10}%：${formatPortfolioSigned(point.pnl)} CNY</title></circle>`).join("");
  const keyPoints = points.filter(point => [-0.3, 0, 0.3].some(value => Math.abs(point.priceMove - value) < 1e-8)).map(point => `<circle class="stress-key-point" cx="${x(point.priceMove)}" cy="${y(point.pnl)}" r="4"></circle>`).join("");
  return `<svg class="stress-curve-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="期权组合在标的价格变动负百分之三十到正百分之三十时的估算损益曲线">
    ${grid}
    <line class="stress-zero-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}"></line>
    <line class="stress-axis-line" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
    ${ticks}<path class="stress-curve-line" d="${path}"></path>${keyPoints}${hitPoints}
    <text class="stress-axis-title" x="16" y="16">估算损益（CNY）</text>
    <text class="stress-axis-title" x="${width - margin.right}" y="${height - 2}" text-anchor="end">标的价格变动</text>
  </svg>`;
}

function renderPortfolioStress(filter = "all") {
  const container = document.getElementById("portfolioStressResult");
  if (!container) return;
  const analytics = optionAnalytics(filter);
  if (!analytics.positions.length) {
    container.innerHTML = `<div class="analysis-empty-state"><strong>当前筛选不含期权</strong><span>压力测试仅作用于期权持仓。</span></div>`;
    return;
  }
  const curve = estimateOptionStressCurve(analytics);
  const used = curve.points[0]?.used || 0;
  const complete = curve.points.length === 25 && curve.points.every(point => point.used === analytics.positions.length);
  if (!complete) {
    container.innerHTML = `<div class="stress-source-gap"><span class="pill amber">source_gap</span><strong>等待完整的期权定价数据</strong><p>当前仅 ${used}/${analytics.positions.length} 个合约可重定价。标的价格、行权价、IV 或到期日缺失时不展示损益曲线。</p></div>`;
    return;
  }
  const anchors = [-0.3, 0, 0.3].map(move => curve.points.find(point => Math.abs(point.priceMove - move) < 1e-8));
  container.innerHTML = `
    <div class="stress-curve-shell">
      ${stressCurveSvg(curve.points)}
      <div class="stress-curve-anchors">
        ${anchors.map(point => `<div><span>${point.priceMove > 0 ? "+" : ""}${Math.round(point.priceMove * 100)}%</span><strong>${formatPortfolioSigned(point.pnl)} CNY</strong></div>`).join("")}
      </div>
    </div>
    <div class="stress-method-note"><strong>${analytics.positions.length}/${analytics.positions.length} 合约进入计算</strong><span>横轴为标的价格变动 −30% 至 +30%，IV 保持不变；Black-Scholes 重定价，无风险利率假设 1.5%，未计分红、偏斜迁移和盘口滑点。</span></div>`;
}

function renderPortfolioStrategies(filter = "all") {
  const summary = document.getElementById("portfolioStrategySummary");
  const grid = document.getElementById("portfolioStrategyGrid");
  const pricing = document.getElementById("portfolioPricingStatus");
  if (!summary || !grid) return;
  const analytics = optionAnalytics(filter);
  if (!analytics.positions.length) {
    summary.innerHTML = `<div><span>当前组合</span><strong>无期权持仓</strong><em>切换账户筛选后再评估结构</em></div>`;
    grid.innerHTML = `<div class="analysis-empty-state"><strong>暂无策略结构可比较</strong><span>期权策略不会在没有目标、期限和风险预算时自动推荐。</span></div>`;
    return;
  }
  const optionTypes = analytics.positions.map(position => position.optionType);
  const putCount = optionTypes.filter(type => type === "认沽").length;
  const callCount = optionTypes.filter(type => type === "认购").length;
  const avgIv = analytics.ivValues.length ? analytics.ivValues.reduce((sum, value) => sum + value, 0) / analytics.ivValues.length : null;
  const expiries = [...analytics.expiryCounts.keys()];
  const dominant = putCount > callCount ? "下行凸性偏重" : callCount > putCount ? "上行凸性偏重" : "双向波动表达";
  summary.innerHTML = `
    <div><span>当前组合形态</span><strong>${dominant}</strong><em>${callCount} 认购 / ${putCount} 认沽</em></div>
    <div><span>平均隐含波动率</span><strong>${avgIv == null ? "待行情" : `${(avgIv * 100).toFixed(1)}%`}</strong><em>${analytics.ivValues.length}/${analytics.positions.length} 合约覆盖</em></div>
    <div><span>期限结构</span><strong>${expiries.length ? `${expiries.length} 个到期日` : "待行情"}</strong><em>${expiries.sort()[0] || "到期信息未确认"}</em></div>
    <div><span>策略边界</span><strong>${analytics.matchedUnderlying ? "可评估保护结构" : "无匹配现货"}</strong><em>不生成具体下单合约</em></div>`;

  const structures = [
    {
      name: "保护性 Put",
      family: "protective_option",
      status: analytics.matchedUnderlying ? "可评估" : "暂不匹配",
      tone: analytics.matchedUnderlying ? "green" : "muted",
      detail: analytics.matchedUnderlying ? "已有匹配现货，可比较保护成本与下行边界。" : "未发现与期权标的一致的现货持仓。",
    },
    {
      name: "认沽价差",
      family: "listed_option_spread",
      status: putCount >= 2 ? "优先比较" : "条件不足",
      tone: putCount >= 2 ? "blue" : "muted",
      detail: putCount >= 2 ? "多档认沽已存在，可评估降低权利金与封顶收益的交换。" : "至少需要同期限的两档认沽。",
    },
    {
      name: "双向波动结构",
      family: "listed_option_long_premium",
      status: callCount && putCount ? "可评估" : "条件不足",
      tone: callCount && putCount ? "purple" : "muted",
      detail: callCount && putCount ? "认购与认沽并存，需检查期限、行权价和 IV 是否形成有效组合。" : "需要同时存在认购与认沽腿。",
    },
    {
      name: "Collar",
      family: "collar_or_overlay",
      status: analytics.matchedUnderlying && callCount && putCount ? "可评估" : "暂不匹配",
      tone: analytics.matchedUnderlying && callCount && putCount ? "green" : "muted",
      detail: "需要匹配现货、保护性认沽与备兑认购，接受上行被封顶。",
    },
  ];
  grid.innerHTML = structures.map(item => `
    <article class="strategy-card">
      <div><span>${item.family}</span><span class="pill ${item.tone}">${item.status}</span></div>
      <h3>${item.name}</h3>
      <p>${item.detail}</p>
      <em>需补：目标 · 时间窗口 · 最大可接受损失</em>
    </article>`).join("");
  if (pricing) pricing.textContent = avgIv == null
    ? "行情源 IV 尚未取得；理论定价与波动率曲面保持 source_gap。"
    : `行情源 IV 已覆盖 ${analytics.ivValues.length} 个合约；独立理论价与曲面拟合服务尚未接入。`;
}

function renderPortfolioMetrics(filter = "all") {
  const container = document.getElementById("portfolioMetrics");
  if (!container) return;
  const snapshot = portfolioSnapshot(filter);
  const profitNote = "当前未平仓持仓市值 - 账户快照成本基数；不含已平仓损益";
  const returnNote = "当前持仓盈亏 ÷ 当前未平仓持仓成本基数";
  const assetNote = snapshot.financingLiability > 0
    ? "持仓市值 + 可用资金 - 融资负债本金"
    : "持仓市值 + 可用资金";
  const metrics = [
    ["账户总资产", snapshot.totalAssets, assetNote, ""],
    ["当前持仓盈亏", snapshot.profit, profitNote, snapshot.profit >= 0 ? "positive" : "negative"],
    ["当前持仓收益率", snapshot.totalReturn, returnNote, snapshot.totalReturn >= 0 ? "positive" : "negative", "percent"],
    ["今日收益", snapshot.dailyProfit, snapshot.dailyProfit == null ? "行情刷新后可计算" : "按已刷新股票和期权行情计算", snapshot.dailyProfit >= 0 ? "positive" : "negative"],
  ];
  container.innerHTML = metrics.map(([label, value, note, tone, format]) => `
    <article>
      <span>${label}</span>
      <strong class="${value == null ? "muted-change" : tone}">${value == null ? "--" : format === "percent" ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : tone ? formatPortfolioSigned(value) : formatPortfolioMoney(value)}</strong>
      <em>${note}</em>
    </article>`).join("");
}

function portfolioPricesNeedRefresh() {
  return portfolioPositions.some(position =>
    (position.account === "stock" || position.account === "option") &&
    toFiniteNumberOrNull(position.previousClose) == null
  );
}

function getPortfolioRefreshState() {
  try {
    return JSON.parse(localStorage.getItem(PORTFOLIO_REFRESH_STATE_KEY) || "null");
  } catch {
    return null;
  }
}

function getSavedPortfolioSourceDate(saved = getPortfolioRefreshState()) {
  return saved?.sourceDate || saved?.sourceDates?.[0] || saved?.marketDate || "";
}

function portfolioAutoRefreshDecision() {
  if (!marketSessionData) return { allowed: false, reason: "session_unknown", message: "正在检查 A 股交易状态..." };
  const saved = getPortfolioRefreshState();
  const expectedQuoteDate = marketSessionData.expectedQuoteDate || marketSessionData.marketDate;
  if (
    saved?.complete === true &&
    getSavedPortfolioSourceDate(saved) === expectedQuoteDate
  ) {
    return {
      allowed: false,
      reason: "refreshed_after_close",
      message: `${expectedQuoteDate} 收盘行情已更新，本次不重复刷新`,
    };
  }
  if (!portfolioPricesNeedRefresh()) return { allowed: false, reason: "prices_loaded", message: "" };
  if (!marketSessionData.isTradingDay || marketSessionData.phase !== "closed" || !marketSessionData.autoRefreshAllowed) {
    return { allowed: false, reason: marketSessionData.phase, message: marketSessionData.message };
  }
  return { allowed: true, reason: "after_close", message: "" };
}

function restoreCompletedPortfolioRefresh() {
  const saved = getPortfolioRefreshState();
  const savedSourceDate = getSavedPortfolioSourceDate(saved);
  const expectedQuoteDate = marketSessionData?.expectedQuoteDate || marketSessionData?.marketDate;
  if (
    saved?.complete !== true ||
    savedSourceDate !== expectedQuoteDate ||
    !Array.isArray(saved.quotes) ||
    saved.quotes.length !== saved.total
  ) return false;

  const savedCodes = new Set(saved.quotes.map(quote => {
    const account = /^\d{8}$/.test(String(quote?.symbol || "").trim()) ? "option" : "stock";
    return normalizePortfolioCode(quote?.symbol, account);
  }));
  const requiredCodes = new Set(portfolioPositions.map(position =>
    normalizePortfolioCode(position.code, position.account)
  ));
  ["stock", "option"].forEach(account => {
    getPortfolioTransactionsForDate(account, savedSourceDate).forEach(row => {
      requiredCodes.add(normalizePortfolioCode(row.code, account));
    });
  });
  if ([...requiredCodes].some(code => !savedCodes.has(code))) return false;

  const sourceDates = [...new Set(saved.quotes.map(quote => quote?.sourceDate).filter(Boolean))];
  const complete = sourceDates.length === 1 && saved.quotes.every(quote =>
    quote?.status === "ok" &&
    toFiniteNumberOrNull(quote.price) != null &&
    toFiniteNumberOrNull(quote.previousClose) != null
  );
  if (!complete) return false;

  saved.quotes.forEach(quote => {
    const account = /^\d{8}$/.test(String(quote.symbol || "").trim()) ? "option" : "stock";
    const code = normalizePortfolioCode(quote.symbol, account);
    if (!code) return;
    applyQuoteToLinkedState(code, quote, account);
  });
  if (Array.isArray(saved.underlyingCodes) && Array.isArray(saved.underlyingQuotes)) {
    saved.underlyingCodes.forEach((code, index) => {
      const quote = saved.underlyingQuotes[index];
      if (quote?.status === "ok") portfolioQuoteCache.set(`underlying:${String(code).toUpperCase()}`, quote);
    });
  }
  portfolioDailyProfitReady = true;
  portfolioDailyProfitSourceDate = sourceDates[0];
  syncPortfolioSeriesToLatestQuote();
  const statusNode = document.getElementById("portfolioUpdatedAt");
  if (statusNode) {
    const restoredAt = saved.updatedAt ? new Date(saved.updatedAt) : null;
    const time = restoredAt && !Number.isNaN(restoredAt.getTime())
      ? restoredAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "时间未记录";
    statusNode.textContent = `股票和期权行情已恢复 ${saved.updated}/${saved.total} · ${sourceDates[0]} ${time}`;
  }
  return true;
}

function ensurePortfolioPricesRefreshed() {
  if (portfolioAutoRefreshPromise) return portfolioAutoRefreshPromise;
  portfolioAutoRefreshPromise = loadMarketSession()
    .then(() => {
      const marketDate = marketSessionData?.marketDate || "unknown";
      if (portfolioAutoRefreshAttemptDate === marketDate) return false;
      const decision = portfolioAutoRefreshDecision();
      if (!decision.allowed) {
        const statusNode = document.getElementById("portfolioUpdatedAt");
        if (statusNode && decision.message) statusNode.textContent = decision.message;
        return false;
      }
      portfolioAutoRefreshAttemptDate = marketDate;
      return refreshPortfolioPrices({ silent: true, force: true, trigger: "auto" });
    })
    .catch(() => false)
    .finally(() => {
      portfolioAutoRefreshPromise = null;
    });
  return portfolioAutoRefreshPromise;
}

function getActivePortfolioPeriod() {
  return document.querySelector("#portfolioPeriodFilters button.selected")?.dataset.period || "3m";
}

function renderPortfolioPerformance(filter = "all") {
  const period = getActivePortfolioPeriod();
  const periodLabels = { "1m": "最近 1 个月", "3m": "最近 3 个月", ytd: "今年以来", "1y": "最近 1 年", all: "全部期间" };
  const periodNode = document.getElementById("portfolioPerformancePeriod");
  const container = document.getElementById("portfolioPerformanceKpis");
  const chart = document.getElementById("portfolioPerformanceEmpty");
  const badge = document.querySelector(".portfolio-quality-badge");
  if (!container || !chart) return;

  if (!portfolioPerformanceData || filter === "option") {
    const note = filter === "option" ? "当前交易记录不含期权账户" : "暂无可绘制的历史收益曲线";
    if (periodNode) periodNode.textContent = `${periodLabels[period] || periodLabels["3m"]} · 数据待接入`;
    if (badge) badge.textContent = "历史净值待接入";
    container.innerHTML = ["累计收益", "沪深300同期", "波动率", "最大回撤"]
      .map(label => `<div><span>${label}</span><strong class="muted-change">--</strong></div>`).join("");
    chart.className = "performance-empty";
    chart.innerHTML = `<strong>${note}</strong><span>导入对应账户的历史记录后，可计算现金流调整收益、波动率与最大回撤。</span>`;
    return;
  }

  const series = portfolioSeriesForPeriod(portfolioPerformanceData.series, period);
  const stats = calculatePortfolioSeriesStats(series);
  const totalReturn = stats.totalReturn == null ? "--" : `${stats.totalReturn > 0 ? "+" : ""}${stats.totalReturn.toFixed(2)}%`;
  const benchmarkSeries = portfolioSeriesForPeriod(portfolioPerformanceData.benchmark?.series || [], period);
  const benchmarkReturn = calculateBenchmarkReturn(benchmarkSeries);
  const benchmarkText = benchmarkReturn == null ? "--" : `${benchmarkReturn > 0 ? "+" : ""}${benchmarkReturn.toFixed(2)}%`;
  if (periodNode) {
    const scopeNote = filter === "all" ? "股票账户记录，不含期权" : "股票账户";
    periodNode.textContent = `${periodLabels[period] || periodLabels["3m"]} · ${scopeNote}`;
  }
  if (badge) badge.textContent = `工作估算 · ${series.length} 个交易日`;
  container.innerHTML = [
    ["累计收益", totalReturn, stats.totalReturn >= 0 ? "positive" : "negative"],
    ["沪深300同期", benchmarkText, benchmarkReturn == null ? "muted-change" : benchmarkReturn >= 0 ? "positive" : "negative"],
    ["年化波动率", stats.volatility == null ? "--" : `${stats.volatility.toFixed(2)}%`, "neutral"],
    ["最大回撤", stats.maxDrawdown == null ? "--" : `${stats.maxDrawdown.toFixed(2)}%`, "negative"],
  ].map(([label, value, tone]) => `<div><span>${label}</span><strong class="${tone}">${value}</strong></div>`).join("");
  chart.className = "performance-chart-shell";
  chart.innerHTML = renderPortfolioPerformanceChart(series, stats);
}

function calculateBenchmarkReturn(series) {
  if (series.length < 2) return null;
  const first = Number(series[0].close);
  const last = Number(series.at(-1).close);
  return first > 0 && Number.isFinite(last) ? (last / first - 1) * 100 : null;
}

function portfolioSeriesForPeriod(series, period) {
  if (!series.length || period === "all") return series;
  const end = new Date(`${series.at(-1).date}T00:00:00Z`);
  const start = new Date(end);
  if (period === "1m") start.setUTCMonth(start.getUTCMonth() - 1);
  else if (period === "3m") start.setUTCMonth(start.getUTCMonth() - 3);
  else if (period === "ytd") start.setUTCMonth(0, 1);
  else if (period === "1y") start.setUTCFullYear(start.getUTCFullYear() - 1);
  const cutoff = start.toISOString().slice(0, 10);
  return series.filter(point => point.date >= cutoff);
}

function calculatePortfolioSeriesStats(series) {
  if (series.length < 2) return { totalReturn: null, volatility: null, maxDrawdown: null };
  const first = Number(series[0].twrIndex);
  const last = Number(series.at(-1).twrIndex);
  const totalReturn = first ? (last / first - 1) * 100 : null;
  const daily = series.slice(1).map(point => Number(point.dailyReturn) / 100).filter(Number.isFinite);
  let volatility = null;
  if (daily.length >= 10) {
    const average = daily.reduce((sum, value) => sum + value, 0) / daily.length;
    const variance = daily.reduce((sum, value) => sum + (value - average) ** 2, 0) / (daily.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }
  let peak = -Infinity;
  let maxDrawdown = 0;
  series.forEach(point => {
    const value = Number(point.twrIndex);
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (value / peak - 1) * 100);
  });
  return { totalReturn, volatility, maxDrawdown };
}

function renderPortfolioPerformanceChart(series, stats) {
  if (series.length < 2) return `<div class="performance-empty"><strong>区间数据不足</strong></div>`;
  const width = 820;
  const height = 210;
  const pad = { left: 12, right: 12, top: 18, bottom: 28 };
  const values = series.map(point => Number(point.twrIndex));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const x = index => pad.left + index / (series.length - 1) * (width - pad.left - pad.right);
  const y = value => pad.top + (max - value) / spread * (height - pad.top - pad.bottom);
  const path = series.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(Number(point.twrIndex)).toFixed(1)}`).join(" ");
  const baselineY = 100 >= min && 100 <= max ? y(100) : null;
  const tone = stats.totalReturn >= 0 ? "positive" : "negative";
  return `
    <svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="现金流调整后的股票账户收益曲线">
      <line x1="${pad.left}" y1="${y(max).toFixed(1)}" x2="${width - pad.right}" y2="${y(max).toFixed(1)}" class="chart-grid-line" />
      <line x1="${pad.left}" y1="${y(min).toFixed(1)}" x2="${width - pad.right}" y2="${y(min).toFixed(1)}" class="chart-grid-line" />
      ${baselineY == null ? "" : `<line x1="${pad.left}" y1="${baselineY.toFixed(1)}" x2="${width - pad.right}" y2="${baselineY.toFixed(1)}" class="chart-baseline" />`}
      <path d="${path}" class="performance-series ${tone}" />
      <circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(values.at(-1)).toFixed(1)}" r="4" class="performance-endpoint ${tone}" />
      <text x="${pad.left}" y="${height - 7}" class="chart-axis-label">${series[0].date.slice(5)}</text>
      <text x="${width - pad.right}" y="${height - 7}" text-anchor="end" class="chart-axis-label">${series.at(-1).date.slice(5)}</text>
      <text x="${pad.left}" y="${Math.max(12, y(max) - 5).toFixed(1)}" class="chart-value-label">${max.toFixed(1)}</text>
      <text x="${pad.left}" y="${Math.min(height - 31, y(min) + 15).toFixed(1)}" class="chart-value-label">${min.toFixed(1)}</text>
    </svg>
    <div class="performance-chart-note"><span>基准 100 · 已按资金余额变化调整${portfolioPerformanceData.latestPointEstimate ? " · 最新点为跨日工作估算" : ""}</span><span>${portfolioPerformanceData.sourceFile} · ${portfolioPerformanceData.period.start}—${portfolioPerformanceData.period.end}</span></div>`;
}

function renderPortfolioContribution(filter = "all") {
  const container = document.getElementById("portfolioContribution");
  if (!container) return;
  const positions = [...getPortfolioPositions(filter)].sort((a, b) => Math.abs(portfolioProfit(b)) - Math.abs(portfolioProfit(a)));
  const max = Math.max(...positions.map(item => Math.abs(portfolioProfit(item))), 1);
  container.innerHTML = positions.slice(0, 6).map(position => {
    const profit = portfolioProfit(position);
    const width = Math.max(4, Math.abs(profit) / max * 100);
    return `<div class="contribution-row">
      <div><span>${escapeHtml(position.name)}</span><strong class="${profit >= 0 ? "positive" : "negative"}">${formatPortfolioSigned(profit)}</strong></div>
      <div class="contribution-track"><i class="${profit >= 0 ? "gain" : "loss"}" style="width:${width.toFixed(1)}%"></i></div>
    </div>`;
  }).join("");
}

function getActivePortfolioFilter() {
  return document.querySelector("#portfolioAccountFilters button.selected")?.dataset.accountFilter || "all";
}

function renderPortfolioHoldings(filter = "all") {
  const body = document.getElementById("portfolioHoldingsBody");
  if (!body) return;
  const rows = portfolioPositions.filter(position => filter === "all" || position.account === filter);
  body.innerHTML = rows.map(position => {
    const daily = portfolioDailyProfit(position);
    const total = portfolioProfit(position);
    const costBasis = Number(position.costBasis || 0);
    const holdingReturn = costBasis > 0 ? total / costBasis * 100 : null;
    const priceDecimals = position.account === "option" ? 4 : 3;
    const priceDisplay = position.quoteStatus === "failed"
      ? `<span class="portfolio-price-missing" title="${escapeHtml(position.quoteError || "本轮行情未返回")}">未接入</span>`
      : `<strong>${formatPortfolioMoney(position.price, priceDecimals)}</strong>`;
    return `
      <tr>
        <td><strong>${escapeHtml(position.name)}${position.financing ? '<em class="position-financing-tag">融资</em>' : ""}</strong><span>${escapeHtml(position.displayCode || position.code)}</span></td>
        <td><span class="pill ${position.account === "stock" ? "blue" : "muted"}">${position.account === "stock" ? "股票" : escapeHtml(position.optionType)}</span></td>
        <td class="number-cell">${formatPortfolioMoney(position.quantity, 0)}${position.account === "option" ? " 张" : " 股"}</td>
        <td class="number-cell">${formatPortfolioMoney(position.cost, priceDecimals)}</td>
        <td class="number-cell">${priceDisplay}</td>
        <td class="number-cell">${formatPortfolioMoney(portfolioMarketValue(position))}</td>
        <td class="number-cell ${daily == null ? "muted-change" : daily >= 0 ? "positive" : "negative"}">${daily == null ? "--" : formatPortfolioSigned(daily)}</td>
        <td class="number-cell portfolio-profit-cell ${total >= 0 ? "positive" : "negative"}">
          <strong>${formatPortfolioSigned(total)}</strong>
          <span>${holdingReturn == null ? "收益率待计算" : `收益率 ${holdingReturn > 0 ? "+" : ""}${holdingReturn.toFixed(2)}%`}</span>
        </td>
      </tr>`;
  }).join("");
}

function renderPortfolioAllocation(filter = "all") {
  const container = document.getElementById("portfolioAllocation");
  if (!container) return;
  const positions = getPortfolioPositions(filter);
  const stockValue = positions.filter(item => item.account === "stock").reduce((sum, item) => sum + portfolioMarketValue(item), 0);
  const optionValue = positions.filter(item => item.account === "option").reduce((sum, item) => sum + portfolioMarketValue(item), 0);
  const cash = portfolioCashForFilter(filter);
  const financingLiability = filter === "option" ? 0 : Number(portfolioAccounts.stock.financingLiability || 0);
  const total = stockValue + optionValue + cash;
  const rows = [
    ["股票持仓", stockValue, "stock", false],
    ["期权持仓", optionValue, "option", false],
    ["可用资金", cash, "cash", false],
    ["融资负债本金", financingLiability, "liability", true],
  ].filter(([, value]) => value > 0);
  container.innerHTML = rows.map(([label, value, tone, isLiability]) => {
    const percent = total ? value / total * 100 : 0;
    return `
      <div class="allocation-row">
        <div><span>${label}</span><strong>${percent.toFixed(1)}%</strong></div>
        <div class="allocation-track"><i class="${tone}" style="width:${percent.toFixed(1)}%"></i></div>
        <em>${isLiability ? "−" : ""}${formatPortfolioMoney(value)} CNY</em>
      </div>`;
  }).join("");
}

function renderPortfolioOptionRisk(filter = "all") {
  const container = document.getElementById("portfolioOptionRisk");
  if (!container) return;
  const options = getPortfolioPositions(filter).filter(item => item.account === "option");
  if (!options.length) {
    container.innerHTML = `<div class="option-risk-empty"><strong>当前筛选不含期权</strong><em>切换到全部组合或期权账户查看风险占比。</em></div>`;
    return;
  }
  const optionValue = options.reduce((sum, item) => sum + portfolioMarketValue(item), 0);
  const optionCost = options.reduce((sum, item) => sum + item.costBasis, 0);
  const totalValue = portfolioSnapshot(filter).totalAssets;
  const items = [
    ["净 Delta", "待接入", "需要实时 Greeks"],
    ["期权市值占比", `${(optionValue / totalValue * 100).toFixed(1)}%`, "账户总资产"],
    ["到期月份", "7月 / 9月", "全部为买入持仓"],
    ["持仓总成本", formatPortfolioMoney(optionCost), "账户截图原值"],
  ];
  container.innerHTML = items.map(([label, value, note]) => `
    <div><span>${label}</span><strong>${value}</strong><em>${note}</em></div>`).join("");
}

function attachPortfolioActions() {
  const filters = document.getElementById("portfolioAccountFilters");
  filters?.addEventListener("click", event => {
    const button = event.target.closest("button[data-account-filter]");
    if (!button) return;
    filters.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === button));
    renderPortfolio();
  });

  document.getElementById("portfolioPositionReviews")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-position-review-path]");
    if (button?.dataset.positionReviewPath) openFullscreenPreview(button.dataset.positionReviewPath);
  });

  const periods = document.getElementById("portfolioPeriodFilters");
  periods?.addEventListener("click", event => {
    const button = event.target.closest("button[data-period]");
    if (!button) return;
    periods.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === button));
    renderPortfolioPerformance(getActivePortfolioFilter());
  });

  const modal = document.getElementById("portfolioImportModal");
  const closeModal = () => { modal.hidden = true; };
  document.getElementById("portfolioImportBtn")?.addEventListener("click", () => { modal.hidden = false; });
  document.getElementById("portfolioImportClose")?.addEventListener("click", closeModal);
  document.getElementById("portfolioImportCancel")?.addEventListener("click", closeModal);
  modal?.addEventListener("click", event => { if (event.target === modal) closeModal(); });

  document.getElementById("portfolioImportType")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-import-type]");
    if (!button) return;
    button.parentElement.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === button));
  });

  const fileInput = document.getElementById("portfolioFileInput");
  fileInput?.addEventListener("change", () => {
    document.getElementById("portfolioFileName").textContent = fileInput.files?.[0]?.name || "尚未选择文件";
  });

  document.getElementById("portfolioImportPreview")?.addEventListener("click", () => {
    const type = document.querySelector("#portfolioImportType button.selected")?.dataset.importType || "stock";
    const typeLabel = type === "stock" ? "股票账户" : "期权账户";
    const fileName = fileInput?.files?.[0]?.name;
    document.getElementById("portfolioUpdatedAt").textContent = fileName
      ? `${typeLabel}文件已选择：${fileName} · 尚未解析，持仓数据未改变`
      : "尚未选择文件，持仓数据未改变";
    if (fileName) closeModal();
  });

  document.getElementById("portfolioRefreshBtn")?.addEventListener("click", async () => {
    await loadMarketSession();
    await refreshPortfolioPrices({ force: true, trigger: "manual" });
  });
}

async function refreshPortfolioPrices(options = {}) {
  const { silent = false, force = false, trigger = "manual" } = options;
  const button = document.getElementById("portfolioRefreshBtn");
  const statusNode = document.getElementById("portfolioUpdatedAt");
  const canUseButton = Boolean(button);
  if (canUseButton && button.disabled && !force) return false;
  const original = canUseButton ? button.textContent : "";
  if (canUseButton) {
    button.disabled = true;
    button.textContent = "正在刷新股票和期权行情...";
  }
  if (silent && statusNode) {
    statusNode.textContent = "正在自动刷新股票和期权行情...";
  }
  const positions = portfolioPositions.filter(position => position.account === "stock" || position.account === "option");
  const previousState = {
    dailyProfitReady: portfolioDailyProfitReady,
    dailyProfitSourceDate: portfolioDailyProfitSourceDate,
    quoteCache: new Map(portfolioQuoteCache),
    positions: portfolioPositions.map(position => ({
      position,
      price: position.price,
      previousClose: position.previousClose,
      quoteStatus: position.quoteStatus,
      quoteError: position.quoteError,
      marketValue: position.marketValue,
      profit: position.profit,
      quote: position.quote,
      optionQuote: position.optionQuote,
    })),
    objects: objects.map(object => ({
      object,
      quote: object.quote,
      detailSummary: object.detailSummary,
    })),
  };
  const restorePreviousState = () => {
    portfolioDailyProfitReady = previousState.dailyProfitReady;
    portfolioDailyProfitSourceDate = previousState.dailyProfitSourceDate;
    portfolioQuoteCache.clear();
    previousState.quoteCache.forEach((quote, key) => portfolioQuoteCache.set(key, quote));
    previousState.positions.forEach(snapshot => {
      snapshot.position.price = snapshot.price;
      snapshot.position.previousClose = snapshot.previousClose;
      snapshot.position.quoteStatus = snapshot.quoteStatus;
      snapshot.position.quoteError = snapshot.quoteError;
      snapshot.position.marketValue = snapshot.marketValue;
      snapshot.position.profit = snapshot.profit;
      snapshot.position.quote = snapshot.quote;
      snapshot.position.optionQuote = snapshot.optionQuote;
    });
    previousState.objects.forEach(snapshot => {
      snapshot.object.quote = snapshot.quote;
      snapshot.object.detailSummary = snapshot.detailSummary;
    });
  };
  const asOfDate = getPortfolioAsOfDate();
  const transactionTargets = ["stock", "option"].flatMap(account =>
    getPortfolioTransactionsForDate(account, asOfDate)
      .map(row => ({ account, code: normalizePortfolioCode(row.code, account) }))
      .filter(target => target.code)
  );
  const refreshTargets = [...positions];
  const seenCodes = new Set(positions.map(position => normalizePortfolioCode(position.code, position.account)));
  transactionTargets.forEach(target => {
    const code = normalizePortfolioCode(target.code, target.account);
    if (seenCodes.has(code)) return;
    seenCodes.add(code);
    refreshTargets.push(target);
  });
  let updated = 0;
  const failures = [];
  try {
    if (statusNode) {
      statusNode.textContent = `${silent ? "正在自动刷新" : "正在刷新"}股票和期权行情...`;
    }
    const quotes = new Array(refreshTargets.length);
    const groups = ["stock", "option"].map(account => refreshTargets
      .map((target, index) => ({ target, index }))
      .filter(item => item.target.account === account));
    for (const group of groups) {
      if (!group.length) continue;
      const symbols = group.map(({ target }) => String(target.code || "").trim()).join(",");
      const markets = group.map(({ target }) => target.account === "option" ? "期权" : "A股").join(",");
      const underlyings = group.map(({ target }) => {
        if (target.account !== "option") return "";
        return target.underlying || portfolioPositions.find(position => position.code === target.code)?.underlying || "";
      }).join(",");
      const payload = await fetchReadJson(
        `/api/read/quotes?symbols=${encodeURIComponent(symbols)}&markets=${encodeURIComponent(markets)}&underlyings=${encodeURIComponent(underlyings)}`,
        "quotes",
        { timeoutMs: group[0].target.account === "option" ? 120000 : 30000 },
      );
      const groupQuotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
      group.forEach(({ target, index }, groupIndex) => {
        const result = groupQuotes[groupIndex];
        quotes[index] = result;
        const price = toFiniteNumberOrNull(result?.price);
        const previousClose = toFiniteNumberOrNull(result?.previousClose);
        const code = normalizePortfolioCode(target.code, target.account);
        if (result?.status !== "ok" || price == null || previousClose == null || !result?.sourceDate) {
          failures.push(`${target.code}:${result?.message || result?.status || "bad payload"}`);
          applyQuoteToLinkedState(code, result || { status: "source_gap", message: "行情未返回" }, target.account);
          return;
        }
        applyQuoteToLinkedState(code, result, target.account);
        updated += 1;
      });
    }
    const underlyingCodes = [...new Set(quotes.map(quote => String(quote?.underlyingCode || "").trim()).filter(Boolean))];
    let underlyingQuotes = [];
    if (underlyingCodes.length) {
      const underlyingPayload = await fetchReadJson(
        `/api/read/quotes?symbols=${encodeURIComponent(underlyingCodes.join(","))}&markets=${encodeURIComponent(underlyingCodes.map(() => "A股").join(","))}`,
        "quotes",
        { timeoutMs: 15000 },
      );
      underlyingQuotes = Array.isArray(underlyingPayload?.quotes) ? underlyingPayload.quotes : [];
      underlyingCodes.forEach((code, index) => {
        const quote = underlyingQuotes[index];
        if (quote?.status === "ok") portfolioQuoteCache.set(`underlying:${code.toUpperCase()}`, quote);
      });
    }
    const sourceDates = [...new Set(quotes.map(quote => quote?.sourceDate).filter(Boolean))];
    const refreshComplete = (
      quotes.length === refreshTargets.length &&
      failures.length === 0 &&
      updated === refreshTargets.length &&
      sourceDates.length === 1
    );
    if (refreshComplete) {
      portfolioDailyProfitReady = true;
      portfolioDailyProfitSourceDate = sourceDates[0];
      syncPortfolioSeriesToLatestQuote();
      await syncPortfolioBenchmarkToLatest();
    } else {
      restorePreviousState();
    }
    if (refreshComplete) {
      const stockSnapshot = portfolioSnapshot("stock");
      const seriesPoint = portfolioPerformanceData?.series?.find(point => point.date === sourceDates[0]);
      const benchmarkClose = portfolioPerformanceData?.benchmark?.series?.find(point => point.date === sourceDates[0])?.close ?? "";
      await fetchOperationJson("/api/ops/portfolio-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: sourceDates[0], seriesPoint, stockMarketValue: stockSnapshot.marketValue,
          stockCash: stockSnapshot.cash, stockDailyProfit: computePortfolioAccountDailyProfit("stock", sourceDates[0]), benchmarkClose,
          positions: portfolioPositions.map(position => ({
            account: position.account, code: position.code, name: position.name, quantity: position.quantity,
            cost: position.cost, multiplier: portfolioMultiplier(position), price: position.price,
            previousClose: position.previousClose, marketValue: portfolioMarketValue(position), profit: portfolioProfit(position),
            quoteStatus: position.quoteStatus, source: position.optionQuote?.provider || position.quote?.provider || "portfolio_refresh",
          })),
        }),
      });
    }
    const expectedQuoteDate = marketSessionData?.expectedQuoteDate || marketSessionData?.marketDate;
    const refreshedForExpectedDate = refreshComplete && sourceDates.includes(expectedQuoteDate);
    if (refreshedForExpectedDate) {
      localStorage.setItem(PORTFOLIO_REFRESH_STATE_KEY, JSON.stringify({
        marketDate: sourceDates[0],
        sourceDate: sourceDates[0],
        complete: true,
        trigger,
        updatedAt: new Date().toISOString(),
        updated,
        total: refreshTargets.length,
        sourceDates,
        quotes,
        underlyingCodes,
        underlyingQuotes,
      }));
    }
    renderPortfolio();
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    if (document.getElementById("detailView")?.classList.contains("active")) renderDetailShell();
    const now = new Date();
    if (statusNode) {
      statusNode.textContent = refreshComplete
        ? `${trigger === "auto" ? "收盘行情已自动更新" : "行情已手动更新"} ${updated}/${refreshTargets.length} · ${formatBeijingTime(now, false)} 北京时间`
        : updated
          ? `行情仅返回 ${updated}/${refreshTargets.length}，未采用本轮数据 · 已保留刷新前行情和今日收益`
          : `行情更新失败，已保留刷新前行情和今日收益${failures.length ? ` · ${failures[0]}` : ""}`;
    }
    return refreshComplete;
  } catch (error) {
    restorePreviousState();
    renderPortfolio();
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    if (statusNode) {
      statusNode.textContent = "行情更新失败，已保留刷新前行情和今日收益";
    }
    return false;
  } finally {
    if (canUseButton) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function filterObjectsWithIndex(filter) {
  return objects
    .map((object, sourceIndex) => ({ object, sourceIndex }))
    .filter(({ object }) => filter === "all" || object.market === filter)
    .sort(compareObjectFreshness);
}

function compareObjectFreshness(a, b) {
  const holdingRank = Number(isPortfolioHolding(b.object)) - Number(isPortfolioHolding(a.object));
  if (holdingRank !== 0) return holdingRank;
  const rank = { fresh: 0, needs_refresh: 1, stale: 2 };
  const stateRank = (rank[a.object.stale] ?? 9) - (rank[b.object.stale] ?? 9);
  if (stateRank !== 0) return stateRank;
  const modifiedRank = Number(b.object.latestModifiedAt || 0) - Number(a.object.latestModifiedAt || 0);
  if (modifiedRank !== 0) return modifiedRank;
  return String(a.object.name || a.object.ticker).localeCompare(String(b.object.name || b.object.ticker), "zh-Hans-CN");
}

function isPortfolioHolding(object) {
  const ticker = normalizePortfolioCode(object?.ticker, "stock");
  if (!ticker) return false;
  return portfolioPositions.some(position => position.account === "stock" && normalizePortfolioCode(position.code, position.account) === ticker);
}

function renderCards(filter = "all") {
  const cards = document.getElementById("researchCards");
  const rows = filterObjectsWithIndex(filter);
  const count = document.getElementById("overviewCount");
  if (count) count.textContent = rows.length;
  if (!rows.length) {
    cards.innerHTML = `<tr><td colspan="9" class="empty-table-cell">当前没有${filter === "all" ? "" : escapeHtml(filter)}标的</td></tr>`;
    return;
  }

  cards.innerHTML = rows.map(({ object: o, sourceIndex }) => `
    <tr class="research-overview-row ${isPortfolioHolding(o) ? "portfolio-holding" : ""}" data-open-detail="${sourceIndex}" data-search-text="${escapeHtml(searchTextForObject(o))}" tabindex="0">
      <td><strong class="research-symbol">${escapeHtml(o.ticker || "—")}</strong></td>
      <td>
        <div class="research-company-cell">
          <strong>${escapeHtml(o.name || o.ticker || "未命名")}</strong>
          <span>${escapeHtml(o.market || "未分类")}</span>
          ${isPortfolioHolding(o) ? `<span class="overview-holding-mark">持仓</span>` : ""}
        </div>
      </td>
      <td class="number-cell research-price">${escapeHtml(formatQuotePrice(o))}</td>
      <td class="number-cell"><strong class="research-change ${changeClass(formatQuoteChange(o))}">${escapeHtml(formatQuoteChange(o) || "—")}</strong></td>
      <td class="number-cell"><span class="research-volume-ratio">${escapeHtml(formatQuoteVolumeRatio(o))}</span></td>
      <td><span class="research-industry">${escapeHtml(formatQuoteIndustry(o))}</span></td>
      <td>${renderOverviewTrendCapsule(o)}</td>
      <td><span class="research-state" title="${escapeHtml(o.state || "")}">${escapeHtml(researchStateLabel(o.state))}</span></td>
      <td><span class="freshness-status ${o.stale === "stale" ? "red" : o.stale === "needs_refresh" ? "amber" : "green"}"><i></i>${refreshLabel(o.stale)}</span></td>
    </tr>`).join("");
  applySearch(getCurrentSearchQuery());
  cards.onclick = event => {
    const row = event.target.closest("[data-open-detail]");
    if (row) openDetail(Number(row.dataset.openDetail));
  };
  cards.onkeydown = event => {
    if (!["Enter", " "].includes(event.key)) return;
    const row = event.target.closest("[data-open-detail]");
    if (!row) return;
    event.preventDefault();
    openDetail(Number(row.dataset.openDetail));
  };
}

function researchStateLabel(state) {
  const labels = {
    indexed: "已索引",
    portfolio_only: "仅持仓",
    working_view: "工作视图",
    watch_only: "观察",
    watch: "观察",
    hold: "持有跟踪",
    needs_refresh: "待刷新",
    starter_only: "初步研究",
    source_gap: "证据缺口",
  };
  return labels[state] || state || "未标注";
}

function changeClass(change) {
  if (!change) return "muted-change";
  return String(change).startsWith("+") ? "positive" : "negative";
}

function formatQuotePrice(object) {
  if (object.quote?.status === "loading") return "接入中";
  if (object.quote?.status === "ok" && object.quote.price != null) {
    return Number(object.quote.price).toFixed(2);
  }
  if (!bootstrapMeta.apiConnected) return "待接入";
  return object.price || "待接入";
}

function formatQuoteChange(object) {
  if (object.quote?.status === "ok" && object.quote.changePct != null) {
    const pct = Number(object.quote.changePct);
    if (!Number.isFinite(pct)) return "";
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
  }
  return "";
}

function formatQuoteVolumeRatio(object) {
  const value = toFiniteNumberOrNull(object.quote?.volumeRatio);
  return object.quote?.status === "ok" && value != null ? value.toFixed(2) : "—";
}

function formatQuoteIndustry(object) {
  return object.quote?.industry || object.industry || (object.market === "ETF" ? "ETF" : "—");
}

function getCompactTrendText(object) {
  const text = String(getMiraTrendText(object) || "").trim();
  if (!text) return "";
  const firstClause = text.split(/[。；;]/)[0].trim();
  return firstClause.length > 22 ? `${firstClause.slice(0, 22)}…` : firstClause;
}

function renderOverviewTrendCapsule(object) {
  const trendText = getCompactTrendText(object) || "待读取";
  const levels = normalizeMiraLevels(object.quote?.miraLevels || []).slice(0, 6);
  const currentPrice = overviewTrendCurrentPrice(object);
  const selectedLevel = selectOverviewTrendLevel(levels, currentPrice);
  if (!selectedLevel) {
    const pendingTone = isEmphasizedTrend(object) ? "risk" : "pending";
    return `
      <div class="overview-trend-capsule ${pendingTone}" title="${escapeHtml(getMiraTrendText(object))}">
        <b>${isEmphasizedTrend(object) ? "关键提醒" : "点位待读取"}</b>
        <div class="overview-trend-rail" style="--trend-pos: 50%"><i></i></div>
        <em>未解析</em>
        <small>${escapeHtml(trendText)}</small>
      </div>`;
  }

  const tone = overviewTrendToneClass(object, selectedLevel);
  const position = overviewTrendRailPosition(levels, currentPrice, selectedLevel);
  const label = overviewTrendCapsuleLabel(object, selectedLevel);
  const range = formatMiraLevelRange(selectedLevel);
  return `
    <div class="overview-trend-capsule ${tone}" title="${escapeHtml(getMiraTrendText(object))}">
      <b>${escapeHtml(label)}</b>
      <div class="overview-trend-rail" style="--trend-pos: ${position}%"><i></i></div>
      <em>${escapeHtml(range)}</em>
      <small>${escapeHtml(trendText)}</small>
    </div>`;
}

function overviewTrendCurrentPrice(object) {
  const quotePrice = Number(object.quote?.price);
  if (Number.isFinite(quotePrice)) return quotePrice;
  const fallbackPrice = Number(object.price);
  return Number.isFinite(fallbackPrice) ? fallbackPrice : null;
}

function selectOverviewTrendLevel(levels, currentPrice) {
  if (!levels.length) return null;
  if (!Number.isFinite(currentPrice)) return levels[0];
  return levels
    .map(level => ({
      level,
      distance: currentPrice >= level.low && currentPrice <= level.high
        ? 0
        : Math.min(Math.abs(currentPrice - level.low), Math.abs(currentPrice - level.high), Math.abs(currentPrice - level.value)),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.level || levels[0];
}

function overviewTrendRailPosition(levels, currentPrice, selectedLevel) {
  const values = levels.flatMap(level => [level.low, level.high, level.value]);
  const current = Number.isFinite(currentPrice) ? currentPrice : selectedLevel.value;
  values.push(current);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) return 50;
  const padding = (maxValue - minValue) * 0.12;
  minValue -= padding;
  maxValue += padding;
  const percent = ((current - minValue) / (maxValue - minValue)) * 100;
  return Math.max(6, Math.min(94, Math.round(percent)));
}

function overviewTrendToneClass(object, level) {
  const label = String(level?.label || "");
  if (label.includes("失效") || label.includes("跌破") || isEmphasizedTrend(object)) return "risk";
  if (label.includes("确认") || label.includes("支撑") || label.includes("承接")) return "mira";
  return "auto";
}

function overviewTrendCapsuleLabel(object, level) {
  const trend = String(getMiraTrendText(object) || "");
  const label = String(level?.label || "");
  if (trend.includes("防守确认")) return "防守确认";
  if (label.includes("失效") || label.includes("跌破")) return "失效位";
  if (label.includes("确认")) return "趋势确认区";
  if (label.includes("支撑") || label.includes("承接")) return "承接区";
  if (label.includes("压力")) return "压力区";
  return label || "走势点位";
}

function isEmphasizedTrend(object) {
  const trend = String(getMiraTrendText(object) || "").trim().toLowerCase();
  if (!trend) return false;
  if (/(?:尚无|未|待|没有|缺乏|不构成).{0,8}(?:确认|反转|突破)/.test(trend)) return false;
  if (/\b(?:uptrend_confirmed|downtrend_confirmed|reversal_confirmed|breakout_confirmed|breakdown_confirmed|defense_confirmed|support_confirmed)\b/.test(trend)) return true;
  return /上升趋势确认|上行确认|下降趋势确认|下行趋势确认|反转确认|反转已确认|趋势反转|突破确认|跌破确认|失效确认|防守确认|跌破|失效/.test(trend);
}

function quoteMetaLine(object) {
  if (object.quote?.status === "loading") {
    return `${object.quote.provider || "quote"} · 请求中`;
  }
  if (object.quote?.status === "ok") {
    return `${object.quote.provider || "quote"} · ${object.quote.sourceDate || "date unavailable"} · ${object.quote.normalizedSymbol || object.ticker}`;
  }
  if (object.quote?.status === "source_gap") {
    return `${object.quote.provider || "quote"} · ${object.quote.message || "source_gap"}`;
  }
  return object.trend || "等待 Mira 索引";
}

function refreshLabel(stale) {
  const labels = {
    fresh: "新鲜",
    needs_refresh: "待刷新",
    stale: "过期",
  };
  return labels[stale] || stale || "未知";
}

function renderRadar() {
  const radar = document.getElementById("radarList");
  if (!radar) return;
  const rows = buildRadarRows().slice(0, 4).map(item => [item.title, item.meta]);
  radar.innerHTML = rows.map(([title, meta]) => `<div class="radar-item"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div>`).join("");
}

function buildRadarRows() {
  const rows = objects.flatMap((object, objectIndex) => {
    const rowSet = [];
    const objectLabel = `${object.ticker} ${object.name}`;
    if (object.stale === "stale") {
      rowSet.push({ priority: 1, tone: "red", objectIndex, title: "已过期", meta: `${objectLabel} · 需要刷新行情和 memo 摘要` });
    }
    if (object.stale === "needs_refresh") {
      rowSet.push({ priority: 2, tone: "amber", objectIndex, title: "待刷新", meta: `${objectLabel} · stale_after 或触发条件接近` });
    }
    if (object.trend.includes("反转")) {
      rowSet.push({ priority: 3, tone: "blue", objectIndex, title: "反转尝试", meta: `${objectLabel} · 需要确认价格、量能和行业宽度` });
    }
    if (object.trend.includes("失效")) {
      rowSet.push({ priority: 1, tone: "red", objectIndex, title: "接近失效位", meta: `${objectLabel} · 优先检查 invalidation_level` });
    }
    return rowSet;
  });

  rows.push({ priority: 4, tone: "muted", objectIndex: selectedObjectIndex, title: "资料待读", meta: "当前对象资料库 · 只读资料需要绑定到证据日志后再引用" });
  return rows.sort((a, b) => a.priority - b.priority);
}

function renderRadarFocus() {
  const list = document.getElementById("radarFocusList");
  if (!list) return;
  list.innerHTML = buildRadarRows().map((item, index) => `
    <article class="radar-focus-card ${item.tone}">
      <div class="radar-rank">${index + 1}</div>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.meta)}</span>
      </div>
      <button class="ghost-btn" data-radar-open="${item.objectIndex}">查看</button>
    </article>`).join("");
}

function renderTargets(filter = "all") {
  const body = document.getElementById("targetsTableBody");
  if (!body) return;
  const rows = filterObjectsWithIndex(filter);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty-table-cell">当前没有${filter === "all" ? "" : escapeHtml(filter)}标的</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(({ object, sourceIndex }) => `
    <tr data-open-detail="${sourceIndex}" data-search-text="${escapeHtml(searchTextForObject(object))}">
      <td><strong>${escapeHtml(object.name || object.ticker)}</strong><span>${escapeHtml(object.ticker)} · ${escapeHtml(object.market)}</span></td>
      <td>${escapeHtml(object.market)}</td>
      <td><strong>${escapeHtml(formatQuotePrice(object))}</strong>${formatQuoteChange(object) ? `<em class="${changeClass(formatQuoteChange(object))}">${escapeHtml(formatQuoteChange(object))}</em>` : ""}</td>
      <td><span class="pill muted">${escapeHtml(researchStateLabel(object.state))}</span></td>
      <td>${escapeHtml(getMiraTrendText(object))}</td>
      <td><span class="pill ${object.stale === "stale" ? "red" : object.stale === "needs_refresh" ? "amber" : "green"}">${escapeHtml(refreshLabel(object.stale))}</span></td>
    </tr>`).join("");
  applySearch(getCurrentSearchQuery());
}

function renderTargetFilters() {
  const filters = document.getElementById("targetFilters");
  if (!filters) return;
  filters.innerHTML = buildMarketFilterButtons();
}

function searchTextForObject(object) {
  return `${object.ticker || ""} ${object.name || ""} ${object.market || ""} ${formatQuoteIndustry(object)} ${object.trend || ""} ${object.state || ""}`.toLowerCase();
}

function renderOverviewFilters() {
  const filters = document.getElementById("overviewFilters");
  if (!filters) return;
  filters.innerHTML = buildMarketFilterButtons();
}

function buildMarketFilterButtons() {
  const baseFilters = [
    ["A股", "A 股"],
    ["港股", "港股"],
    ["美股", "美股"],
    ["大宗商品", "大宗商品"],
    ["ETF", "ETF"],
  ];
  const known = new Set(baseFilters.map(([value]) => value));
  const extraMarkets = [...new Set(objects.map(object => object.market).filter(Boolean))]
    .filter(market => !known.has(market) && market !== "期权")
    .sort();

  return [...baseFilters, ...extraMarkets.map(market => [market, market])]
    .map(([value, label], index) => `<button class="${index === 0 ? "selected" : ""}" data-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
    .join("");
}

function attachOverviewFilters() {
  const filters = document.getElementById("overviewFilters");
  if (!filters) return;
  filters.addEventListener("click", event => {
    const btn = event.target.closest("button[data-filter]");
    if (!btn) return;
    filters.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === btn));
    renderCards(btn.dataset.filter);
  });
}

function getActiveOverviewFilter() {
  return document.querySelector("#overviewFilters button.selected")?.dataset.filter || "A股";
}

function attachTargetFilters() {
  const filters = document.getElementById("targetFilters");
  const table = document.getElementById("targetsTableBody");
  if (!filters || !table) return;
  filters.addEventListener("click", event => {
    const btn = event.target.closest("button[data-filter]");
    if (!btn) return;
    filters.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === btn));
    renderTargets(btn.dataset.filter);
  });
  table.addEventListener("click", event => {
    const row = event.target.closest("tr[data-open-detail]");
    if (row) openDetail(Number(row.dataset.openDetail));
  });
}

function getActiveTargetFilter() {
  return document.querySelector("#targetFilters button.selected")?.dataset.filter || "A股";
}

function attachRadarFocus() {
  const list = document.getElementById("radarFocusList");
  if (!list) return;
  list.addEventListener("click", event => {
    const btn = event.target.closest("[data-radar-open]");
    if (btn) openDetail(Number(btn.dataset.radarOpen));
  });
}

function setOverviewRefreshStatus(message, tone = "muted") {
  const status = document.getElementById("overviewQuoteStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.setAttribute("aria-live", "polite");
}

async function showBatchPriceRefresh({ force = false } = {}) {
  setOverviewRefreshStatus("正在同步研究标的…", "active");
  await syncResearchObjects();
  if (!marketSessionData) await loadMarketSession();
  const radar = document.getElementById("radarList");
  const quoteObjects = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => object.ticker && ["A股", "ETF", "港股", "美股"].includes(object.market));
  const count = quoteObjects.length;
  const archiveDate = currentOverviewArchiveDate();
  const canArchiveExpectedClose = marketSessionData?.archiveAllowed === true;
  const sameDayArchive = canArchiveExpectedClose && overviewQuoteArchiveDate === archiveDate;
  const fetchTargets = force
    ? quoteObjects
    : sameDayArchive
    ? quoteObjects.filter(({ object }) => overviewArchiveRowFor(object.ticker)?.status !== "ok")
    : quoteObjects;
  if (!fetchTargets.length) {
    applyOverviewQuoteArchiveRows(overviewQuoteArchiveRows);
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    renderDetailShell();
    renderPortfolio();
    prependActivity("price", "已读取本地股价", `${count}/${count} 个标的 · ${archiveDate} 已归档，不重复请求行情接口`);
    setOverviewRefreshStatus(`已读取本地行情：${count}/${count} 个标的`, "ok");
    persistAppSnapshot("price_refresh");
    return { status: "cached", count };
  }
  const batchRow = `
    <div class="radar-item batch-refresh">
      <strong>全部股价刷新中</strong>
      <span>${fetchTargets.length} 个待更新标的 · ${force ? "手动强制重取全部行情" : "其余读取本地 CSV"}</span>
    </div>`;
  if (radar) radar.innerHTML = batchRow + radar.innerHTML;
  setOverviewRefreshStatus(`正在刷新 ${fetchTargets.length} 个标的行情…`, "active");
  const symbols = fetchTargets.map(({ object }) => encodeURIComponent(object.ticker)).join(",");
  const markets = fetchTargets.map(({ object }) => encodeURIComponent(object.market)).join(",");
  const payload = await fetchReadJson(`/api/read/quotes?symbols=${symbols}&markets=${markets}`, "quotes", { timeoutMs: 60000 });
  (payload.quotes || []).forEach((quote, i) => {
    const source = fetchTargets[i];
    if (source) {
      applyQuoteToLinkedState(source.object.ticker, quote, "stock");
    }
  });
  const archivedQuotes = (payload.quotes || []).map((quote, index) => ({
    ...quote,
    symbol: fetchTargets[index]?.object.ticker || quote.symbol,
    market: fetchTargets[index]?.object.market || quote.market,
    name: fetchTargets[index]?.object.name || "",
  }));
  if (!canArchiveExpectedClose) {
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    renderDetailShell();
    renderPortfolio();
    const okCount = (payload.quotes || []).filter(quote => quote.status === "ok").length;
    prependActivity(
      "price",
      "全部股价已刷新（未归档）",
      `${okCount}/${count} 个标的接入成功 · ${marketSessionData?.message || "A股盘中"} · 未写入本地 CSV`,
    );
    setOverviewRefreshStatus(`已刷新 ${okCount}/${count} 个标的；当前不归档`, okCount ? "ok" : "warn");
    persistAppSnapshot("price_refresh");
    return { status: "refreshed_not_archived", count: okCount };
  }
  const incompleteSnapshot = archivedQuotes.filter(quote => ["A股", "ETF"].includes(quote.market)
    && (quote.status !== "ok" || !Number.isFinite(Number(quote.price)) || quote.sourceDate !== archiveDate));
  if (incompleteSnapshot.length) {
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    renderDetailShell();
    renderPortfolio();
    const symbols = incompleteSnapshot.map(quote => quote.symbol).filter(Boolean).slice(0, 6).join("、");
    prependActivity("warn", "股价已刷新但快照不完整", `${symbols || "部分 A股/ETF"} 的数据日期或状态不满足 ${archiveDate} 收盘归档；已保留原本地 CSV`);
    setOverviewRefreshStatus(`行情已获取，但 ${archiveDate} 收盘快照不完整；未覆盖本地 CSV`, "warn");
    persistAppSnapshot("price_refresh");
    return { status: "refreshed_not_archived", count: (payload.quotes || []).filter(quote => quote.status === "ok").length };
  }
  const archiveResult = await fetchOperationJson("/api/ops/overview-quotes-archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archiveDate, quotes: archivedQuotes }),
  });
  if (archiveResult.status !== "ok") {
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    renderDetailShell();
    renderPortfolio();
    prependActivity("warn", "股价已刷新但未归档", archiveResult.message || "收盘状态未通过服务端校验");
    setOverviewRefreshStatus(`行情已获取，但归档未完成：${archiveResult.message || "请稍后重试"}`, "warn");
    persistAppSnapshot("price_refresh");
    return { status: "refreshed_not_archived", count: (payload.quotes || []).filter(quote => quote.status === "ok").length };
  }
  await loadOverviewQuoteArchive();
  renderCards(getActiveOverviewFilter());
  renderTargets(getActiveTargetFilter());
  renderDetailShell();
  renderPortfolio();
  const archivedOkCount = quoteObjects.filter(({ object }) => overviewArchiveRowFor(object.ticker)?.status === "ok").length;
  setOverviewRefreshStatus(`已刷新并归档 ${archivedOkCount}/${count} 个标的；正在补充历史行情…`, "active");
  const historySymbols = fetchTargets
    .map(({ object }) => object.ticker)
    .filter(symbol => /^\d{6}\.(SH|SZ|BJ)$/i.test(symbol));
  if (historySymbols.length) {
    try {
      await fetchOperationJson("/api/ops/overview-history-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: historySymbols, end: archiveDate }),
        timeoutMs: 260000,
      });
      await loadOverviewPriceHistory();
    } catch (error) {
      prependActivity("warn", "TuShare 历史行情未更新", error.message);
    }
  }
  await loadOverviewQuoteArchive();
  renderCards(getActiveOverviewFilter());
  renderTargets(getActiveTargetFilter());
  renderDetailShell();
  renderPortfolio();
  const okCount = quoteObjects.filter(({ object }) => overviewArchiveRowFor(object.ticker)?.status === "ok").length;
  prependActivity("price", "全部股价已归档", `${okCount}/${count} 个标的接入成功 · 已写入 overview-quotes.csv，不写入 Mira`);
  setOverviewRefreshStatus(`刷新完成：${okCount}/${count} 个标的已归档`, okCount ? "ok" : "warn");
  persistAppSnapshot("price_refresh");
  return { status: "refreshed", count: okCount };
}

async function fetchQuoteForObject(index = selectedObjectIndex) {
  const object = objects[index];
  if (!object) return null;
  const quote = await fetchReadJson(`/api/read/quote?symbol=${encodeURIComponent(object.ticker)}&market=${encodeURIComponent(object.market || "")}`, "quote", { timeoutMs: 60000 });
  applyQuoteToLinkedState(object.ticker, quote, "stock");
  renderCards(getActiveOverviewFilter());
  renderTargets(getActiveTargetFilter());
  renderPortfolio();
  renderDetailShell();
  return quote;
}

async function updateMarketForObject(index = selectedObjectIndex, confirmationToken = "") {
  const object = objects[index];
  if (!object) return null;
  const payload = await fetchOperationJson("/api/ops/update-market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: object.ticker,
      market: object.market || "",
      confirmationToken,
    }),
    timeoutMs: 60000,
  });
  if (["ok", "read_only", "existing"].includes(payload.status) && payload.object) {
    const nextQuote = payload.quote || payload.object.quote || object.quote;
    if (payload.document?.path) sourcePreviewCache.set(payload.document.path, payload.document);
    objects[index] = {
      ...object,
      ...payload.object,
      quote: payload.status === "read_only" && nextQuote
        ? { ...nextQuote, miraLevels: payload.miraLevels || nextQuote.miraLevels || [] }
        : nextQuote,
      detailSummary: {
        ...(object.detailSummary || {}),
        ...(payload.document?.summary || {}),
        coreConclusion: payload.extracted?.coreConclusion || payload.document?.summary?.coreConclusion || object.detailSummary?.coreConclusion || "",
        dataCutoff: payload.quote?.sourceDate || payload.extracted?.dataCutoff || payload.object.detailSummary?.dataCutoff || object.detailSummary?.dataCutoff || "",
      },
    };
    applyQuoteToLinkedState(objects[index].ticker, objects[index].quote, "stock");
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    renderPortfolio();
    renderDetailShell();
    renderReader(getActiveMemoTab());
    renderMetrics();
    renderRadar();
    renderRadarFocus();
    renderUpdateQueue();
    renderActivity();
    if (document.getElementById("sourcesView")?.classList.contains("active")) renderSourceStatusView();
  }
  if (["ok", "read_only", "existing"].includes(payload.status)) persistAppSnapshot("object_update");
  return payload;
}

async function updateNewsForObject(index = selectedObjectIndex, confirmationToken = "") {
  const object = objects[index];
  if (!object) return null;
  const payload = await fetchOperationJson("/api/ops/update-news", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: object.ticker,
      market: object.market || "",
      confirmationToken,
    }),
    timeoutMs: 130000,
  });
  if (["ok", "existing"].includes(payload.status) && payload.object) {
    if (payload.document?.path) sourcePreviewCache.set(payload.document.path, payload.document);
    objects[index] = {
      ...object,
      ...payload.object,
      quote: object.quote,
      detailSummary: {
        ...(object.detailSummary || {}),
        ...(payload.document?.summary || {}),
        coreConclusion: payload.extracted?.coreConclusion || payload.document?.summary?.coreConclusion || object.detailSummary?.coreConclusion || "",
        dataCutoff: payload.extracted?.dataCutoff || payload.document?.summary?.dataCutoff || object.detailSummary?.dataCutoff || "",
      },
    };
    renderCards(getActiveOverviewFilter());
    renderTargets(getActiveTargetFilter());
    renderDetailShell();
    renderReader(getActiveMemoTab());
    renderMetrics();
    renderRadar();
    renderRadarFocus();
    renderUpdateQueue();
    renderActivity();
    if (document.getElementById("sourcesView")?.classList.contains("active")) renderSourceStatusView();
  }
  if (["ok", "existing"].includes(payload.status)) persistAppSnapshot("object_update");
  return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 15000, ...requestOptions } = options;
  const response = await fetchWithTimeout(url, { cache: "no-store", ...requestOptions }, timeoutMs);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`服务返回了无法识别的内容（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

async function fetchReadJson(url, contractName, options = {}) {
  return assertReadContract(await fetchJson(url, options), contractName);
}

async function fetchOperationJson(url, options = {}) {
  return assertOperationContract(await fetchJson(url, options));
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  return fetchJson(url, { ...options, timeoutMs });
}

function requestQuoteForObject(index = selectedObjectIndex) {
  const object = objects[index];
  if (!object || !object.ticker || (!["A股", "港股", "美股", "期权"].includes(object.market || "") && !/^\d{8}$/.test(String(object.ticker || "")))) return;
  if (object.quote?.status === "ok" || object.quote?.status === "source_gap" || quoteRequestInFlight.has(index)) return;

  quoteRequestInFlight.add(index);
  object.quote = {
    status: "loading",
    provider: "yahoo_chart",
    message: "正在连接行情源",
  };

  const priceRow = document.querySelector(".price-row");
  if (priceRow) {
    const change = formatQuoteChange(object);
    priceRow.innerHTML = `<strong>${escapeHtml(formatQuotePrice(object))}</strong>${change ? `<span class="${changeClass(change)}">${escapeHtml(change)}</span>` : ""}`;
  }
  renderTechnicalPanel(object);

  fetchQuoteForObject(index)
    .catch(error => {
      object.quote = {
        status: "source_gap",
        provider: "yahoo_chart",
        message: error.message,
      };
      renderCards(getActiveOverviewFilter());
      renderTargets(getActiveTargetFilter());
      renderDetailShell();
    })
    .finally(() => quoteRequestInFlight.delete(index));
}

function applyQuoteToDetailSummary(object, quote) {
  if (!object || quote?.status !== "ok") return;
  object.detailSummary = {
    ...(object.detailSummary || {}),
    dataCutoff: quote.sourceDate || object.detailSummary?.dataCutoff || "",
  };
}

function getSelectedObject() {
  return objects[selectedObjectIndex] || objects[0] || {};
}

function openDetail(index = selectedObjectIndex) {
  if (Number.isFinite(index) && objects[index]) selectedObjectIndex = index;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("detailView").classList.add("active");
  document.getElementById("sectionEyebrow").textContent = "标的详情";
  renderDetailShell();
  renderReader(getActiveMemoTab());
  renderActivity();
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
}

function getActiveMemoTab() {
  return document.querySelector("#memoTabs button.active")?.dataset.tab || "memo";
}

function renderDetailShell() {
  const object = getSelectedObject();
  const detailView = document.getElementById("detailView");
  const detailIsActive = detailView?.classList.contains("active");
  if (detailIsActive) {
    document.getElementById("sectionEyebrow").textContent = "标的详情";
    document.getElementById("sectionTitle").textContent = `${object.name || "研究对象"}研究工作台`;
  }

  const titleRow = document.querySelector(".object-title-row");
  if (titleRow) {
    titleRow.innerHTML = `
      <h2>${escapeHtml(object.name || "未命名")} ${object.ticker ? `· ${escapeHtml(object.ticker)}` : ""}</h2>
      <span class="pill blue">${escapeHtml(researchStateLabel(object.state || "indexed"))}</span>
      <span class="pill ${object.stale === "stale" ? "red" : object.stale === "needs_refresh" ? "amber" : "green"}">${escapeHtml(refreshLabel(object.stale))}</span>
      <span class="pill muted">${escapeHtml(object.market || "未知市场")}</span>`;
  }

  const detailNote = document.querySelector(".detail-header > div > p");
  if (detailNote) {
    detailNote.textContent = object.path
      ? `${object.path} · 已索引 ${object.fileCount || 0} 个文件`
      : "对象路径待接入";
  }

  const priceRow = document.querySelector(".price-row");
  if (priceRow) {
    const change = formatQuoteChange(object);
    priceRow.innerHTML = `<strong>${escapeHtml(formatQuotePrice(object))}</strong>${change ? `<span class="${changeClass(change)}">${escapeHtml(change)}</span>` : ""}`;
  }

  const pricePanelMeta = document.querySelector(".price-panel .panel-header p");
  if (pricePanelMeta) {
    pricePanelMeta.textContent = object.latestModifiedAt
      ? `Mira file index · latest ${formatDate(object.latestModifiedAt)}`
      : "Mira file index · quote route pending";
  }
  renderTechnicalPanel(object);
  renderDetailSummary(object.detailSummary);
  if (detailIsActive) requestQuoteForObject(selectedObjectIndex);
}

function renderTechnicalPanel(object) {
  const chart = document.querySelector(".chart-wrap");
  const legend = document.querySelector(".legend-row");
  const note = document.querySelector(".technical-note");
  const score = document.querySelector(".price-panel .score");
  if (score) score.textContent = object.price && object.price !== "待接入" ? "待评分" : "未接入";
  if (object.quote?.status === "loading") {
    if (score) score.textContent = "接入中";
    if (chart) {
      chart.innerHTML = `
        <div class="chart-empty-state quote-ready">
          <strong>正在接入行情</strong>
          <span>${escapeHtml(object.market || "未知市场")} · ${escapeHtml(object.ticker || "未命名")} · 服务端行情路由请求中</span>
        </div>`;
    }
    if (legend) {
      legend.innerHTML = `
        <span><i class="legend override"></i>yahoo_chart</span>
        <span><i class="legend mira"></i>Mira 点位待读取</span>`;
    }
    if (note) {
      note.innerHTML = `
        <strong>正在连接行情源</strong>
        <span>正在读取行情快照；成功后再显示价格和涨跌幅。</span>`;
    }
    return;
  }
  if (object.quote?.status === "ok") {
    if (score) score.textContent = "已接入";
    if (chart) {
      chart.innerHTML = renderPriceChart(object);
    }
    if (legend) {
      const levelCount = (object.quote.miraLevels || []).length;
      legend.innerHTML = `
        <span><i class="legend candle-legend"></i>日K线</span>
        <span><i class="legend mira"></i>Mira 点位 ${levelCount || "暂无"}</span>
        <span><i class="legend invalid"></i>失效 / 风险位</span>`;
    }
    if (note) {
      const explainedLevels = normalizeMiraLevels(object.quote.miraLevels || []).slice(0, 6);
      const levelText = explainedLevels.length
        ? `已整理为 ${explainedLevels.length} 个有效观察区域。`
        : "当前研究文件暂未解析到可标注的 Mira 点位。";
      note.innerHTML = `
        <strong>行情已接入</strong>
        <span>当前价格和近 1 年走势已从本地 TuShare CSV 载入；${levelText}区间来自最新技术更新。</span>
        ${explainedLevels.length ? renderLevelExplanations(explainedLevels) : ""}`;
    }
    return;
  }
  if (chart) {
    chart.innerHTML = `
      <div class="chart-empty-state">
        <strong>行情路由待接入</strong>
        <span>${escapeHtml(object.market || "未知市场")} · ${escapeHtml(object.ticker || "未命名")} · 正在准备服务端行情快照；Mira 点位后续从研究文件读取。</span>
      </div>`;
  }
  if (legend) {
    legend.innerHTML = `
      <span><i class="legend auto"></i>行情待接入</span>
      <span><i class="legend mira"></i>Mira 点位待读取</span>`;
  }
  if (note) {
    note.innerHTML = `
      <strong>等待行情接入</strong>
      <span>当前只读文件索引已完成；价格、量能和 Mira 点位接入后再生成市场定价信号。</span>`;
  }
}

function renderPriceChart(object) {
  const quote = object.quote || {};
  const history = (quote.history || [])
    .filter(point => Number.isFinite(Number(point.close)))
    .map(point => ({
      ...point,
      open: Number.isFinite(Number(point.open)) ? Number(point.open) : Number(point.close),
      high: Number.isFinite(Number(point.high)) ? Number(point.high) : Number(point.close),
      low: Number.isFinite(Number(point.low)) ? Number(point.low) : Number(point.close),
      close: Number(point.close),
    }));
  if (history.length < 2) {
    const change = formatQuoteChange(object);
    return `
      <div class="chart-empty-state quote-ready">
        <strong>${formatQuotePrice(object)}</strong>
        <span>${change ? `${change} · ` : ""}暂无足够走势数据</span>
      </div>`;
  }

  const width = 760;
  const height = 340;
  const pad = { left: 54, right: 168, top: 22, bottom: 42 };
  const closes = history.map(point => point.close);
  const highs = history.map(point => point.high);
  const lows = history.map(point => point.low);
  const rawLevels = normalizeMiraLevels(quote.miraLevels || []);
  const minClose = Math.min(...lows);
  const maxClose = Math.max(...highs);
  const levelWindowLow = minClose * 0.75;
  const levelWindowHigh = maxClose * 1.25;
  const levels = rawLevels
    .filter(level => Number(level.value) >= levelWindowLow && Number(level.value) <= levelWindowHigh)
    .slice(0, 6);
  const values = lows.concat(highs).concat(levels.flatMap(level => [level.low, level.high]));
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (minValue === maxValue) {
    minValue -= 1;
    maxValue += 1;
  }
  const padding = (maxValue - minValue) * 0.12;
  minValue -= padding;
  maxValue += padding;

  const plotWidth = width - pad.left - pad.right;
  const step = plotWidth / Math.max(1, history.length);
  const candleWidth = Math.max(3, Math.min(9, step * 0.62));
  const x = index => pad.left + step * index + step / 2;
  const y = value => pad.top + ((maxValue - value) / (maxValue - minValue)) * (height - pad.top - pad.bottom);
  const ticks = buildChartTicks(minValue, maxValue, 4);
  const firstDate = history[0]?.date || "";
  const lastDate = history[history.length - 1]?.date || "";
  const lastClose = closes[closes.length - 1];
  const last = history[history.length - 1];
  const chartTitle = `${object.name || object.ticker || "标的"} K线`;
  const trendText = getMiraTrendText(object);
  const trendTone = trendToneClass(trendText);
  const positionedLevels = buildLevelLabelLayout(levels, y, pad.top + 8, height - pad.bottom - 8);

  return `
    <div class="mira-trend-card ${trendTone}">
      <div>
        <span>Mira 走势判断</span>
        <strong>${escapeHtml(trendText)}</strong>
      </div>
      <p>${escapeHtml(buildTrendExplanation(object, levels.length))}</p>
      <em>${trendText === "走势判断待读取" ? "走势来源待读取" : "走势来源：Mira"}</em>
    </div>
    <div class="kline-head">
      <div>
        <strong>${escapeHtml(chartTitle)}</strong>
        <span>${firstDate} - ${lastDate}</span>
      </div>
      <div class="ohlc-strip">
        <span>开 ${last.open.toFixed(2)}</span>
        <span>高 ${last.high.toFixed(2)}</span>
        <span>低 ${last.low.toFixed(2)}</span>
        <span>收 ${last.close.toFixed(2)}</span>
      </div>
    </div>
    <svg class="price-chart kline-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(object.name || object.ticker)} K线图和 Mira 点位">
      ${ticks.map(tick => `
        <line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" />
        <text class="axis-label" x="12" y="${(y(tick) + 4).toFixed(1)}">${tick.toFixed(2)}</text>
      `).join("")}
      ${history.map((point, index) => renderCandle(point, x(index), y, candleWidth)).join("")}
      ${positionedLevels.map((item, index) => renderLevelZone(item.level, y, pad.left, width - pad.right, item.labelY, index + 1)).join("")}
      <circle class="last-price-dot" cx="${x(history.length - 1).toFixed(1)}" cy="${y(lastClose).toFixed(1)}" r="4" />
      <text class="last-price-label" x="${(x(history.length - 1) - 72).toFixed(1)}" y="${(y(lastClose) - 10).toFixed(1)}">${lastClose.toFixed(2)}</text>
      <text class="axis-date" x="${pad.left}" y="${height - 12}">${firstDate}</text>
      <text class="axis-date" x="${width - pad.right - 78}" y="${height - 12}">${lastDate}</text>
    </svg>`;
}

function normalizeMiraLevels(levels) {
  return levels
    .filter(level => Number.isFinite(Number(level.value)))
    .map(level => {
      const value = Number(level.value);
      const low = Number.isFinite(Number(level.low)) ? Number(level.low) : value;
      const high = Number.isFinite(Number(level.high)) ? Number(level.high) : value;
      return { ...level, value, low: Math.min(low, high), high: Math.max(low, high) };
    });
}

function formatMiraLevelRange(level) {
  if (Math.abs(level.high - level.low) < 0.001) return level.value.toFixed(2);
  return `${level.low.toFixed(2)}–${level.high.toFixed(2)}`;
}

function levelToneClass(level) {
  const label = level.label || "";
  if (label.includes("失效")) return "invalid";
  if (label.includes("确认") || label.includes("支撑")) return "mira";
  return "auto";
}

function defaultLevelExplanation(level) {
  const label = level.label || "";
  if (label.includes("失效")) return "跌破后若无法收回，当前走势判断继续降级。";
  if (label.includes("确认")) return "重新站稳该区域，弱势走势才获得修复确认。";
  if (label.includes("支撑")) return "观察价格能否在该区域获得有效承接。";
  if (label.includes("压力")) return "反弹到该区域可能遇到抛压，不等同趋势反转。";
  if (label.includes("再评估")) return "回到该区域后，再重新评估更高层级趋势。";
  return "用于观察价格结构是否发生有效变化。";
}

function renderLevelExplanations(levels) {
  return `
    <div class="level-explanation-list">
      ${levels.map((level, index) => `
        <article class="${levelToneClass(level)}">
          <b>${index + 1}</b>
          <div>
            <strong>${escapeHtml(level.label || "观察位")} ${formatMiraLevelRange(level)}</strong>
            <span>${escapeHtml(level.meaning || defaultLevelExplanation(level))}</span>
          </div>
        </article>`).join("")}
    </div>`;
}

function buildLevelLabelLayout(levels, y, top, bottom) {
  const gap = 19;
  const rows = levels
    .map(level => ({ level, actualY: y(level.value), labelY: y(level.value) }))
    .sort((a, b) => a.actualY - b.actualY);
  rows.forEach((row, index) => {
    row.labelY = Math.max(row.actualY, index ? rows[index - 1].labelY + gap : top);
  });
  if (rows.length && rows[rows.length - 1].labelY > bottom) {
    rows[rows.length - 1].labelY = bottom;
    for (let index = rows.length - 2; index >= 0; index -= 1) {
      rows[index].labelY = Math.min(rows[index].labelY, rows[index + 1].labelY - gap);
    }
  }
  return rows;
}

function trendToneClass(trend) {
  if (trend === "走势判断待读取") return "neutral";
  if (/失效|跌破|派发|弱/.test(trend)) return "risk";
  if (/反转|上行|突破|确认|修复/.test(trend)) return "positive";
  return "neutral";
}

function buildTrendExplanation(object, levelCount) {
  const levelText = levelCount ? `下方已按该走势标出 ${levelCount} 个 Mira 点位。` : "当前研究文件暂未解析到该走势下的可标注点位。";
  const trendText = getMiraTrendText(object);
  if (trendText === "走势判断待读取") {
    return `${object.name || object.ticker || "当前标的"} 暂未从 Mira 文件读取到明确走势判断。${levelText}`;
  }
  return `${object.name || object.ticker || "当前标的"} 当前按 Mira 归类为“${trendText}”。${levelText}`;
}

function getMiraTrendText(object) {
  const trend = String(object?.trend || "").trim();
  if (!trend || /^已索引\s*\d+\s*个文件$/.test(trend)) return "走势判断待读取";
  return trend;
}

function renderCandle(point, x, y, width) {
  const up = point.close >= point.open;
  const klass = up ? "up" : "down";
  const highY = y(point.high);
  const lowY = y(point.low);
  const openY = y(point.open);
  const closeY = y(point.close);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(1.4, Math.abs(openY - closeY));
  return `
    <g class="candle ${klass}">
      <line class="wick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${highY.toFixed(1)}" y2="${lowY.toFixed(1)}" />
      <rect class="body" x="${(x - width / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${width.toFixed(1)}" height="${bodyHeight.toFixed(1)}" rx="1.2" />
    </g>`;
}

function renderLevelZone(level, y, x1, x2, labelY, index) {
  const klass = levelToneClass(level);
  const highY = y(level.high);
  const lowY = y(level.low);
  const zoneTop = Math.min(highY, lowY);
  const zoneHeight = Math.max(5, Math.abs(lowY - highY));
  const centerY = y(level.value);
  return `
    <rect class="level-zone ${klass}" x="${x1}" y="${zoneTop.toFixed(1)}" width="${x2 - x1}" height="${zoneHeight.toFixed(1)}" />
    <line class="level ${klass}" x1="${x1}" x2="${x2}" y1="${centerY.toFixed(1)}" y2="${centerY.toFixed(1)}" />
    <path class="level-connector ${klass}" d="M ${x2} ${centerY.toFixed(1)} L ${x2 + 8} ${labelY.toFixed(1)}" />
    <text class="level-label ${klass}" x="${x2 + 12}" y="${(labelY + 4).toFixed(1)}">${index} ${escapeHtml(level.label || "观察位")} ${formatMiraLevelRange(level)}</text>`;
}

function buildChartTicks(minValue, maxValue, count = 4) {
  const step = (maxValue - minValue) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => minValue + step * index);
}

function renderDetailSummary(summary) {
  const strip = document.getElementById("detailSummaryStrip");
  if (!strip) return;
  if (!summary || (!summary.coreConclusion && !summary.mustRefreshIf && !summary.dataCutoff)) {
    strip.innerHTML = `
      <article><span>核心结论</span><strong>待读取</strong></article>`;
    return;
  }
  strip.innerHTML = `
    <article><span>核心结论</span><strong>${escapeHtml(summary.coreConclusion || "未标注")}</strong></article>`;
}

function renderReader(tab = "memo") {
  const body = document.getElementById("readerBody");
  const object = getSelectedObject();
  const content = {
    memo: renderObjectMemo(object),
    reports: renderDeepReports(),
    evidence: renderObjectEvidence(object),
    trades: renderObjectTradeLog(object),
    objectLibrary: renderObjectLibrary(),
  };
  body.innerHTML = content[tab];
  hydrateReaderPreview(tab);
}

function renderObjectTradeLog(object) {
  const code = String(object?.ticker || "").split(".")[0].padStart(6, "0");
  const transactions = (portfolioPerformanceData?.transactions || [])
    .filter(row => String(row.code).padStart(6, "0") === code)
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  if (!transactions.length) {
    return `
      <div class="trade-log-empty">
        <strong>当前标的暂无交易记录</strong>
        <span>已检查 ${portfolioPerformanceData?.sourceFile || "已导入操作记录"}；仅展示与 ${escapeHtml(object?.ticker || "当前标的")} 匹配的流水。</span>
      </div>`;
  }

  const buyAmount = transactions.filter(row => /买入|申购/.test(row.direction)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sellAmount = transactions.filter(row => /卖出/.test(row.direction)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const groupedTransactions = groupTradeTransactions(transactions);
  const realized = calculateRealizedTradeProfit(transactions);
  const portfolioPosition = portfolioPositions.find(position => String(position.code || "").split(".")[0].padStart(6, "0") === code);
  const currentPrice = object.quote?.status === "ok" && Number.isFinite(Number(object.quote.price))
    ? Number(object.quote.price)
    : Number.isFinite(Number(portfolioPosition?.price)) ? Number(portfolioPosition.price) : null;
  const holdingProfit = realized.openQuantity === 0
    ? 0
    : currentPrice == null ? null : currentPrice * realized.openQuantity - realized.openCost;
  const generatedAt = portfolioPerformanceData?.generatedAt
    ? new Date(portfolioPerformanceData.generatedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
    : "时间未知";
  return `
    <div class="trade-log-title">
      <div>
        <h3>交易日志</h3>
        <p><strong>${escapeHtml(object.name || object.ticker || "当前标的")}</strong><span>${transactions.length} 笔成交 · 合并为 ${groupedTransactions.length} 次操作</span></p>
      </div>
      <div class="trade-log-cutoff"><span>数据截至</span><strong>${escapeHtml(generatedAt)}</strong></div>
    </div>
    <div class="trade-log-source"><span>数据来源</span><strong>${escapeHtml(portfolioPerformanceData?.sourceFile || "已导入操作记录")}</strong></div>
    <div class="trade-log-summary">
      <article><span>累计买入</span><strong>${formatPortfolioMoney(buyAmount)}</strong></article>
      <article><span>累计卖出</span><strong>${formatPortfolioMoney(sellAmount)}</strong></article>
      <article><span>持仓盈亏</span><strong class="${holdingProfit == null ? "muted-change" : holdingProfit >= 0 ? "positive" : "negative"}">${holdingProfit == null ? "待接入" : formatPortfolioSigned(holdingProfit)}</strong><em>${realized.openQuantity ? `当前持仓 ${formatPortfolioMoney(realized.openQuantity, 0)} 股${currentPrice == null ? " · 缺少最新价" : ""}` : "当前已清仓"}</em></article>
      <article class="trade-profit-card"><span>盈亏合计</span><strong class="${realized.profit >= 0 ? "positive" : "negative"}">${formatPortfolioSigned(realized.profit)}</strong><em>FIFO 已实现${realized.hasUnknownFees ? " · 未含缺失费用" : " · 已扣费用"}</em></article>
    </div>
    <div class="trade-log-table-wrap">
      <table class="data-table trade-log-table">
        <thead><tr><th>成交时间</th><th>操作</th><th class="number-cell">数量</th><th class="number-cell">均价</th><th class="number-cell">金额</th><th class="number-cell">费用</th><th class="number-cell">剩余持仓</th><th>备注</th></tr></thead>
        <tbody>${groupedTransactions.map(row => {
          const tone = /卖出/.test(row.direction) ? "red" : /买入|申购/.test(row.direction) ? "green" : "muted";
          return `<tr>
            <td><strong>${row.date}</strong><span>${row.time || ""}</span></td>
            <td><span class="pill ${tone}">${escapeHtml(row.direction || row.category || "操作")}</span></td>
            <td class="number-cell">${formatPortfolioMoney(Number(row.quantity || 0), 0)}</td>
            <td class="number-cell">${formatPortfolioMoney(Number(row.averagePrice || 0), 3)}</td>
            <td class="number-cell">${formatPortfolioMoney(Number(row.amount || 0))}</td>
            <td class="number-cell">${row.fee == null ? "—" : formatPortfolioMoney(Number(row.fee))}</td>
            <td class="number-cell">${formatPortfolioMoney(Number(row.shareBalance || 0), 0)}</td>
            <td>${escapeHtml(row.tradeNote || "—")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
}

function groupTradeTransactions(transactions) {
  const groups = new Map();
  transactions
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .forEach((row, index) => {
      const key = row.orderId
        ? `${row.date}|${row.orderId}|${row.direction || row.category || ""}`
        : `single|${index}`;
      if (!groups.has(key)) {
        groups.set(key, { ...row, quantity: 0, amount: 0, fee: 0, hasKnownFee: false });
      }
      const grouped = groups.get(key);
      grouped.quantity += Number(row.quantity || 0);
      grouped.amount += Number(row.amount || 0);
      if (row.fee != null) {
        grouped.fee += Number(row.fee || 0);
        grouped.hasKnownFee = true;
      }
      grouped.averagePrice = grouped.quantity ? grouped.amount / grouped.quantity : Number(row.averagePrice || 0);
      grouped.time = row.time || grouped.time;
      grouped.shareBalance = row.shareBalance ?? grouped.shareBalance;
      if (String(row.tradeNote || "").length >= String(grouped.tradeNote || "").length) grouped.tradeNote = row.tradeNote;
    });
  return [...groups.values()]
    .map(row => ({ ...row, fee: row.hasKnownFee ? row.fee : null }))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

function calculateRealizedTradeProfit(transactions) {
  const lots = [];
  let profit = 0;
  let hasUnknownFees = false;
  transactions
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .forEach(row => {
      const quantity = Number(row.quantity || 0);
      if (!quantity) return;
      const grossAmount = Number(row.amount || 0);
      const price = grossAmount ? grossAmount / quantity : Number(row.averagePrice || 0);
      const feeKnown = row.fee != null;
      const feePerShare = feeKnown ? Number(row.fee || 0) / quantity : 0;
      if (/买入|申购/.test(row.direction || "")) {
        lots.push({ quantity, cost: price + feePerShare });
        if (!feeKnown) hasUnknownFees = true;
        return;
      }
      if (!/卖出/.test(row.direction || "")) return;
      if (!feeKnown) hasUnknownFees = true;
      let remaining = quantity;
      const netPrice = price - feePerShare;
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.quantity);
        profit += (netPrice - lot.cost) * matched;
        remaining -= matched;
        lot.quantity -= matched;
        if (lot.quantity <= 0) lots.shift();
      }
    });
  return {
    profit,
    hasUnknownFees,
    openQuantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
    openCost: lots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0),
  };
}

function hydrateReaderPreview(tab) {
  if (tab === "memo") {
    const selected = getPreferredMarkdownFile();
    loadSourcePreview(selected, document.querySelector("[data-source-preview]"));
    loadSourcePreview(selected, document.querySelector("[data-source-preview-debate]"));
  }
  if (tab === "evidence") {
    const selected = getRankedObjectFiles()[0];
    loadSourcePreview(selected, document.querySelector("[data-source-preview]"));
  }
  if (tab === "objectLibrary") {
    const selected = getRankedObjectFiles()[Number(document.querySelector(".report-file.active")?.dataset.objectLibraryIndex || 0)] || getRankedObjectFiles()[0];
    loadSourcePreview(selected, document.querySelector("[data-source-preview]"));
  }
  if (tab === "reports") {
    const selected = getPreferredMarkdownFile();
    loadSourcePreview(selected, document.querySelector("[data-source-preview]"));
  }
}

function renderObjectMemo(object) {
  const preferred = getPreferredMarkdownFile();
  return `
    ${preferred ? `
      <section class="preferred-file-preview">
        <div class="report-page" data-source-preview="${escapeHtml(preferred.path)}" data-preview-mode="memo-conclusion">
          <div class="preview-loading">正在读取只读预览...</div>
        </div>
      </section>` : ""}
    ${renderEvidenceQualityTable()}
    ${preferred ? `
      <section class="memo-debate-summary">
        <div class="report-page" data-source-preview-debate="${escapeHtml(preferred.path)}" data-preview-mode="memo-debate">
          <div class="preview-loading">正在读取核心投资辩题与关键变量...</div>
        </div>
      </section>` : ""}
  `;
}

function renderObjectEvidence(object) {
  const files = getRankedObjectFiles();
  const categories = [
    ["core", "1 核心研究文档"],
    ["monitoring", "2 行情与持续监控"],
    ["thesis", "3 Thesis 与决策记录"],
    ["industry", "4 行业分析"],
    ["other", "5 其他"],
  ];
  const rows = categories.map(([category, label]) => {
    const categoryFiles = files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => classifyObjectFile(file) === category);
    return `
      <tr class="file-list-category-row">
        <td colspan="3"><strong>${label}</strong><span>${categoryFiles.length} 个文件</span></td>
      </tr>
      ${categoryFiles.map(({ file, index }) => `
        <tr data-file-list-index="${index}" class="${index === 0 ? "active" : ""}">
          <td>${escapeHtml(file.title)}</td>
          <td>${escapeHtml(file.type)}</td>
          <td>${escapeHtml(file.modifiedAt ? formatDate(file.modifiedAt) : "未知")}</td>
        </tr>`).join("") || `<tr class="file-list-empty-row"><td colspan="3">暂无文件</td></tr>`}`;
  }).join("");
  return `
    <div class="section-title-row">
      <h3>文件清单</h3>
      <span class="pill muted">${files.length} 个文件 · 标的文件 + 关联行业分析</span>
    </div>
    <div class="file-list-table-wrap">
      <table class="data-table file-list-table">
        <thead><tr><th>文件</th><th>类型</th><th>修改时间</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3">当前对象暂无文件。</td></tr>`}</tbody>
      </table>
    </div>
    <div class="report-page file-list-preview" data-source-preview>
      <div class="preview-loading">点击文件行查看只读预览。</div>
    </div>`;
}

function classifyObjectFile(file) {
  if (file?.category === "industry_analysis") return "industry";
  const name = `${file?.title || ""} ${file?.path || ""}`.toLowerCase();
  if (/(investment-memo|research-memo|working-view|industry-map|commodity-cycle-note|investment-thesis)/.test(name)) {
    return "core";
  }
  if (/(market-update|monitor(?:ing)?[-_]|technical-analysis|price-snapshot|trend-update|行情|监控)/.test(name)) {
    return "monitoring";
  }
  if (/(thesis-ledger|expectation-map|decision-log|event-delta|actionability-bridge|thesis-scorecard|postmortem|invalidation)/.test(name)) {
    return "thesis";
  }
  return "other";
}

function renderObjectExpectation(object) {
  return `
    <table class="data-table">
      <thead><tr><th>变量</th><th>当前状态</th><th>下一步</th></tr></thead>
      <tbody>
        <tr><td>行情</td><td>${escapeHtml(formatQuotePrice(object))}${formatQuoteChange(object) ? ` · ${escapeHtml(formatQuoteChange(object))}` : ""}</td><td>${escapeHtml(quoteMetaLine(object))}</td></tr>
        <tr><td>研究文件</td><td>已索引 ${object.fileCount || 0} 个文件</td><td>读取 investment-memo / monitor / evidence 摘要</td></tr>
        <tr><td>刷新状态</td><td>${refreshLabel(object.stale)}</td><td>按 latestModifiedAt 和 must_refresh_if 生成队列</td></tr>
      </tbody>
    </table>`;
}

function renderObjectLibrary(selectedIndex = 0) {
  const files = getRankedObjectFiles();
  const selected = files[selectedIndex] || files[0];
  if (!selected) {
    return `<div class="empty-inline">当前对象暂无可预览资料。</div>`;
  }
  return `
    <div class="object-library">
      <aside class="report-list" aria-label="标的资料库文件列表">
        ${files.map((file, index) => `
          <button class="report-file ${index === selectedIndex ? "active" : ""}" data-object-library-index="${index}">
            <strong>${escapeHtml(file.title)}</strong>
            <span>${escapeHtml(file.type)} · ${escapeHtml(file.modifiedAt ? formatDate(file.modifiedAt) : "未知时间")}</span>
          </button>
        `).join("")}
      </aside>
      <article class="report-preview">
        <div class="report-preview-head">
          <div>
            <h3>${escapeHtml(selected.title)}</h3>
          </div>
        </div>
        <div class="report-page" data-source-preview="${escapeHtml(selected.path)}">
          <h4>资料摘要</h4>
          <p>${escapeHtml(selected.summary || "该文件已被 MiraBoard 只读索引。后续会接入 Markdown 安全渲染、PDF 页码定位和 CSV 表格预览。")}</p>
          <p>这里用于预览标的文件夹里的研报解读、PDF 原文、政策监控和外部材料。引用这些资料形成判断时，仍需要写入 evidence-log、report-claim-map 或 case-notes。</p>
          <div class="doc-outline">
            <div>Markdown：安全渲染并保留来源路径。</div>
            <div>PDF：后续接入内嵌预览、页码定位和 OCR/文本提取状态。</div>
            <div>CSV/HTML：转换为只读表格或沙箱预览。</div>
          </div>
        </div>
      </article>
    </div>`;
}

async function loadSourcePreview(file, container) {
  if (!file || !container) return;
  if (!isTextPreviewType(file.type)) {
    container.innerHTML = renderUnsupportedPreview(file);
    return;
  }

  container.innerHTML = `<div class="preview-loading">正在读取只读预览...</div>`;
  const cacheKey = file.path;
  const requestKey = `${cacheKey}:${Date.now()}:${Math.random()}`;
  container.dataset.previewRequest = requestKey;
  let payload = sourcePreviewCache.get(cacheKey);
  try {
    if (!payload) {
      const response = await fetchWithTimeout(
        `/api/read/source-file?path=${encodeURIComponent(file.path)}`,
        { cache: "no-store" },
        15000
      );
      payload = assertReadContract(await response.json(), "source-file");
      sourcePreviewCache.set(cacheKey, payload);
    }
  } catch (error) {
    if (container.isConnected && container.dataset.previewRequest === requestKey) {
      container.innerHTML = `<div class="preview-error">${escapeHtml(error.message || "无法连接只读预览服务")}</div>`;
    }
    return;
  }
  if (!container.isConnected || container.dataset.previewRequest !== requestKey) return;

  if (payload.status !== "ok") {
    container.innerHTML = `<div class="preview-error">${escapeHtml(payload.message || "无法预览该文件")}</div>`;
    return;
  }

  const object = getSelectedObject();
  object.detailSummary = {
    ...(object.detailSummary || {}),
    ...(payload.summary || {}),
    dataCutoff: payload.summary?.dataCutoff || object.detailSummary?.dataCutoff || "",
  };
  renderDetailSummary(object.detailSummary);
  container.innerHTML = renderTextPreview(payload, container.dataset.previewMode || "full");
}

function isTextPreviewType(type) {
  return ["md", "txt", "csv", "json", "html"].includes(String(type || "").toLowerCase());
}

function renderUnsupportedPreview(file) {
  return `
    <h4>资料摘要</h4>
    <p>${escapeHtml(file.title)} 已被索引，但当前只支持文本类文件预览。</p>
    <div class="doc-outline">
      <div>PDF：后续接入页码定位和嵌入式预览。</div>
      <div>Excel：后续转换为只读表格。</div>
      <div>原始路径：${escapeHtml(file.path)}</div>
    </div>`;
}

function renderTextPreview(payload, mode = "full") {
  const previewText = ["memo-conclusion", "memo-debate"].includes(mode) && payload.type === "md"
    ? buildMemoSummaryMarkdown(payload.text, mode)
    : payload.text;
  const body = payload.type === "md"
    ? renderMarkdownPreview(previewText)
    : `<pre class="text-preview-pre">${escapeHtml(payload.text)}</pre>`;
  const sourceHead = mode === "memo-debate" ? "" : mode === "memo-conclusion" ? `
    <div class="memo-summary-actions">
      <button class="full-preview-button" type="button" data-full-preview-path="${escapeHtml(payload.path)}">完整预览</button>
    </div>` : `
    <div class="source-preview-head">
      <h4>${escapeHtml(payload.title)}</h4>
      ${payload.type === "md"
        ? `<button class="full-preview-button" type="button" data-full-preview-path="${escapeHtml(payload.path)}">完整预览</button>`
        : `<span>${payload.truncated ? "已截断预览" : "完整文件"}</span>`}
    </div>`;
  return `
    ${sourceHead}
    <div class="markdown-preview">${body}</div>`;
}

function ensureFullscreenPreview() {
  let overlay = document.getElementById("fullscreenReportPreview");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "fullscreenReportPreview";
  overlay.className = "fullscreen-report-preview";
  overlay.hidden = true;
  overlay.innerHTML = `
    <header class="fullscreen-report-header">
      <div><strong data-full-preview-title>深度研究报告</strong><span>只读预览</span></div>
      <button type="button" class="fullscreen-report-close" data-close-full-preview aria-label="关闭完整预览">×</button>
    </header>
    <main class="fullscreen-report-scroll">
      <article class="fullscreen-report-document" data-full-preview-body></article>
    </main>
    <footer class="fullscreen-preview-actions" data-preview-write-actions hidden>
      <p><strong>写入前确认</strong><span data-preview-write-message>请先检查完整预览，再决定是否写入 Mira。</span></p>
      <div>
        <button type="button" class="ghost-btn" data-preview-write-cancel>取消写入</button>
        <button type="button" class="price-refresh-all-btn" data-preview-write-confirm>确认写入 Mira</button>
      </div>
    </footer>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", event => {
    if (event.target.closest("[data-close-full-preview]")) closeFullscreenPreview();
    if (event.target.closest("[data-preview-write-cancel]")) resolvePreviewWriteConfirmation(false);
    if (event.target.closest("[data-preview-write-confirm]")) resolvePreviewWriteConfirmation(true);
  });
  return overlay;
}

async function openFullscreenPreview(path) {
  if (!path) return;
  const overlay = ensureFullscreenPreview();
  const body = overlay.querySelector("[data-full-preview-body]");
  const title = overlay.querySelector("[data-full-preview-title]");
  overlay.hidden = false;
  document.body.classList.add("fullscreen-preview-open");
  body.innerHTML = `<div class="preview-loading">正在载入完整报告...</div>`;

  let payload = sourcePreviewCache.get(path);
  if (!payload) {
    payload = await fetchReadJson(`/api/read/source-file?path=${encodeURIComponent(path)}`, "source-file");
    sourcePreviewCache.set(path, payload);
  }
  if (payload.status !== "ok") {
    body.innerHTML = `<div class="preview-error">${escapeHtml(payload.message || "无法预览该文件")}</div>`;
    return;
  }
  title.textContent = payload.title || "深度研究报告";
  body.innerHTML = payload.type === "md"
    ? `<div class="markdown-preview fullscreen-markdown-preview">${renderMarkdownPreview(payload.text, Infinity)}</div>`
    : `<pre class="text-preview-pre">${escapeHtml(payload.text)}</pre>`;
  overlay.querySelector(".fullscreen-report-scroll").scrollTop = 0;
}

function closeFullscreenPreview() {
  resolvePreviewWriteConfirmation(false);
}

function hideFullscreenPreview() {
  const overlay = document.getElementById("fullscreenReportPreview");
  if (overlay) {
    overlay.hidden = true;
    const actions = overlay.querySelector("[data-preview-write-actions]");
    if (actions) actions.hidden = true;
  }
  document.body.classList.remove("fullscreen-preview-open");
}

function resolvePreviewWriteConfirmation(confirmed) {
  const resolve = pendingPreviewConfirmation;
  pendingPreviewConfirmation = null;
  hideFullscreenPreview();
  if (resolve) resolve(Boolean(confirmed));
}

async function requestPreviewWriteConfirmation(payload) {
  if (!payload?.document?.path) return false;
  sourcePreviewCache.set(payload.document.path, payload.document);
  await openFullscreenPreview(payload.document.path);
  const overlay = ensureFullscreenPreview();
  const actions = overlay.querySelector("[data-preview-write-actions]");
  const message = overlay.querySelector("[data-preview-write-message]");
  if (message) message.textContent = `${payload.title || "更新文件"} 尚未写入。请检查完整内容后确认。`;
  if (actions) actions.hidden = false;
  return new Promise(resolve => {
    if (pendingPreviewConfirmation) pendingPreviewConfirmation(false);
    pendingPreviewConfirmation = resolve;
  });
}

function getSelectedObjectFiles() {
  const object = getSelectedObject();
  if (!object) return [];
  const directFiles = Array.isArray(object.files) ? object.files : [];
  const industryFiles = Array.isArray(object.industryFiles) ? object.industryFiles : [];
  const ticker = String(object.ticker || "").toLowerCase();
  const objectName = String(object.name || "").toLowerCase();
  const mergedByPath = new Map();
  const mergeFile = file => {
    const path = String(file?.path || "");
    if (!path) return;
    const existing = mergedByPath.get(path) || {};
    const next = { ...existing };
    Object.entries(file || {}).forEach(([key, value]) => {
      if (!(key in next) || next[key] == null || next[key] === "" || (Array.isArray(next[key]) && next[key].length === 0)) {
        next[key] = value;
        return;
      }
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return;
      if (["type", "summary", "date", "category", "industryAnalysis", "modifiedAt", "size"].includes(key)) {
        next[key] = value;
      }
    });
    mergedByPath.set(path, next);
  };

  [...directFiles, ...industryFiles].forEach(mergeFile);
  if (ticker || objectName) {
    objectLibraryFiles
      .filter(file => {
        const path = String(file.path || "").toLowerCase();
        return (ticker && path.includes(ticker)) || (objectName && path.includes(objectName));
      })
      .forEach(mergeFile);
  }
  return [...mergedByPath.values()];
}

function getRankedObjectFiles() {
  return [...getSelectedObjectFiles()].sort((a, b) =>
    filePriority(a) - filePriority(b) ||
    Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0) ||
    String(a.title).localeCompare(String(b.title))
  );
}

function filePriority(file) {
  const name = String(file.title || "").toLowerCase();
  if (name === "investment-memo.md") return 0;
  if (name.includes("investment-memo")) return 1;
  if (name.includes("working-view")) return 2;
  if (name.startsWith("market-update")) return 2;
  if (name.startsWith("monitor") || name.includes("-monitor")) return 3;
  if (name.includes("report-readout")) return 4;
  if (name.includes("evidence-log")) return 5;
  if (name.endsWith(".md") || file.type === "md") return 6;
  if (file.type === "csv") return 7;
  if (file.type === "pdf") return 8;
  return 9;
}

function formatDate(epochSeconds) {
  if (!epochSeconds) return "未知";
  return beijingDateIso(new Date(epochSeconds * 1000));
}

function renderEvidenceQualityTable() {
  const object = getSelectedObject();
  const quality = object.evidenceQuality || {};
  const rows = quality.categories || [];
  const overallTone = scoreQualityLevel(Number(quality.score || 0));
  return `
    <section class="evidence-quality">
      <div class="section-title-row">
        <div>
          <h3>证据质量概览</h3>
          <p>${rows.length ? `${quality.rowCount || 0} 条证据 · 规则评分` : "当前标的尚无可评分的 evidence-log"}</p>
        </div>
        <div class="evidence-score-summary ${overallTone}">
          <strong>${Number(quality.score || 0).toFixed(2)}</strong>
          <span>${escapeHtml(quality.label || "证据不足")}</span>
        </div>
      </div>
      <div class="quality-table-wrap">
        <table class="quality-table">
          <thead>
            <tr>
              <th>证据类别</th>
              <th>权重</th>
              <th>可信度</th>
              <th>新鲜度</th>
              <th>覆盖度</th>
              <th>质量评分</th>
              <th>关键来源 / 备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(row => `
              <tr>
                <td><strong>${escapeHtml(row.name)}</strong><span>${row.claimCount || 0} 条 / ${row.sourceCount || 0} 来源</span></td>
                <td>${Math.round(Number(row.weight || 0) * 100)}%</td>
                <td>${qualityMetric(row.credibility)}</td>
                <td>${qualityMetric(row.freshness)}</td>
                <td>${qualityMetric(row.coverage)}</td>
                <td><strong>${Number(row.score || 0).toFixed(2)}</strong></td>
                <td>${escapeHtml((row.sources || []).join("、") || "暂无对应证据")}${row.conflicts ? `<em class="quality-conflict">${row.conflicts} 项冲突</em>` : ""}</td>
              </tr>`).join("") : `<tr><td colspan="7">未发现 evidence-log.csv 或日志中没有有效证据。</td></tr>`}
          </tbody>
          <tfoot><tr><td><strong>整体（加权）</strong></td><td>100%</td><td>—</td><td>—</td><td>—</td><td><strong>${Number(quality.score || 0).toFixed(2)} / 1.00</strong></td><td>${escapeHtml(quality.label || "证据不足")}</td></tr></tfoot>
        </table>
      </div>
      <p class="evidence-score-method">${escapeHtml(quality.method || "可信度、新鲜度和覆盖度综合评分")} · 分数用于研究完备度检查，不代表投资评级。</p>
    </section>`;
}

function preferredSourceName(pattern, files) {
  const file = files.find(item => pattern.test(`${item.title || ""} ${item.path || ""}`.toLowerCase()));
  return file ? file.title : "待读取 / 未发现对应文件";
}

function qualityBadge(value) {
  const cls = value === "高" ? "high" : value === "中" ? "mid" : "low";
  return `<span class="quality-badge ${cls}">${value}</span>`;
}

function scoreQualityLevel(value) {
  if (Number(value) >= 0.78) return "high";
  if (Number(value) >= 0.55) return "mid";
  return "low";
}

function qualityMetric(value) {
  const numeric = Number(value || 0);
  const level = scoreQualityLevel(numeric);
  const label = level === "high" ? "高" : level === "mid" ? "中" : "低";
  return `${qualityBadge(label)} <span class="quality-number">${numeric.toFixed(2)}</span>`;
}

function renderThesisLedgerBlock() {
  const object = getSelectedObject();
  const files = getRankedObjectFiles();
  const preferred = getPreferredMarkdownFile();
  const evidenceFile = files.find(file => String(file.title || "").toLowerCase().includes("evidence-log"));
  const calcFile = files.find(file => String(file.title || "").toLowerCase().includes("calculation"));
  const support = [
    preferred ? `优先研究文件：${preferred.title}` : "",
    evidenceFile ? `证据日志：${evidenceFile.title}` : "",
    calcFile ? `计算底稿：${calcFile.title}` : "",
  ].filter(Boolean).join("；") || "已索引文件尚未映射到证据链。";
  const disconfirming = object.stale === "stale"
    ? "当前对象已过期，需先刷新 memo、行情和关键证据后再复盘 thesis。"
    : "反证条件等待从 Mira 的 must_refresh_if / invalidation 记录中读取。";
  return `
    <section class="embedded-ledger" aria-label="Thesis Ledger 摘要">
      <div class="embedded-ledger-head">
        <div>
          <h3>Thesis Ledger</h3>
          <p>${escapeHtml(object.name || object.ticker || "当前对象")} 的 thesis 账本摘要，内容跟随当前标的和 Mira 文件索引。</p>
        </div>
        <span class="pill muted">state: ${escapeHtml(object.state || "indexed")}</span>
      </div>
      <div class="ledger-grid">
        <div>
          <span>Current Thesis</span>
          <strong>${escapeHtml(object.name || object.ticker || "当前对象")}：${escapeHtml(object.trend || "thesis 待读取")}；当前仅展示 Mira 已索引摘要。</strong>
        </div>
        <div>
          <span>Supporting Claims</span>
          <strong>${escapeHtml(support)}</strong>
        </div>
        <div>
          <span>Disconfirming Evidence</span>
          <strong>${escapeHtml(disconfirming)}</strong>
        </div>
        <div>
          <span>State Change Log</span>
          <strong>${refreshLabel(object.stale)} · 已索引 ${object.fileCount || files.length || 0} 个文件 · 最新 ${formatDate(object.latestModifiedAt)}</strong>
        </div>
      </div>
    </section>`;
}

function renderDeepReports(selectedIndex = 0) {
  const object = getSelectedObject();
  const reportFiles = getMarkdownFiles();
  const selected = reportFiles[selectedIndex] || getPreferredMarkdownFile() || deepReports[selectedIndex] || deepReports[0];
  if (!selected) {
    return `<div class="empty-inline">当前对象暂无 Markdown 报告文件。</div>`;
  }
  return `
    <article class="deep-report-full">
      <div class="memo-document" data-source-preview="${escapeHtml(selected.path)}">
        <h2>${escapeHtml(object.name || object.ticker)} Research File</h2>
        <p class="memo-lead">${escapeHtml(selected.summary || "当前为文件级只读预览。后续接入 Markdown 正文渲染后，这里会展示完整内容和章节定位。")}</p>
        <h3>Core Conclusion</h3>
        <p>已定位到 Mira 文件：<code>${escapeHtml(selected.title)}</code>。当前阶段只展示元信息，不把文件内容直接写入判断。</p>
        <h3>Next Integration</h3>
        <ul>
          <li>安全渲染 Markdown 正文。</li>
          <li>提取 core conclusion、must_refresh_if 和 evidence 链接。</li>
          <li>将 report-readout / monitor / evidence-log 映射到同一对象视图。</li>
        </ul>
        <p class="memo-note">路径：<code>${escapeHtml(selected.path)}</code></p>
      </div>
    </article>`;
}

function getMarkdownFiles() {
  return getRankedObjectFiles().filter(file => file.type === "md");
}

function getPreferredMarkdownFile() {
  return getMarkdownFiles()[0];
}

function renderActivity() {
  const log = document.getElementById("activityLog");
  const object = getSelectedObject();
  const objectKey = object.path || object.ticker || "";
  const taggedActivity = activity.filter(item => activityBelongsToObject(item, object));
  const knownPaths = new Set(taggedActivity.map(item => normalizeActivityItem(item)[4]?.filePath).filter(Boolean));
  const fileActivity = (object.files || [])
    .filter(file => /^(?:market-update|monitoring-update|monitor-).*\.md$/i.test(file.title || "") && !knownPaths.has(file.path))
    .map(file => ({
      kind: /^market-update/i.test(file.title || "") ? "price" : "news",
      title: `${object.name || object.ticker} · ${/^market-update/i.test(file.title || "") ? "market-update" : "monitoring-update"} 已写入`,
      meta: file.path,
      recordedAt: file.modifiedAt ? formatActivityTime(new Date(file.modifiedAt * 1000)) : "时间未记录",
      objectKey,
      ticker: object.ticker,
      filePath: file.path,
    }));
  const visibleActivity = [...taggedActivity, ...fileActivity]
    .filter(shouldShowActivityItem)
    .sort((a, b) => normalizeActivityItem(b)[3].localeCompare(normalizeActivityItem(a)[3]));
  if (!visibleActivity.length) {
    log.innerHTML = `<div class="empty-inline">当前标的暂无 Mira 写入记录。</div>`;
    return;
  }
  log.innerHTML = visibleActivity.map(item => {
    const [kind, title, meta, recordedAt] = normalizeActivityItem(item);
    return `
      <div class="activity-item ${kind}">
        <div class="activity-title-row">
          <strong>${escapeHtml(title)}</strong>
          <time>${escapeHtml(recordedAt)}</time>
        </div>
        <span>${escapeHtml(meta)}</span>
      </div>`;
  }).join("");
}

function activityBelongsToObject(item, object) {
  const context = normalizeActivityItem(item)[4] || {};
  const objectPath = normalizeResearchPath(object?.path);
  const filePath = normalizeResearchPath(context.filePath);
  const objectTicker = String(object?.ticker || "").trim().toUpperCase();
  const contextTicker = String(context.ticker || "").trim().toUpperCase();
  const contextKey = normalizeResearchPath(context.objectKey);

  // A persisted file path is the strongest ownership signal. It must never be
  // overridden by a stale ticker or object key attached to an activity item.
  if (filePath && objectPath) {
    return filePath === objectPath || filePath.startsWith(`${objectPath}/`);
  }
  if (contextTicker && objectTicker) return contextTicker === objectTicker;
  if (!contextKey) return false;
  return contextKey === objectPath || contextKey === objectTicker.toLowerCase();
}

function normalizeResearchPath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function shouldShowActivityItem(item) {
  const [, title, meta] = normalizeActivityItem(item);
  const text = `${title} ${meta}`;
  if (/刷新中|刷新失败|Failed to fetch|行情刷新未完成|source_gap/i.test(text)) return false;
  return true;
}

function attachUpdateButtons() {
  document.getElementById("refreshAllPricesBtn").addEventListener("click", async () => {
    const button = document.getElementById("refreshAllPricesBtn");
    const originalMarkup = button.innerHTML;
    setButtonBusy(button, true);
    button.setAttribute("aria-busy", "true");
    button.textContent = "刷新中…";
    try {
      await showBatchPriceRefresh({ force: true });
    } catch (error) {
      setUpdateStatus("warn", `全部股价刷新失败：${error.message}`);
    } finally {
      button.innerHTML = originalMarkup;
      button.removeAttribute("aria-busy");
      setButtonBusy(button, false);
    }
  });
  document.getElementById("priceUpdateBtn").addEventListener("click", async () => {
    const object = getSelectedObject();
    const button = document.getElementById("priceUpdateBtn");
    setButtonBusy(button, true);
    setUpdateStatus("active", `${object.name || object.ticker} 正在读取东方财富近三个月日线；失败时自动切换 Yahoo...`);
    try {
      let payload = await updateMarketForObject(selectedObjectIndex);
      if (payload?.status === "preview") {
        const confirmed = await requestPreviewWriteConfirmation(payload);
        if (!confirmed) {
          setUpdateStatus("warn", "已取消写入；预览未改动 Mira 文件。");
          return;
        }
        payload = await updateMarketForObject(selectedObjectIndex, payload.confirmationToken);
      }
      const updatedObject = getSelectedObject();
      const quote = payload?.quote || updatedObject.quote;
      const status = payload?.status === "ok" ? `${formatQuotePrice(updatedObject)} · ${formatQuoteChange(updatedObject)}` : payload?.message || "source_gap";
      if (payload?.status === "read_only") {
        setUpdateStatus(
          "ok",
          `非开盘日只读：${payload.title || "未找到 market-update"} · 未计算、未写入新文件`
        );
      } else if (payload?.status === "existing") {
        setUpdateStatus("ok", `已读取当日文件：${payload.title} · 未重复写入`);
      } else {
        setUpdateStatus(
          payload?.status === "ok" ? "ok" : "warn",
          payload?.status === "ok"
            ? `market-update 已写入：${payload.title || "今日走势文档"} · 数据截止 ${quote?.sourceDate || "未知"}`
            : `行情刷新未完成：${status}`
        );
      }
      if (["ok", "read_only", "existing"].includes(payload?.status) && payload?.path) {
        await openFullscreenPreview(payload.path);
      }
      if (payload?.status === "ok") {
        prependActivity(
          "price",
          `${updatedObject.name || updatedObject.ticker} · market-update 已写入`,
          `${status} · ${payload.path || buildUpdatePreviewMeta(updatedObject, "price")}`,
          updatedObject,
          payload.path || ""
        );
      }
    } catch (error) {
      setUpdateStatus("warn", `股价行情刷新失败：${error.message}`);
    } finally {
      setButtonBusy(button, false);
    }
  });
  document.getElementById("newsUpdateBtn").addEventListener("click", async () => {
    const object = getSelectedObject();
    const button = document.getElementById("newsUpdateBtn");
    setButtonBusy(button, true);
    setUpdateStatus("active", `${object.name || object.ticker} 正在读取最新本地 thesis、扫描新闻并执行 monitoring-loop...`);
    try {
      let payload = await updateNewsForObject(selectedObjectIndex);
      if (payload?.status === "preview") {
        const confirmed = await requestPreviewWriteConfirmation(payload);
        if (!confirmed) {
          setUpdateStatus("warn", "已取消写入；预览未改动 Mira 文件。");
          return;
        }
        payload = await updateNewsForObject(selectedObjectIndex, payload.confirmationToken);
      }
      const updatedObject = getSelectedObject();
      if (payload?.status === "existing") {
        setUpdateStatus("ok", `已读取当日文件：${payload.title} · 未扫描新闻、未调用 Mira / AI`);
        await openFullscreenPreview(payload.path);
      } else if (payload?.status === "ok") {
        setUpdateStatus("ok", `monitoring-update 已写入：${payload.title} · thesis：${payload.thesisSource || "本地最新文档"} · 扫描 ${payload.newsCount || 0} 条新闻线索`);
        prependActivity(
          "news",
          `${updatedObject.name || updatedObject.ticker} · monitoring-update 已写入`,
          `${payload.newsProvider || "news"} · ${payload.newsCount || 0} 条 · ${payload.path}`,
          updatedObject,
          payload.path || ""
        );
      } else {
        setUpdateStatus("warn", `行业新闻更新未写入：${payload?.message || "流程未完成"}`);
      }
    } catch (error) {
      setUpdateStatus("warn", `行业新闻更新失败：${error.message}`);
    } finally {
      setButtonBusy(button, false);
    }
  });
  document.getElementById("globalRefreshBtn").addEventListener("click", async () => {
    const button = document.getElementById("globalRefreshBtn");
    setButtonBusy(button, true);
    try {
      sourcePreviewCache.clear();
      const [synced] = await Promise.all([
        syncResearchObjects(),
        loadProviderStatus(),
        loadMarketPulse(),
        loadMarketSession(),
        loadPositionReviews(),
        loadOperationCatalog(),
      ]);
      const dueCount = objects.filter(object => ["stale", "needs_refresh"].includes(object.stale)).length;
      prependActivity(
        synced ? "price" : "warn",
        synced ? "研究标的已重新同步" : "研究标的同步失败",
        synced ? `${objects.length} 个对象已接入 · ${dueCount} 个待刷新` : "保留当前看板数据"
      );
      renderUpdateQueue();
      renderSourceStatus();
      renderMarketPulse();
      renderPortfolio();
      persistAppSnapshot("data_source_refresh");
    } finally {
      setButtonBusy(button, false);
    }
  });
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
}

function setUpdateStatus(tone, message) {
  const status = document.getElementById("updateStatus");
  if (!status) return;
  status.className = `update-status ${tone || "active"}`;
  status.textContent = message || "";
}

function buildUpdatePreviewMeta(object, kind) {
  const objectPath = object.path || "Mira object path pending";
  if (kind === "price") {
    return `${object.ticker || "未命名"} · ${objectPath} · 目标 technical-analysis-check.csv / evidence-log.csv / ingestion-log.csv`;
  }
  return `${object.ticker || "未命名"} · ${objectPath} · 目标 monitor-YYYY-MM-DD.md / evidence-log.csv / case-notes.md`;
}

function prependActivity(kind, title, meta, object = null, filePath = "") {
  activity.unshift({
    kind,
    title,
    meta,
    recordedAt: formatActivityTime(new Date()),
    objectKey: object?.path || object?.ticker || "",
    ticker: object?.ticker || "",
    filePath,
  });
  renderActivity();
}

function normalizeActivityItem(item) {
  if (Array.isArray(item)) {
    const [kind, title, meta, recordedAt, context] = item;
    return [kind, title, meta, recordedAt || inferActivityTime(meta) || "时间未记录", context || {}];
  }
  return [
    item?.kind || "warn",
    item?.title || "未命名记录",
    item?.meta || "",
    item?.recordedAt || "时间未记录",
    {
      objectKey: item?.objectKey || "",
      ticker: item?.ticker || "",
      filePath: item?.filePath || "",
    },
  ];
}

function inferActivityTime(text = "") {
  const dateMatch = String(text).match(/20\d{2}-\d{2}-\d{2}/);
  if (dateMatch) return dateMatch[0];
  return bootstrapMeta.generatedAt || "";
}

function formatActivityTime(date) {
  return `${formatBeijingTime(date)} 北京时间`;
}

function attachTabs() {
  document.getElementById("memoTabs").addEventListener("click", event => {
    const btn = event.target.closest("button[data-tab]");
    if (!btn) return;
    document.querySelectorAll("#memoTabs button").forEach(b => b.classList.toggle("active", b === btn));
    renderReader(btn.dataset.tab);
  });
  document.getElementById("readerBody").addEventListener("click", event => {
    const fullPreviewButton = event.target.closest("button[data-full-preview-path]");
    if (fullPreviewButton) {
      openFullscreenPreview(fullPreviewButton.dataset.fullPreviewPath);
      return;
    }
    const reportBtn = event.target.closest("button[data-report-index]");
    if (reportBtn) {
      document.getElementById("readerBody").innerHTML = renderDeepReports(Number(reportBtn.dataset.reportIndex));
      hydrateReaderPreview("reports");
      return;
    }
    const objectLibraryBtn = event.target.closest("button[data-object-library-index]");
    if (objectLibraryBtn) {
      document.getElementById("readerBody").innerHTML = renderObjectLibrary(Number(objectLibraryBtn.dataset.objectLibraryIndex));
      const selected = getRankedObjectFiles()[Number(objectLibraryBtn.dataset.objectLibraryIndex)];
      loadSourcePreview(selected, document.querySelector("[data-source-preview]"));
      return;
    }
    const fileRow = event.target.closest("tr[data-file-list-index]");
    if (fileRow) {
      document.querySelectorAll("tr[data-file-list-index]").forEach(row => row.classList.toggle("active", row === fileRow));
      const selected = getRankedObjectFiles()[Number(fileRow.dataset.fileListIndex)];
      loadSourcePreview(selected, document.querySelector("[data-source-preview]"));
    }
  });
  document.getElementById("backToOverview").addEventListener("click", () => setView("overview"));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeFullscreenPreview();
  });
}

function getGlobalLibraryFiles() {
  const hiddenMethods = getHiddenMethodologyDocs();
  const objectFiles = objects.flatMap(object => (object.files || []).map(file => ({
    ...file,
    objectName: object.name,
    objectTicker: object.ticker,
    id: `${object.ticker || object.name}:${file.path}`,
    category: "industry",
  })));
  const docFiles = libraryDocs
    .filter(item => item.category !== "methods" || !hiddenMethods.has(item.path))
    .map(item => ({
      ...item,
      id: item.id,
      type: inferFileType(item.type),
      objectName: item.category === "lessons" ? "经验教训" :
                  item.category === "methods" ? "方法论" : "行业资料",
      objectTicker: "",
      modifiedAt: null,
    }));
  const all = [...objectFiles, ...docFiles];
  if (all.length) {
    return all.sort((a, b) => filePriority(a) - filePriority(b) || String(a.objectName).localeCompare(String(b.objectName)) || String(a.title).localeCompare(String(b.title)));
  }
  return libraryDocs.map(item => ({
    ...item,
    id: item.id,
    type: inferFileType(item.type),
    objectName: item.category === "lessons" ? "经验教训" :
                item.category === "methods" ? "方法论" : "行业资料",
    objectTicker: "",
    modifiedAt: null,
  }));
}

function inferFileType(rawType) {
  const t = String(rawType || "").toLowerCase();
  if (t.includes("pdf")) return "pdf";
  if (t.includes("csv")) return "csv";
  if (t.includes("html")) return "html";
  if (t.includes("xlsx") || t.includes("excel")) return "xlsx";
  return "md";
}

function renderLibrary(selectedId, filter = getActiveLibraryFilter(), category = getActiveLibraryCategory()) {
  const list = document.getElementById("libraryList");
  const docs = getGlobalLibraryFiles()
    .filter(file => category === "all" || file.category === category)
    .filter(file => filter === "all" || file.type === filter);
  const doc = docs.find(item => item.id === selectedId) || docs[0];
  if (!doc) {
    list.innerHTML = `<div class="empty-card-state">当前没有${category === "all" ? "" : escapeHtml(getCategoryLabel(category))}资料</div>`;
    document.getElementById("documentPreview").innerHTML = `<div class="empty-panel"><h2>暂无资料</h2><p>切换其他分类继续查看。</p></div>`;
    return;
  }
  list.innerHTML = docs.map(item => `
    <div class="library-row ${item.id === doc.id ? "active" : ""}" data-search-text="${escapeHtml(searchTextForFile(item))}">
      <button class="library-item" data-doc="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.objectName || "Mira")} · ${escapeHtml(item.type)} · ${escapeHtml(item.path)}</span>
      </button>
      ${item.category === "methods" ? `<button class="library-hide-btn" data-hide-method="${escapeHtml(item.path)}" title="从网页端隐藏">删除</button>` : ""}
    </div>`).join("");
  list.onclick = event => {
    const hideBtn = event.target.closest("[data-hide-method]");
    if (hideBtn) {
      hideMethodologyDoc(hideBtn.dataset.hideMethod);
      renderLibrary(undefined, getActiveLibraryFilter(), category);
      renderLibraryFilters(category);
      renderMetrics();
      return;
    }
    const item = event.target.closest("[data-doc]");
    if (item) renderLibrary(item.dataset.doc);
  };
  document.getElementById("documentPreview").innerHTML = `
    <div class="preview-title"><div><h2>${escapeHtml(doc.title)}</h2><p>${escapeHtml(doc.path)}</p></div><span class="pill blue">只读预览</span></div>
    <div class="preview-meta">
      <span class="pill muted">${escapeHtml(doc.objectName || "Mira")}</span>
      <span class="pill muted">${escapeHtml(doc.type)}</span>
      <span class="pill muted">${escapeHtml(doc.modifiedAt ? formatDate(doc.modifiedAt) : "未知时间")}</span>
    </div>
    <div class="doc-page" data-global-source-preview="${escapeHtml(doc.path)}">
      <div class="preview-loading">正在读取只读预览...</div>
    </div>`;
  loadSourcePreview(doc, document.querySelector("[data-global-source-preview]"));
  applySearch(getCurrentSearchQuery());
}

function getHiddenMethodologyDocs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_LIBRARY_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function hideMethodologyDoc(path) {
  if (!path) return;
  const hidden = getHiddenMethodologyDocs();
  hidden.add(path);
  localStorage.setItem(HIDDEN_LIBRARY_KEY, JSON.stringify([...hidden]));
}

function getCategoryLabel(category) {
  const labels = { lessons: "经验教训", industry: "行业资料", methods: "方法论" };
  return labels[category] || category;
}

function getActiveLibraryFilter() {
  return document.querySelector("#libraryFilters button.selected")?.dataset.libraryFilter || "all";
}

function getActiveLibraryCategory() {
  return document.querySelector("#libraryCategoryFilters button.selected")?.dataset.libraryCategory || "all";
}

function searchTextForFile(file) {
  return `${file.title || ""} ${file.path || ""} ${file.type || ""} ${file.objectName || ""} ${file.objectTicker || ""}`.toLowerCase();
}

function renderLibraryFilters(category = getActiveLibraryCategory()) {
  const filters = document.getElementById("libraryFilters");
  if (!filters) return;
  const types = [...new Set(getGlobalLibraryFiles()
    .filter(file => category === "all" || file.category === category)
    .map(file => file.type)
    .filter(Boolean))]
    .sort();
  const labels = { all: "全部", md: "Markdown", pdf: "PDF", csv: "CSV", html: "HTML", xlsx: "Excel" };
  filters.innerHTML = [["all", labels.all], ...types.map(type => [type, labels[type] || type.toUpperCase()])]
    .map(([value, label], index) => `<button class="${index === 0 ? "selected" : ""}" data-library-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
    .join("");
}

function attachLibraryFilters() {
  const filters = document.getElementById("libraryFilters");
  if (!filters) return;
  filters.addEventListener("click", event => {
    const btn = event.target.closest("button[data-library-filter]");
    if (!btn) return;
    filters.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === btn));
    renderLibrary(undefined, btn.dataset.libraryFilter);
  });
}

function renderLibraryCategoryFilters() {
  const filters = document.getElementById("libraryCategoryFilters");
  if (!filters) return;
  const categories = [
    ["all", "全部"],
    ["lessons", "经验教训"],
    ["industry", "行业资料"],
    ["methods", "方法论"],
  ];
  filters.innerHTML = categories.map(([value, label], index) =>
    `<button class="${index === 0 ? "selected" : ""}" data-library-category="${value}">${label}</button>`
  ).join("");
}

function attachLibraryCategoryFilters() {
  const filters = document.getElementById("libraryCategoryFilters");
  if (!filters) return;
  filters.addEventListener("click", event => {
    const btn = event.target.closest("button[data-library-category]");
    if (!btn) return;
    filters.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === btn));
    renderLibraryFilters(btn.dataset.libraryCategory);
    renderLibrary(undefined, "all", btn.dataset.libraryCategory);
  });
}

function attachLibraryScrollControls() {
  document.querySelectorAll("[data-library-scroll]").forEach(button => {
    button.addEventListener("click", () => {
      const list = document.getElementById("libraryList");
      if (!list) return;
      const direction = button.dataset.libraryScroll === "up" ? -1 : 1;
      list.scrollBy({ top: direction * Math.max(260, list.clientHeight * 0.82), behavior: "smooth" });
    });
  });
}

function renderMetrics() {
  const metrics = document.querySelectorAll(".metric-strip article");
  const staleCount = objects.filter(item => ["stale", "needs_refresh"].includes(item.stale)).length;
  const reversalCount = objects.filter(item => item.trend.includes("反转")).length;
  const reversalConfirmedCount = objects.filter(isReversalConfirmed).length;

  const rows = [
    ["跟踪标的", objects.length, "private/research 优先"],
    ["待刷新", staleCount, `含 ${objects.filter(item => item.stale === "stale").length} 个过期`],
    ["反转尝试", reversalCount, "需确认量能"],
    ["反转确认", reversalConfirmedCount, "已确认反转结构"],
  ];

  metrics.forEach((metric, index) => {
    const row = rows[index];
    if (!row) return;
    metric.querySelector("span").textContent = row[0];
    metric.querySelector("strong").textContent = row[1];
    metric.querySelector("em").textContent = row[2];
  });
}

function isReversalConfirmed(object) {
  const text = `${object?.trend || ""} ${object?.state || ""}`;
  if (/尚无|未确认|待确认|反转尝试|不构成|缺乏确认/.test(text)) return false;
  return /反转确认|反转已确认|趋势反转|上行确认|突破确认/.test(text);
}

function renderSourceStatus() {
  const footer = document.querySelector(".sidebar-footer div");
  if (!footer) return;
  const source = bootstrapMeta.apiConnected ? "Local API" : "Local JSON";
  footer.querySelector("strong").textContent = source;
  footer.querySelector("span").textContent = bootstrapMeta.researchIndexStatus
    ? `Mira index: ${bootstrapMeta.researchIndexStatus}`
    : "Mira 本地索引";
}

function renderSourceStatusView() {
  const grid = document.getElementById("sourceStatusGrid");
  if (!grid) return;
  const files = getGlobalLibraryFiles();
  const staleCount = objects.filter(object => ["stale", "needs_refresh"].includes(object.stale)).length;
  const apiConnected = Boolean(bootstrapMeta.apiConnected);
  const operations = Array.isArray(operationCatalogData.operations) ? operationCatalogData.operations : [];
  const confirmationCount = operations.filter(operation => operation.requiresConfirmation).length;
  const calendarYearCount = Object.keys(marketCalendarData?.years || {}).length;
  const providerRows = Object.entries(providerStatusData.providers || {}).map(([name, provider]) => {
    const health = provider.health || {};
    const capabilities = provider.capabilities || {};
    const enabled = Object.entries(capabilities)
      .filter(([, value]) => value === true)
      .map(([key]) => key)
      .join(" / ") || "能力未声明";
    const tone = health.status === "healthy" ? "green" : health.status === "degraded" ? "amber" : "red";
    const status = health.status === "healthy" ? "正常" : health.status === "degraded" ? "降级" : "未知";
    const detail = `${enabled} · ${health.last_operation || "未请求"} ${health.latency_ms != null ? `${health.latency_ms}ms` : ""}`.trim();
    return [`Mira Provider · ${name}`, detail, tone, status];
  });
  const rows = [
    ["数据契约", apiConnected ? "read API contract v1" : "离线静态数据", apiConnected ? "green" : "amber", apiConnected ? "已校验" : "离线"],
    ["受控操作", operations.length ? `${operations.length} 项；${confirmationCount} 项需要确认` : operationCatalogData.message || "操作目录不可用", operations.length ? "amber" : "red", operations.length ? "受控" : "未接入"],
    ["A股交易日历", calendarYearCount ? `${calendarYearCount} 个年份 · ${marketCalendarData?.source?.notice || "本地日历"}` : "交易日历未知", calendarYearCount ? "green" : "amber", calendarYearCount ? "已接入" : "未知"],
    ["前端数据源", bootstrapMeta.loadedFrom || "embedded-fallback", apiConnected ? "green" : "red", apiConnected ? "已接入" : "未接入"],
    ["Mira 根目录", bootstrapMeta.miraRoot || "未连接", bootstrapMeta.miraRoot ? "green" : "red", bootstrapMeta.miraRoot ? "已接入" : "未接入"],
    ["研究对象", `${objects.length} 个`, objects.length ? "green" : "red", objects.length ? "已接入" : "未接入"],
    ["资料文件", `${files.length} 个`, files.length ? "green" : "red", files.length ? "已接入" : "未接入"],
    ["文件预览", apiConnected ? "/api/source-file · 只读文本" : "API 不可用", apiConnected ? "green" : "red", apiConnected ? "已接入" : "未接入"],
    ["Mira Provider状态", providerStatusData.generated_at || providerStatusData.message || "尚未生成", providerStatusData.status === "ok" ? "green" : "amber", providerStatusData.status === "ok" ? "已接入" : "待生成"],
    ...providerRows,
    ["MiraBoard行情路由", apiConnected ? "A股 Eastmoney → stock-api → Yahoo；其他市场 Yahoo" : "API 不可用", apiConnected ? "green" : "red", apiConnected ? "已接入" : "未接入"],
    ["Mira 工作流写入", "AI 连接与结构校验通过后写入", "amber", "条件写入"],
    ["刷新队列", `${staleCount} 个待刷新`, staleCount ? "amber" : "green", staleCount ? "待处理" : "正常"],
  ];
  grid.innerHTML = rows.map(([title, value, tone, status]) => `
    <article class="source-status-card ${tone}">
      <div class="source-status-head">
        <span class="source-status-title">${escapeHtml(title)}</span>
        <span class="source-status-indicator ${tone}"><i aria-hidden="true"></i>${escapeHtml(status)}</span>
      </div>
      <strong>${escapeHtml(value)}</strong>
    </article>`).join("");
}

function buildUpdateQueue() {
  return objects
    .map((object, objectIndex) => ({ object, objectIndex }))
    .filter(({ object }) => ["stale", "needs_refresh"].includes(object.stale))
    .sort((a, b) => {
      const rank = { stale: 0, needs_refresh: 1, fresh: 2 };
      return (rank[a.object.stale] ?? 9) - (rank[b.object.stale] ?? 9);
    });
}

function renderUpdateQueue() {
  const list = document.getElementById("updateQueueList");
  if (!list) return;
  const queue = buildUpdateQueue();
  if (!queue.length) {
    list.innerHTML = `<div class="empty-card-state">当前没有待刷新对象</div>`;
    return;
  }
  list.innerHTML = queue.map(({ object, objectIndex }) => `
    <article class="queue-item ${object.stale}">
      <div>
        <strong>${escapeHtml(object.name || object.ticker)}</strong>
        <span>${escapeHtml(object.ticker || "未命名")} · ${escapeHtml(object.market || "未知市场")} · ${escapeHtml(object.path || "路径待接入")}</span>
      </div>
      <span class="pill ${object.stale === "stale" ? "red" : "amber"}">${escapeHtml(refreshLabel(object.stale))}</span>
      <button class="ghost-btn" data-queue-open="${objectIndex}">查看</button>
    </article>`).join("");
}

function attachQueueActions() {
  const list = document.getElementById("updateQueueList");
  if (!list) return;
  list.addEventListener("click", event => {
    const btn = event.target.closest("[data-queue-open]");
    if (btn) openDetail(Number(btn.dataset.queueOpen));
  });
}

function renderIndustryView() {
  const grid = document.getElementById("industryGrid");
  if (!grid) return;
  const groups = groupObjectsByMarket();
  grid.innerHTML = groups.map(group => `
    <section class="panel industry-panel">
      <div class="panel-header compact">
        <div>
          <h2>${escapeHtml(group.market)}</h2>
          <p>${group.items.length} 个对象 · ${group.files} 个资料文件</p>
        </div>
      </div>
      <div class="industry-object-list">
        ${group.items.map(({ object, index }) => `
          <button class="industry-object" data-industry-open="${index}">
            <strong>${escapeHtml(object.name || object.ticker)}</strong>
            <span>${escapeHtml(object.ticker || "未命名")} · ${escapeHtml(refreshLabel(object.stale))} · ${Number(object.fileCount || 0)} 文件</span>
          </button>`).join("")}
      </div>
    </section>`).join("");
}

function groupObjectsByMarket() {
  const map = new Map();
  objects.forEach((object, index) => {
    const market = object.market || "行业分析";
    if (!map.has(market)) map.set(market, []);
    map.get(market).push({ object, index });
  });
  return [...map.entries()].map(([market, items]) => ({
    market,
    items,
    files: items.reduce((sum, item) => sum + (item.object.fileCount || 0), 0),
  })).sort((a, b) => a.market.localeCompare(b.market));
}

function attachIndustryActions() {
  const grid = document.getElementById("industryGrid");
  if (!grid) return;
  grid.addEventListener("click", event => {
    const btn = event.target.closest("[data-industry-open]");
    if (btn) openDetail(Number(btn.dataset.industryOpen));
  });
}

function renderSettingsView() {
  const grid = document.getElementById("settingsGrid");
  if (!grid) return;
  const rows = [
    ["Mira 根目录", bootstrapMeta.miraRoot || "../Mira", "环境变量 MIRABOARD_MIRA_ROOT 可覆盖。"],
    ["服务端口", "5178-5185", "start.bat 会自动选择空闲端口。"],
    ["Mira 写入", "条件启用", "仅当 AI 已连接、来源可用且输出通过结构校验时写入。"],
    ["文件预览", "启用", "仅限 Mira 根目录内文本文件。"],
    ["行情数据", "已接入", "A 股先调用 Mira Eastmoney 技术链路，失败时明确降级到 Yahoo。"],
    ["缓存", "浏览器内存", "正文预览按路径缓存，刷新页面后重置。"],
  ];
  grid.innerHTML = rows.map(([title, value, note]) => `
    <article class="settings-card">
      <span>${title}</span>
      <strong>${value}</strong>
      <p>${note}</p>
    </article>`).join("") + `
    <section class="ai-settings-panel">
      <div class="ai-settings-head">
        <div>
          <h2>AI 模型接口</h2>
          <p>连接其他支持 OpenAI 兼容协议的大模型服务。</p>
        </div>
        <div class="ai-connection-status disconnected" id="aiConnectionStatus" aria-live="polite">
          <i aria-hidden="true"></i><span>未接入</span>
        </div>
      </div>
      <form class="ai-settings-form" id="aiSettingsForm">
        <label>
          <span>服务商</span>
          <select id="aiProvider">
            <option>OpenAI 兼容接口</option>
            <option>DeepSeek</option>
            <option>通义千问</option>
            <option>Moonshot</option>
            <option>本地模型</option>
            <option>其他</option>
          </select>
        </label>
        <label class="ai-field-wide">
          <span>API 地址</span>
          <input id="aiBaseUrl" type="url" placeholder="https://example.com/v1" autocomplete="url" />
          <em>填写兼容接口的基础地址，系统会调用 /chat/completions。</em>
        </label>
        <label>
          <span>模型名称</span>
          <input id="aiModel" type="text" placeholder="例如 model-name" autocomplete="off" />
        </label>
        <label class="ai-field-wide">
          <span>API 密钥</span>
          <input id="aiApiKey" type="password" placeholder="输入后不会回显" autocomplete="new-password" />
          <em id="aiKeyHint">密钥仅保存在当前本地服务进程内。</em>
        </label>
        <div class="ai-settings-actions ai-field-wide">
          <p id="aiSettingsMessage">尚未配置模型接口。</p>
          <div>
            <button class="ghost-btn" type="submit" id="aiSaveButton">保存设置</button>
            <button class="price-refresh-all-btn" type="button" id="aiTestButton">测试连接</button>
          </div>
        </div>
      </form>
    </section>`;
  attachAiSettingsActions();
  loadAiConfigStatus();
}

async function loadAiConfigStatus() {
  try {
    const payload = await fetchReadJson("/api/read/ai-config", "ai-config");
    applyAiConfigToSettings(payload.config || {});
  } catch (error) {
    updateAiConnectionStatus({ status: "error", message: "配置接口未接入" });
  }
}

function applyAiConfigToSettings(config) {
  const provider = document.getElementById("aiProvider");
  const baseUrl = document.getElementById("aiBaseUrl");
  const model = document.getElementById("aiModel");
  if (provider && config.provider) provider.value = config.provider;
  if (baseUrl) baseUrl.value = config.baseUrl || "";
  if (model) model.value = config.model || "";
  const keyHint = document.getElementById("aiKeyHint");
  if (keyHint) keyHint.textContent = config.hasApiKey
    ? "密钥已保存在当前服务进程内；留空可继续使用。"
    : "密钥仅保存在当前本地服务进程内。";
  updateAiConnectionStatus(config);
}

function updateAiConnectionStatus(config) {
  const status = document.getElementById("aiConnectionStatus");
  const message = document.getElementById("aiSettingsMessage");
  if (!status || !message) return;
  const tone = config.status === "connected" ? "connected" : config.status === "saved" ? "saved" : "disconnected";
  const label = config.status === "connected" ? "已接入" : config.status === "saved" ? "待测试" : "未接入";
  status.className = `ai-connection-status ${tone}`;
  status.querySelector("span").textContent = label;
  message.textContent = config.message || "尚未配置模型接口。";
}

function collectAiSettings() {
  return {
    provider: document.getElementById("aiProvider")?.value || "OpenAI 兼容接口",
    baseUrl: document.getElementById("aiBaseUrl")?.value.trim() || "",
    model: document.getElementById("aiModel")?.value.trim() || "",
    apiKey: document.getElementById("aiApiKey")?.value.trim() || "",
  };
}

async function saveAiSettings() {
  const payload = await fetchOperationJson("/api/ops/ai-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectAiSettings()),
  });
  applyAiConfigToSettings(payload.config || { status: "error", message: payload.message });
  if (payload.status !== "ok") throw new Error(payload.message || "保存失败");
  const key = document.getElementById("aiApiKey");
  if (key) key.value = "";
  return payload;
}

function attachAiSettingsActions() {
  const form = document.getElementById("aiSettingsForm");
  const saveButton = document.getElementById("aiSaveButton");
  const testButton = document.getElementById("aiTestButton");
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    setButtonBusy(saveButton, true);
    try {
      await saveAiSettings();
    } catch (error) {
      updateAiConnectionStatus({ status: "error", message: error.message });
    } finally {
      setButtonBusy(saveButton, false);
    }
  });
  testButton?.addEventListener("click", async () => {
    setButtonBusy(testButton, true);
    updateAiConnectionStatus({ status: "saved", message: "正在测试模型接口..." });
    try {
      await saveAiSettings();
      const payload = await fetchOperationJson("/api/ops/ai-test", { method: "POST", timeoutMs: 30000 });
      applyAiConfigToSettings(payload.config || { status: "error", message: payload.message });
    } catch (error) {
      updateAiConnectionStatus({ status: "error", message: error.message });
    } finally {
      setButtonBusy(testButton, false);
    }
  });
}

function initSearch() {
  const input = document.getElementById("searchInput");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    applySearch(q);
  });
}

function formatMarketPulseValue(item) {
  if (!item || item.status !== "ok" || !Number.isFinite(Number(item.value))) return "未获取";
  const digits = item.kind === "yield" ? 3 : item.id === "usd_hkd" ? 4 : item.kind === "index" ? 2 : 4;
  return `${Number(item.value).toFixed(digits)}${item.unit || ""}`;
}

function formatMarketPulseChange(item) {
  if (!item || item.status !== "ok" || !Number.isFinite(Number(item.change))) return "变动未提供";
  if (item.kind === "yield") {
    const basisPoints = Number(item.change) * 100;
    return `${basisPoints >= 0 ? "+" : ""}${basisPoints.toFixed(1)}bp`;
  }
  const digits = item.kind === "index" ? 2 : 4;
  return `${Number(item.change) >= 0 ? "+" : ""}${Number(item.change).toFixed(digits)}`;
}

function renderMarketPulse() {
  const grid = document.getElementById("marketPulseGrid");
  const status = document.getElementById("marketPulseStatus");
  const message = document.getElementById("marketPulseMessage");
  if (!grid || !status || !message) return;
  const items = Array.isArray(marketPulseData?.items) ? marketPulseData.items : [];
  const statusMap = {
    ok: ["已读取", "green"],
    source_gap: ["部分不可用", "amber"],
    unavailable: ["未获取", "red"],
  };
  const [label, tone] = statusMap[marketPulseData?.status] || ["正在读取", "muted"];
  status.textContent = label;
  status.className = `pill ${tone}`;
  grid.innerHTML = items.length ? items.map(item => {
    const sourceUrl = safeExternalUrl(item.url);
    const isPositive = Number(item.change) >= 0;
    return `
      <article class="market-pulse-item ${item.status === "ok" ? "" : "is-unavailable"}" data-search-text="${escapeHtml(`${item.label} ${item.provider || ""}`).toLowerCase()}">
        <div class="market-pulse-item-head"><span>${escapeHtml(item.label || "未命名数据")}</span><em>${escapeHtml(item.sourceDate || "日期未提供")}</em></div>
        <strong>${escapeHtml(formatMarketPulseValue(item))}</strong>
        <div class="market-pulse-item-footer">
          <span class="${item.status === "ok" ? (isPositive ? "positive" : "negative") : "muted-change"}">${escapeHtml(formatMarketPulseChange(item))}</span>
          ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">来源</a>` : `<span>${escapeHtml(item.message || "数据不可用")}</span>`}
        </div>
      </article>`;
  }).join("") : `<div class="empty-card-state">金融市场数据尚未读取；不会以静态样例替代实时或延迟行情。</div>`;
  message.textContent = marketPulseData?.message || "";
}

function renderResearchFeed() {
  const list = document.getElementById("researchFeedList");
  const status = document.getElementById("researchFeedStatus");
  const filters = document.getElementById("feedScopeFilters");
  if (!list || !status || !filters) return;
  filters.querySelectorAll("[data-feed-scope]").forEach(button => {
    button.classList.toggle("selected", button.dataset.feedScope === activeFeedScope);
  });
  const data = researchFeedData[activeFeedScope] || { status: "idle", items: [] };
  const scopeLabel = activeFeedScope === "held" ? "持仓行业" : "自选标的行业";
  if (data.status === "loading") {
    status.textContent = `正在读取${scopeLabel}相关新闻；来源返回前不展示历史样例。`;
    list.innerHTML = `<div class="empty-card-state">正在读取行业新闻…</div>`;
    return;
  }
  if (!Array.isArray(data.items) || !data.items.length) {
    status.textContent = data.message || `当前未发现可用${scopeLabel}新闻线索。`;
    list.innerHTML = `<div class="empty-card-state">当前未发现可用行业新闻线索。可在稍后重新进入本页读取。</div>`;
    return;
  }
  status.textContent = `${scopeLabel} · ${data.items.length} 个事件线索 · ${data.message || "均需原文核验"}`;
  list.innerHTML = data.items.map(item => {
    const related = Array.isArray(item.relatedObjects) ? item.relatedObjects : [];
    const source = (item.sources || [])[0] || {};
    const sourceUrl = safeExternalUrl(source.url);
    const searchText = `${item.title || ""} ${item.summary || ""} ${related.map(object => `${object.ticker || ""} ${object.name || ""}`).join(" ")}`.toLowerCase();
    return `
      <article class="research-feed-item" data-search-text="${escapeHtml(searchText)}">
        <div class="research-feed-meta">
          <span class="pill amber">待核验</span>
          <span>${escapeHtml(item.publishedAt || "发布时间未提供")}</span>
          <span>${Number(item.sourceCount || 0)} 个来源</span>
        </div>
        <h3>${escapeHtml(item.title || "未命名行业新闻")}</h3>
        <p>${escapeHtml(item.summary || "该条目未提供摘要，请查看原文。")}</p>
        <div class="research-feed-footer">
          <div class="feed-related-objects">
            <span>关联：</span>
            ${related.map(object => `<button class="feed-object-link" data-feed-open="${escapeHtml(object.ticker || "")}">${escapeHtml(object.name || object.ticker || "未命名对象")}</button>`).join("") || "<span>对象待确认</span>"}
          </div>
          ${sourceUrl ? `<a class="feed-source-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">查看原文</a>` : ""}
        </div>
      </article>`;
  }).join("");
}

function attachResearchFeedActions() {
  const filters = document.getElementById("feedScopeFilters");
  const list = document.getElementById("researchFeedList");
  filters?.addEventListener("click", event => {
    const button = event.target.closest("[data-feed-scope]");
    if (!button || button.dataset.feedScope === activeFeedScope) return;
    activeFeedScope = button.dataset.feedScope;
    renderResearchFeed();
    if (researchFeedData[activeFeedScope]?.status === "idle") loadResearchFeed(activeFeedScope);
  });
  list?.addEventListener("click", event => {
    const button = event.target.closest("[data-feed-open]");
    if (!button) return;
    const ticker = String(button.dataset.feedOpen || "").toUpperCase();
    const index = objects.findIndex(object => String(object.ticker || "").toUpperCase() === ticker);
    if (index >= 0) openDetail(index);
  });
}

function getCurrentSearchQuery() {
  return document.getElementById("searchInput")?.value.trim().toLowerCase() || "";
}

function applySearch(q) {
  document.querySelectorAll("[data-search-text]").forEach(element => {
    element.style.display = !q || element.dataset.searchText.includes(q) ? "" : "none";
  });
}

function renderAppShell() {
  renderNav();
  renderSourceStatus();
  renderMetrics();
  renderOverviewFilters();
  renderCards("A股");
  renderRadar();
  renderRadarFocus();
  renderMarketPulse();
  renderResearchFeed();
  renderTargetFilters();
  renderTargets("A股");
  renderDetailShell();
  renderReader();
  renderActivity();
  renderLibrary();
  renderLibraryFilters();
  renderLibraryCategoryFilters();
  renderPortfolio();
  attachTabs();
  attachUpdateButtons();
  attachRadarFocus();
  attachOverviewFilters();
  attachTargetFilters();
  attachLibraryFilters();
  attachLibraryCategoryFilters();
  attachLibraryScrollControls();
  attachQueueActions();
  attachIndustryActions();
  attachPortfolioActions();
  attachResearchFeedActions();
  initSearch();
}

async function loadBackgroundContext({ loadPortfolio = false } = {}) {
  const tasks = [
    loadProviderStatus(),
    loadMarketPulse(),
    loadMarketCalendar(),
    loadMarketSession(),
    loadPositionReviews(),
    loadOperationCatalog(),
  ];
  if (loadPortfolio) tasks.push(loadPortfolioPerformance());
  await Promise.all(tasks);
  renderSourceStatus();
  renderMarketPulse();
  renderResearchFeed();
  renderPortfolio();
  if (document.getElementById("sourcesView")?.classList.contains("active")) renderSourceStatusView();
  if (document.getElementById("settingsView")?.classList.contains("active")) renderSettingsView();
}

async function initApp() {
  const cachedSnapshot = restoreAppSnapshot();
  if (cachedSnapshot) {
    renderAppShell();
    const statusNode = document.getElementById("overviewQuoteStatus");
    if (statusNode) statusNode.textContent = cachedSnapshotLabel(cachedSnapshot);
    void loadBackgroundContext({ loadPortfolio: false });
    return;
  }

  await loadBootstrap();
  await Promise.all([loadOverviewQuoteArchive(), loadOverviewPriceHistory()]);
  renderAppShell();
  persistAppSnapshot("initial_local_load");
  void loadBackgroundContext({ loadPortfolio: true }).then(() => {
    persistAppSnapshot("initial_local_load");
  });
}

initApp();
