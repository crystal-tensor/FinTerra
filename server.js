import express from "express";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const app = express();

app.use(express.json({ limit: "1mb" }));

const latestTrainingModelPath = path.join(__dirname, ".tmp", "latest-training-model.json");
const modelOverviewDataPath = path.join(__dirname, "strategy", "model_overview_data.json");
const selectedMarketStocksPath = path.join(__dirname, ".tmp", "selected-market-stocks.json");
const selectorExperimentHistoryPath = path.join(__dirname, ".tmp", "asset-selector-experiments.json");
const tempDir = path.join(__dirname, ".tmp");
const timeSplitProgressFiles = [
  "time-split-a-progress.json",
  "time-split-us-progress.json",
  "time-split-hk-progress.json",
  "time-split-crypto-progress.json",
  "time-split-progress.json"
];
const selectorSourceCandidates = [
  "live-four-market-with-crypto-momentum-model.json",
  "live-four-market-gated-combined-model.json",
  "latest-training-model.json"
];
const newsDir = path.join(__dirname, "news");
const mirofishRoundtableWorkerPath = path.join(__dirname, "scripts", "mirofish_financial_roundtable.py");
const marketGraphCache = {
  data: null,
  updatedAt: 0,
  ttlMs: 60_000
};
const hkNameOverrides = {
  "0167.HK": "万威国际",
  "0115.HK": "钧濠集团",
  "0064.HK": "结好控股",
  "0122.HK": "鳄鱼恤",
  "0103.HK": "首佳科技",
  "0148.HK": "建滔集团",
  "0138.HK": "中建电讯",
  "0085.HK": "中电华大科技",
  "0164.HK": "中国宝力科技",
  "0108.HK": "国锐地产",
  "0117.HK": "天利控股集团",
  "0065.HK": "弘海高新资源",
  "0092.HK": "冠军科技集团",
  "0030.HK": "ABC Communications",
  "0133.HK": "招商局中国基金",
  "0081.HK": "中国海外宏洋集团",
  "0113.HK": "迪生创建",
  "0114.HK": "Herald Holdings",
  "0014.HK": "希慎兴业",
  "0124.HK": "粤海置地",
  "0084.HK": "宝光实业",
  "0154.HK": "北京控股环境集团",
  "0090.HK": "普星能量"
};

function displayStockName(stock, marketName) {
  if (marketName === "港股" && (!stock.name || stock.name === stock.symbol)) {
    return hkNameOverrides[stock.symbol] || stock.name || stock.symbol;
  }
  return stock.name || stock.symbol;
}

const rssParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text"
});

const financialServicesRepo = {
  name: "anthropics/financial-services",
  url: "https://github.com/anthropics/financial-services",
  installedPath: path.join(__dirname, "vendor", "financial-services")
};

const financialServiceConnectors = [
  { id: "daloopa", name: "Daloopa", category: "fundamentals", url: "https://mcp.daloopa.com/server/mcp", usefulFor: "标准化财务数据、模型更新、历史指标抽取", access: "subscription" },
  { id: "morningstar", name: "Morningstar", category: "research", url: "https://mcp.morningstar.com/mcp", usefulFor: "基金、资产配置、评级与研究材料", access: "subscription" },
  { id: "sp-global", name: "S&P Global / Capital IQ", category: "research-news", url: "https://kfinance.kensho.com/integrations/mcp", usefulFor: "公司资料、财报预览、tear sheet、新闻与交易数据", access: "subscription" },
  { id: "factset", name: "FactSet", category: "market-data", url: "https://mcp.factset.com/mcp", usefulFor: "一致预期、公司财务、行情、研报工作流", access: "subscription" },
  { id: "moodys", name: "Moody's", category: "credit", url: "https://api.moodys.com/genai-ready-data/m1/mcp", usefulFor: "信用评级、债务风险、宏观信用事件", access: "subscription" },
  { id: "mtnewswire", name: "MT Newswires", category: "news", url: "https://vast-mcp.blueskyapi.com/mtnewswires", usefulFor: "实时市场新闻、公司快讯、宏观资讯", access: "subscription" },
  { id: "aiera", name: "Aiera", category: "transcripts-events", url: "https://mcp-pub.aiera.com", usefulFor: "财报会、投资者日、电话会转录与事件流", access: "subscription" },
  { id: "lseg", name: "LSEG", category: "market-data-news", url: "https://api.analytics.lseg.com/lfa/mcp", usefulFor: "宏观利率、FX、债券、股票研究和新闻数据", access: "subscription" },
  { id: "pitchbook", name: "PitchBook", category: "private-markets", url: "https://premium.mcp.pitchbook.com/mcp", usefulFor: "私募市场、融资、交易、公司画像", access: "subscription" },
  { id: "chronograph", name: "Chronograph", category: "portfolio-monitoring", url: "https://ai.chronograph.pe/mcp", usefulFor: "私募基金组合监控、GP/LP 报告", access: "subscription" },
  { id: "egnyte", name: "Egnyte", category: "documents", url: "https://mcp-server.egnyte.com/mcp", usefulFor: "投委会、财报、客户文件库检索", access: "subscription" },
  { id: "box", name: "Box", category: "documents", url: "https://mcp.box.com", usefulFor: "企业文件、交易材料、模型和报告协作", access: "subscription" }
];

const financialServiceAgents = [
  { id: "pitch-agent", name: "Pitch Agent", group: "Coverage & advisory", trigger: "生成 pitch book", mapHook: "把估值区间、可比公司和交易理由同步为目标公司地图事件", produces: ["估值模型", "Pitch deck", "Football field"], connectors: ["sp-global", "factset", "daloopa"] },
  { id: "meeting-prep-agent", name: "Meeting Prep Agent", group: "Coverage & advisory", trigger: "准备客户会议", mapHook: "把客户持仓、近期新闻和建议议程同步到区域与持仓节点", produces: ["会议简报", "Talking points"], connectors: ["sp-global", "egnyte", "box"] },
  { id: "market-researcher", name: "Market Researcher", group: "Research & modeling", trigger: "研究行业/主题", mapHook: "把主题、竞争格局和候选股票同步为跨区域资讯链路", produces: ["行业概览", "竞争格局", "Ideas shortlist"], connectors: ["sp-global", "factset", "lseg"] },
  { id: "earnings-reviewer", name: "Earnings Reviewer", group: "Research & modeling", trigger: "财报后更新", mapHook: "把财报 surprise、指引和估值变化同步到公司所在市场", produces: ["财报笔记", "模型更新", "Variance table"], connectors: ["factset", "daloopa", "aiera"] },
  { id: "model-builder", name: "Model Builder", group: "Research & modeling", trigger: "构建估值模型", mapHook: "把 DCF/LBO/三表模型输出绑定到相关公司和同业节点", produces: ["DCF", "LBO", "三表模型", "Comps"], connectors: ["sp-global", "factset", "daloopa"] },
  { id: "valuation-reviewer", name: "Valuation Reviewer", group: "Fund admin & finance ops", trigger: "复核组合估值", mapHook: "把组合公司估值偏离和 NAV 影响同步到基金地图", produces: ["估值摘要", "Waterfall", "LP 报告包"], connectors: ["chronograph", "box", "egnyte"] },
  { id: "gl-reconciler", name: "GL Reconciler", group: "Fund admin & finance ops", trigger: "GL/Subledger 对账", mapHook: "把 break 原因按资产类别和交易市场挂到地图异常点", produces: ["Break list", "Root-cause trace", "异常报告"], connectors: ["egnyte", "box"] },
  { id: "month-end-closer", name: "Month-End Closer", group: "Fund admin & finance ops", trigger: "月结 close package", mapHook: "把重大 flux、应计和 roll-forward 异常同步到实体/地区", produces: ["Accrual schedule", "Roll-forward", "Variance commentary"], connectors: ["egnyte", "box"] },
  { id: "statement-auditor", name: "Statement Auditor", group: "Fund admin & finance ops", trigger: "LP statement 审核", mapHook: "把 NAV tie-out 差异和 hold/pass 状态同步到基金节点", produces: ["Tie-out table", "Exception list", "Sign-off sheet"], connectors: ["chronograph", "box"] },
  { id: "kyc-screener", name: "KYC Screener", group: "Operations & onboarding", trigger: "KYC/AML 筛查", mapHook: "把客户所在地、受益人、制裁/PEP 风险同步到全球合规地图", produces: ["实体档案", "规则结果", "升级包"], connectors: ["egnyte", "box"] }
];

const newsFeeds = [
  {
    id: "yahoo-global",
    name: "Yahoo Finance headline",
    url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EIXIC,%5EDJI,%5EFTSE,%5EN225,GC=F,CL=F,BTC-USD&region=US&lang=en-US",
    defaultNodeId: "spx"
  },
  { id: "cnbc-markets", name: "CNBC Markets", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", defaultNodeId: "spx" },
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", defaultNodeId: "ust10y" },
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", defaultNodeId: "btc" },
  { id: "ecb", name: "European Central Bank", url: "https://www.ecb.europa.eu/rss/press.html", defaultNodeId: "eurusd" }
];

const newsKeywordMap = [
  { nodeId: "btc", tokens: ["bitcoin", "btc", "crypto", "ethereum", "ether", "coinbase", "stablecoin"] },
  { nodeId: "eth", tokens: ["ethereum", "ether"] },
  { nodeId: "ust10y", tokens: ["fed", "treasury", "yield", "rate", "inflation", "powell", "fomc"] },
  { nodeId: "dxy", tokens: ["dollar", "fx", "currency", "yen", "euro"] },
  { nodeId: "gold", tokens: ["gold", "bullion", "safe haven"] },
  { nodeId: "crude", tokens: ["oil", "crude", "opec", "energy"] },
  { nodeId: "copper", tokens: ["copper", "industrial metals"] },
  { nodeId: "nasdaq", tokens: ["nasdaq", "tech", "ai", "nvidia", "apple", "microsoft"] },
  { nodeId: "spx", tokens: ["s&p", "wall street", "stocks", "equities", "market"] },
  { nodeId: "hsi", tokens: ["hong kong", "china", "yuan", "beijing"] },
  { nodeId: "nikkei", tokens: ["japan", "boj", "tokyo", "yen"] },
  { nodeId: "ftse", tokens: ["uk", "britain", "london", "boe"] },
  { nodeId: "dax", tokens: ["germany", "eurozone", "ecb", "europe"] }
];

const newsCategories = [
  { id: "finance", label: "财经", tokens: ["finance", "market", "stock", "equity", "index", "wall street"] },
  { id: "technology", label: "科技", tokens: ["tech", "ai", "semiconductor", "software", "cloud", "chip", "spacex"] },
  { id: "economic-data", label: "经济数据", tokens: ["gdp", "cpi", "pce", "payroll", "jobs", "inflation", "retail sales", "pmi"] },
  { id: "central-bank", label: "央行政策", tokens: ["fed", "ecb", "boj", "pboc", "rate", "powell", "central bank"] },
  { id: "rates", label: "利率债券", tokens: ["yield", "treasury", "bond", "curve", "duration", "credit spread"] },
  { id: "fx", label: "外汇", tokens: ["dollar", "yen", "euro", "currency", "fx", "yuan", "sterling"] },
  { id: "commodities", label: "大宗商品", tokens: ["oil", "crude", "gold", "copper", "commodity", "gas", "opec"] },
  { id: "crypto", label: "加密资产", tokens: ["bitcoin", "ethereum", "crypto", "token", "stablecoin", "defi", "blockchain"] },
  { id: "geopolitics", label: "地缘政治", tokens: ["iran", "war", "tariff", "sanction", "hormuz", "election", "conflict"] },
  { id: "earnings", label: "财报业绩", tokens: ["earnings", "revenue", "eps", "guidance", "profit", "margin", "forecast"] },
  { id: "ipo-ma", label: "IPO/并购", tokens: ["ipo", "merger", "acquisition", "m&a", "takeover", "deal"] },
  { id: "regulation", label: "监管合规", tokens: ["regulation", "sec", "antitrust", "probe", "lawsuit", "compliance"] },
  { id: "credit", label: "信用风险", tokens: ["default", "rating", "debt", "bankruptcy", "credit", "downgrade"] },
  { id: "real-estate", label: "地产", tokens: ["real estate", "housing", "mortgage", "property", "reit"] },
  { id: "consumer", label: "消费", tokens: ["consumer", "retail", "sales", "walmart", "amazon", "shopping"] },
  { id: "energy", label: "能源", tokens: ["energy", "oil", "gas", "power", "renewable", "solar"] },
  { id: "healthcare", label: "医疗", tokens: ["health", "drug", "biotech", "pharma", "fda", "clinical"] },
  { id: "china-hk", label: "中国/港股", tokens: ["china", "hong kong", "beijing", "yuan", "hang seng"] },
  { id: "europe", label: "欧洲", tokens: ["europe", "eurozone", "uk", "britain", "germany", "france"] },
  { id: "risk", label: "风险预警", tokens: ["risk", "warning", "drop", "slump", "selloff", "volatility", "fear"] },
  { id: "other", label: "其他", tokens: [] }
];

const markets = [
  {
    id: "a-share",
    name: "A股",
    region: "Shanghai / Shenzhen",
    stocks: [
      { symbol: "688027.SS", name: "国盾量子" },
      { symbol: "600519.SS", name: "贵州茅台" },
      { symbol: "601318.SS", name: "中国平安" },
      { symbol: "600036.SS", name: "招商银行" },
      { symbol: "600900.SS", name: "长江电力" },
      { symbol: "601899.SS", name: "紫金矿业" },
      { symbol: "601398.SS", name: "工商银行" },
      { symbol: "600276.SS", name: "恒瑞医药" },
      { symbol: "688981.SS", name: "中芯国际" },
      { symbol: "688111.SS", name: "金山办公" },
      { symbol: "000858.SZ", name: "五粮液" },
      { symbol: "000333.SZ", name: "美的集团" },
      { symbol: "000651.SZ", name: "格力电器" },
      { symbol: "000001.SZ", name: "平安银行" },
      { symbol: "002594.SZ", name: "比亚迪" },
      { symbol: "002415.SZ", name: "海康威视" },
      { symbol: "300750.SZ", name: "宁德时代" },
      { symbol: "300760.SZ", name: "迈瑞医疗" },
      { symbol: "300059.SZ", name: "东方财富" },
      { symbol: "002230.SZ", name: "科大讯飞" }
    ]
  },
  {
    id: "us",
    name: "美股",
    region: "NYSE / Nasdaq",
    stocks: [
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "GOOGL", name: "Alphabet A" },
      { symbol: "AMZN", name: "Amazon" },
      { symbol: "META", name: "Meta" },
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "BRK-B", name: "Berkshire Hathaway" },
      { symbol: "JPM", name: "JPMorgan Chase" },
      { symbol: "V", name: "Visa" },
      { symbol: "LLY", name: "Eli Lilly" },
      { symbol: "AVGO", name: "Broadcom" },
      { symbol: "WMT", name: "Walmart" },
      { symbol: "MA", name: "Mastercard" },
      { symbol: "ORCL", name: "Oracle" },
      { symbol: "NFLX", name: "Netflix" },
      { symbol: "AMD", name: "AMD" },
      { symbol: "COST", name: "Costco" },
      { symbol: "PLTR", name: "Palantir" },
      { symbol: "COIN", name: "Coinbase" }
    ]
  },
  {
    id: "hk",
    name: "港股",
    region: "HKEX",
    stocks: [
      { symbol: "0700.HK", name: "腾讯控股" },
      { symbol: "9988.HK", name: "阿里巴巴-W" },
      { symbol: "3690.HK", name: "美团-W" },
      { symbol: "9618.HK", name: "京东集团-SW" },
      { symbol: "1810.HK", name: "小米集团-W" },
      { symbol: "1299.HK", name: "友邦保险" },
      { symbol: "0941.HK", name: "中国移动" },
      { symbol: "0883.HK", name: "中国海洋石油" },
      { symbol: "2318.HK", name: "中国平安" },
      { symbol: "0939.HK", name: "建设银行" },
      { symbol: "1398.HK", name: "工商银行" },
      { symbol: "3988.HK", name: "中国银行" },
      { symbol: "1211.HK", name: "比亚迪股份" },
      { symbol: "1024.HK", name: "快手-W" },
      { symbol: "9999.HK", name: "网易-S" },
      { symbol: "2015.HK", name: "理想汽车-W" },
      { symbol: "9868.HK", name: "小鹏汽车-W" },
      { symbol: "0981.HK", name: "中芯国际" },
      { symbol: "0388.HK", name: "香港交易所" },
      { symbol: "0005.HK", name: "汇丰控股" }
    ]
  },
  {
    id: "crypto",
    name: "加密货币",
    region: "Crypto / USD",
    stocks: [
      { symbol: "BTC-USD", name: "Bitcoin" },
      { symbol: "ETH-USD", name: "Ethereum" },
      { symbol: "BNB-USD", name: "BNB" },
      { symbol: "SOL-USD", name: "Solana" },
      { symbol: "XRP-USD", name: "XRP" },
      { symbol: "DOGE-USD", name: "Dogecoin" },
      { symbol: "ADA-USD", name: "Cardano" },
      { symbol: "TRX-USD", name: "TRON" },
      { symbol: "AVAX-USD", name: "Avalanche" },
      { symbol: "LINK-USD", name: "Chainlink" },
      { symbol: "DOT-USD", name: "Polkadot" },
      { symbol: "LTC-USD", name: "Litecoin" },
      { symbol: "BCH-USD", name: "Bitcoin Cash" },
      { symbol: "UNI-USD", name: "Uniswap" },
      { symbol: "AAVE-USD", name: "Aave" },
      { symbol: "ETC-USD", name: "Ethereum Classic" },
      { symbol: "XLM-USD", name: "Stellar" },
      { symbol: "HBAR-USD", name: "Hedera" },
      { symbol: "FIL-USD", name: "Filecoin" },
      { symbol: "ATOM-USD", name: "Cosmos" }
    ]
  }
];

const globalMarketInstruments = [
  { id: "spx", label: "S&P 500", symbol: "^GSPC", type: "equity", region: "Americas", country: "United States", lat: 40.7128, lon: -74.006, importance: 10, hub: "hub-americas" },
  { id: "nasdaq", label: "Nasdaq", symbol: "^IXIC", type: "equity", region: "Americas", country: "United States", lat: 40.7128, lon: -74.006, importance: 10, hub: "hub-americas" },
  { id: "dow", label: "Dow Jones", symbol: "^DJI", type: "equity", region: "Americas", country: "United States", lat: 40.7128, lon: -74.006, importance: 8, hub: "hub-americas" },
  { id: "tsx", label: "TSX", symbol: "^GSPTSE", type: "equity", region: "Americas", country: "Canada", lat: 43.6532, lon: -79.3832, importance: 6, hub: "hub-americas" },
  { id: "bovespa", label: "Bovespa", symbol: "^BVSP", type: "equity", region: "Americas", country: "Brazil", lat: -23.5505, lon: -46.6333, importance: 6, hub: "hub-americas" },
  { id: "ftse", label: "FTSE 100", symbol: "^FTSE", type: "equity", region: "Europe", country: "United Kingdom", lat: 51.5072, lon: -0.1276, importance: 8, hub: "hub-europe" },
  { id: "dax", label: "DAX", symbol: "^GDAXI", type: "equity", region: "Europe", country: "Germany", lat: 50.1109, lon: 8.6821, importance: 8, hub: "hub-europe" },
  { id: "cac", label: "CAC 40", symbol: "^FCHI", type: "equity", region: "Europe", country: "France", lat: 48.8566, lon: 2.3522, importance: 7, hub: "hub-europe" },
  { id: "stoxx", label: "Euro Stoxx 50", symbol: "^STOXX50E", type: "equity", region: "Europe", country: "Eurozone", lat: 50.1109, lon: 8.6821, importance: 8, hub: "hub-europe" },
  { id: "nikkei", label: "Nikkei 225", symbol: "^N225", type: "equity", region: "Asia Pacific", country: "Japan", lat: 35.6762, lon: 139.6503, importance: 9, hub: "hub-asia" },
  { id: "shcomp", label: "上证指数", symbol: "000001.SS", type: "equity", region: "China / HK", country: "China", lat: 31.2304, lon: 121.4737, importance: 9, hub: "hub-china" },
  { id: "hsi", label: "恒生指数", symbol: "^HSI", type: "equity", region: "China / HK", country: "Hong Kong", lat: 22.3193, lon: 114.1694, importance: 9, hub: "hub-china" },
  { id: "kospi", label: "KOSPI", symbol: "^KS11", type: "equity", region: "Asia Pacific", country: "South Korea", lat: 37.5665, lon: 126.978, importance: 7, hub: "hub-asia" },
  { id: "asx", label: "ASX 200", symbol: "^AXJO", type: "equity", region: "Asia Pacific", country: "Australia", lat: -33.8688, lon: 151.2093, importance: 7, hub: "hub-asia" },
  { id: "sensex", label: "Sensex", symbol: "^BSESN", type: "equity", region: "Asia Pacific", country: "India", lat: 19.076, lon: 72.8777, importance: 8, hub: "hub-asia" },
  { id: "dxy", label: "美元指数", symbol: "DX-Y.NYB", type: "fx", region: "FX", country: "United States", lat: 38.9072, lon: -77.0369, importance: 9, hub: "hub-fx" },
  { id: "eurusd", label: "EUR/USD", symbol: "EURUSD=X", type: "fx", region: "FX", country: "Eurozone", lat: 50.1109, lon: 8.6821, importance: 7, hub: "hub-fx" },
  { id: "usdjpy", label: "USD/JPY", symbol: "JPY=X", type: "fx", region: "FX", country: "Japan", lat: 35.6762, lon: 139.6503, importance: 7, hub: "hub-fx" },
  { id: "usdcny", label: "USD/CNY", symbol: "CNY=X", type: "fx", region: "FX", country: "China", lat: 31.2304, lon: 121.4737, importance: 7, hub: "hub-fx" },
  { id: "ust10y", label: "美债10Y", symbol: "^TNX", type: "rates", region: "Rates", country: "United States", lat: 38.9072, lon: -77.0369, importance: 9, hub: "hub-rates" },
  { id: "ust30y", label: "美债30Y", symbol: "^TYX", type: "rates", region: "Rates", country: "United States", lat: 38.9072, lon: -77.0369, importance: 6, hub: "hub-rates" },
  { id: "gold", label: "黄金", symbol: "GC=F", type: "commodity", region: "Commodities", country: "Global", lat: 25.2048, lon: 55.2708, importance: 8, hub: "hub-commodities" },
  { id: "silver", label: "白银", symbol: "SI=F", type: "commodity", region: "Commodities", country: "Global", lat: 25.2048, lon: 55.2708, importance: 6, hub: "hub-commodities" },
  { id: "crude", label: "WTI原油", symbol: "CL=F", type: "commodity", region: "Commodities", country: "Global", lat: 29.7604, lon: -95.3698, importance: 8, hub: "hub-commodities" },
  { id: "copper", label: "铜", symbol: "HG=F", type: "commodity", region: "Commodities", country: "Global", lat: -33.4489, lon: -70.6693, importance: 7, hub: "hub-commodities" }
];

async function buildMarketList() {
  const baseMarkets = markets.map((market) => ({
    ...market,
    stocks: market.stocks.map((stock) => ({ ...stock }))
  }));

  try {
    const raw = await fs.readFile(modelOverviewDataPath, "utf-8");
    const overview = JSON.parse(raw);
    for (const market of baseMarkets) {
      const overviewMarket = overview?.markets?.find((item) => item.market === market.name);
      const overviewStocks = overviewMarket?.allStocks || overviewMarket?.topStocks?.balanced || [];
      if (!overviewStocks.length) continue;
      market.stocks = overviewStocks.map((stock, index) => ({
        symbol: stock.symbol,
        name: displayStockName(stock, market.name),
        rank: stock.rank || index + 1,
        ptScore: stock.score ?? stock.rankScore,
        ptReturn: stock.metrics?.totalReturn,
        ptDrawdown: stock.metrics?.maxDrawdown
      }));
      market.optimized = true;
      market.selectionGeneratedAt = overview.generatedAt;
      market.source = "model_overview_data";
    }
    return baseMarkets;
  } catch {
    // Fall through to the older selected-market snapshot or the static defaults.
  }

  try {
    const raw = await fs.readFile(selectedMarketStocksPath, "utf-8");
    const selected = JSON.parse(raw);
    for (const market of baseMarkets) {
      const optimized = selected?.markets?.[market.name]?.stocks;
      if (!optimized?.length || market.name === "加密货币") {
        continue;
      }
      market.stocks = optimized.map((stock, index) => ({
        symbol: stock.symbol,
        name: displayStockName(stock, market.name),
        rank: stock.rank || index + 1,
        ptScore: stock.rankingScore,
        ptReturn: stock.pt?.totalReturn,
        ptDrawdown: stock.pt?.maxDrawdown
      }));
      market.optimized = true;
      market.selectionGeneratedAt = selected.generatedAt;
    }
  } catch {
    return baseMarkets;
  }

  return baseMarkets;
}

const cryptoInstruments = [
  { id: "btc", label: "Bitcoin", coinId: "bitcoin", symbol: "BTC", type: "crypto", region: "Crypto", country: "Global", lat: 1.3521, lon: 103.8198, importance: 10, hub: "hub-crypto" },
  { id: "eth", label: "Ethereum", coinId: "ethereum", symbol: "ETH", type: "crypto", region: "Crypto", country: "Global", lat: 47.3769, lon: 8.5417, importance: 9, hub: "hub-crypto" },
  { id: "sol", label: "Solana", coinId: "solana", symbol: "SOL", type: "crypto", region: "Crypto", country: "Global", lat: 37.7749, lon: -122.4194, importance: 7, hub: "hub-crypto" }
];

const graphHubs = [
  { id: "hub-americas", label: "美洲市场", type: "hub", region: "Americas", lat: 25, lon: -95, importance: 12 },
  { id: "hub-europe", label: "欧洲市场", type: "hub", region: "Europe", lat: 50, lon: 12, importance: 11 },
  { id: "hub-asia", label: "亚太市场", type: "hub", region: "Asia Pacific", lat: 25, lon: 110, importance: 11 },
  { id: "hub-china", label: "中国/香港", type: "hub", region: "China / HK", lat: 28, lon: 111, importance: 11 },
  { id: "hub-fx", label: "外汇", type: "hub", region: "FX", lat: 5, lon: 10, importance: 10 },
  { id: "hub-rates", label: "利率", type: "hub", region: "Rates", lat: 48, lon: -35, importance: 10 },
  { id: "hub-commodities", label: "商品", type: "hub", region: "Commodities", lat: -5, lon: 45, importance: 10 },
  { id: "hub-crypto", label: "加密资产", type: "hub", region: "Crypto", lat: -15, lon: 115, importance: 10 }
];

function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function runLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function toPct(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
}

function buildYahooNode(instrument, meta = {}, quote = {}) {
  const quoteClose = Array.isArray(quote.close) ? quote.close.filter((item) => item !== null).at(-1) : null;
  const price = toPct(meta.regularMarketPrice ?? quoteClose);
  const previousClose = toPct(meta.chartPreviousClose ?? meta.previousClose);
  const change = price !== null && previousClose ? price - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const marketTime = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;

  return {
    ...instrument,
    price,
    previousClose,
    change,
    changePct,
    currency: meta.currency || (instrument.type === "rates" ? "%" : "USD"),
    exchange: meta.fullExchangeName || meta.exchangeName || "Yahoo Finance",
    marketState: meta.marketState || "unknown",
    asOf: marketTime,
    source: "Yahoo Finance chart"
  };
}

async function fetchYahooInstrument(instrument) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.symbol)}?range=1d&interval=1m`;
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0" } }, 2500);
  if (!response.ok) {
    throw new Error(`${instrument.symbol}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result?.meta) {
    throw new Error(`${instrument.symbol}: empty chart response`);
  }
  return buildYahooNode(instrument, result.meta, result.indicators?.quote?.[0] || {});
}

async function fetchCryptoNodes() {
  const coinIds = cryptoInstruments.map((item) => item.coinId).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0" } }, 2500);
  if (!response.ok) {
    throw new Error(`CoinGecko: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return cryptoInstruments.map((instrument) => {
    const item = payload[instrument.coinId] || {};
    return {
      ...instrument,
      price: toPct(item.usd),
      previousClose: null,
      change: null,
      changePct: toPct(item.usd_24h_change),
      currency: "USD",
      exchange: "CoinGecko",
      marketState: "24/7",
      asOf: item.last_updated_at ? new Date(item.last_updated_at * 1000).toISOString() : null,
      source: "CoinGecko simple price"
    };
  });
}

function edge(source, target, relation, weight = 1, note = "") {
  return { source, target, relation, weight, note };
}

function calculatePulse(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const avg = (ids) => {
    const values = ids.map((id) => byId.get(id)?.changePct).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const equityPulse = avg(["spx", "nasdaq", "stoxx", "nikkei", "hsi", "sensex"]);
  const cryptoPulse = avg(["btc", "eth", "sol"]);
  const commodityPulse = avg(["gold", "crude", "copper"]);
  const ratePulse = byId.get("ust10y")?.changePct ?? null;
  const dollarPulse = byId.get("dxy")?.changePct ?? null;
  const riskScore = [equityPulse, cryptoPulse, commodityPulse].filter(Number.isFinite).reduce((sum, value) => sum + value, 0) / Math.max(1, [equityPulse, cryptoPulse, commodityPulse].filter(Number.isFinite).length);
  const movers = nodes
    .filter((node) => node.type !== "hub" && Number.isFinite(node.changePct))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  return {
    tone: riskScore > 0.35 ? "risk-on" : riskScore < -0.35 ? "risk-off" : "mixed",
    riskScore,
    equityPulse,
    cryptoPulse,
    commodityPulse,
    ratePulse,
    dollarPulse,
    advancing: nodes.filter((node) => Number.isFinite(node.changePct) && node.changePct > 0).length,
    declining: nodes.filter((node) => Number.isFinite(node.changePct) && node.changePct < 0).length,
    topMovers: movers.slice(0, 6)
  };
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return value.text || value.href || value.url || "";
  return "";
}

function stripTags(value) {
  return textValue(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeIsoDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function firstLink(item) {
  if (typeof item.link === "string") return item.link;
  if (Array.isArray(item.link)) {
    const hrefLink = item.link.find((link) => link?.href);
    return hrefLink?.href || textValue(item.link[0]);
  }
  return item.link?.href || item.guid?.text || textValue(item.id);
}

function classifyNewsNode(title, summary, fallbackNodeId) {
  const haystack = `${title} ${summary}`.toLowerCase();
  const match = newsKeywordMap.find((item) => item.tokens.some((token) => haystack.includes(token)));
  return match?.nodeId || fallbackNodeId;
}

function sentimentForNews(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const positive = ["rally", "gain", "surge", "beat", "upgrade", "record", "optimism", "growth", "eases"].some((token) => text.includes(token));
  const negative = ["fall", "drop", "slump", "miss", "cut", "warning", "risk", "inflation", "war", "default", "lawsuit"].some((token) => text.includes(token));
  if (positive && !negative) return "positive";
  if (negative && !positive) return "negative";
  return "watch";
}

function categorizeNews(title, summary, explicitCategory = "") {
  const explicit = newsCategories.find((category) => category.id === explicitCategory || category.label === explicitCategory);
  if (explicit) return explicit.id;
  const text = `${title} ${summary}`.toLowerCase();
  return newsCategories.find((category) => category.tokens.some((token) => text.includes(token)))?.id || "other";
}

function normalizeRssItems(parsed, feed, nodeById) {
  const channel = parsed.rss?.channel || parsed.channel || {};
  const rssItems = toArray(channel.item);
  const atomItems = toArray(parsed.feed?.entry);
  const rawItems = rssItems.length ? rssItems : atomItems;

  return rawItems.slice(0, 12).map((item, index) => {
    const title = stripTags(item.title);
    const summary = stripTags(item.description || item.summary || item.content);
    const relatedNodeId = classifyNewsNode(title, summary, feed.defaultNodeId);
    const node = nodeById.get(relatedNodeId) || nodeById.get(feed.defaultNodeId);
    const publishedAt = textValue(item.pubDate || item.published || item.updated || item["dc:date"]);
    return {
      id: `${feed.id}-${index}-${Buffer.from(title).toString("base64url").slice(0, 10)}`,
      type: "news",
      title: title || `${feed.name} 更新`,
      summary: summary.slice(0, 240),
      category: categorizeNews(title, summary),
      source: feed.name,
      url: firstLink(item),
      publishedAt: safeIsoDate(publishedAt),
      relatedNodeId: node?.id || feed.defaultNodeId,
      relatedLabel: node?.label || feed.defaultNodeId,
      lat: node?.lat ?? 20,
      lon: node?.lon ?? 0,
      region: node?.region || "Global",
      sentiment: sentimentForNews(title, summary),
      impact: sentimentForNews(title, summary) === "watch" ? 2 : 3
    };
  }).filter((item) => item.title && item.url);
}

async function writeNewsSnapshot(events) {
  await fs.mkdir(newsDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const payload = JSON.stringify({ generatedAt: new Date().toISOString(), items: events }, null, 2);
  await fs.writeFile(path.join(newsDir, "rss-latest.json"), payload);
  await fs.writeFile(path.join(newsDir, `rss-archive-${today}.json`), payload);
}

function normalizeLocalNewsItem(item, fileName, index) {
  const title = stripTags(item.title || item.headline || item.name || `News ${index + 1}`);
  const summary = stripTags(item.summary || item.description || item.body || item.content || "");
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  return {
    id: item.id || `local-${fileName}-${index}`,
    type: "news",
    title,
    summary: summary.slice(0, 900),
    category: categorizeNews(title, summary, item.category),
    source: item.source || fileName,
    url: item.url || item.link || "",
    publishedAt: safeIsoDate(item.publishedAt || item.date || item.updatedAt),
    relatedNodeId: item.relatedNodeId || item.nodeId || "",
    relatedLabel: item.relatedLabel || "",
    region: item.region || "Global",
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    locationLabel: item.locationLabel || item.geoLabel || item.location || "",
    geoScope: item.geoScope || item.scope || "",
    sentiment: item.sentiment || sentimentForNews(title, summary),
    symbols: Array.isArray(item.symbols) ? item.symbols : [],
    entities: Array.isArray(item.entities) ? item.entities : []
  };
}

function markdownToNewsItem(content, fileName) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1] || fileName.replace(/\.md$/i, "");
  const body = content.replace(/^#\s+.+$/m, "").trim();
  return normalizeLocalNewsItem({ title: heading, summary: body, source: fileName }, fileName, 0);
}

async function readNewsDirectory() {
  await fs.mkdir(newsDir, { recursive: true });
  const files = await fs.readdir(newsDir);
  const items = [];

  for (const fileName of files) {
    if (fileName.toLowerCase() === "readme.md") continue;
    const filePath = path.join(newsDir, fileName);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    if (fileName.toLowerCase().endsWith(".json")) {
      try {
        const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
        const rawItems = Array.isArray(parsed) ? parsed : parsed.items || parsed.news || [];
        rawItems.forEach((item, index) => items.push(normalizeLocalNewsItem(item, fileName, index)));
      } catch {
        // Ignore malformed user-supplied news files; keep the graph usable.
      }
    } else if (fileName.toLowerCase().endsWith(".md")) {
      items.push(markdownToNewsItem(await fs.readFile(filePath, "utf-8"), fileName));
    }
  }

  const deduped = new Map();
  for (const item of items) {
    const key = `${item.title.toLowerCase()}-${item.source}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }
  return [...deduped.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

async function fetchNewsEvents(nodeById) {
  const failures = [];
  const batches = await runLimited(newsFeeds, 3, async (feed) => {
    try {
      const response = await fetchWithTimeout(feed.url, { headers: { "user-agent": "Mozilla/5.0" } }, 2500);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const xml = await response.text();
      const parsed = rssParser.parse(xml);
      return normalizeRssItems(parsed, feed, nodeById);
    } catch (error) {
      failures.push({ source: feed.name, url: feed.url, error: error.message });
      return [];
    }
  });

  const deduped = new Map();
  for (const item of batches.flat()) {
    const key = `${item.title.toLowerCase()}-${item.relatedNodeId}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  const events = [...deduped.values()]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 60);
  await writeNewsSnapshot(events);

  return {
    events,
    failures
  };
}

function buildAgentStarterRuns(nodes, newsEvents) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const picks = [
    { agentId: "market-researcher", nodeId: "nasdaq", title: "AI 资本开支链路研究", status: "ready", objective: "把 AI 基建、半导体和云厂商新闻整理成主题地图。" },
    { agentId: "earnings-reviewer", nodeId: "spx", title: "美股财报季快读", status: "ready", objective: "追踪 earnings surprise、指引变化和指数权重股影响。" },
    { agentId: "meeting-prep-agent", nodeId: newsEvents[0]?.relatedNodeId || "spx", title: "明早市场站会包", status: "scheduled", objective: "每天开盘前把隔夜资讯、行情和待追问事项打包。" }
  ];

  return picks.map((run, index) => {
    const agent = financialServiceAgents.find((item) => item.id === run.agentId);
    const node = byId.get(run.nodeId) || byId.get("spx");
    return {
      id: `starter-${run.agentId}-${index}`,
      ...run,
      agentName: agent?.name || run.agentId,
      lat: node?.lat ?? 20,
      lon: node?.lon ?? 0,
      relatedNodeId: node?.id,
      relatedLabel: node?.label,
      outputs: agent?.produces || [],
      mapSync: agent?.mapHook || ""
    };
  });
}

function resolveNewsNode(item, nodeById) {
  if (item.relatedNodeId && nodeById.has(item.relatedNodeId)) return nodeById.get(item.relatedNodeId);
  const title = item.title || "";
  const summary = item.summary || "";
  const nodeId = classifyNewsNode(title, summary, "spx");
  return nodeById.get(nodeId) || nodeById.get("spx");
}

function inferNewsGeo(item) {
  const haystack = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  const rules = [
    { label: "霍尔木兹海峡", scope: "Middle East", lat: 26.566, lon: 56.25, tokens: ["hormuz", "霍尔木兹"] },
    { label: "伊朗", scope: "Middle East", lat: 35.6892, lon: 51.389, tokens: ["iran", "tehran", "伊朗", "德黑兰"] },
    { label: "以色列", scope: "Middle East", lat: 31.7683, lon: 35.2137, tokens: ["israel", "jerusalem", "以色列", "耶路撒冷"] },
    { label: "美国纽约", scope: "United States", lat: 40.7128, lon: -74.006, tokens: ["wall street", "nasdaq", "s&p 500", "dow futures", "nyse", "new york", "美股", "纳斯达克", "标普", "道指"] },
    { label: "美国华盛顿", scope: "United States", lat: 38.9072, lon: -77.0369, tokens: ["federal reserve", "fed ", "white house", "treasury", "washington", "美联储", "白宫", "美国财政部"] },
    { label: "美国加州", scope: "United States", lat: 37.7749, lon: -122.4194, tokens: ["spacex", "tesla", "nvidia", "apple", "microsoft", "alphabet", "meta", "silicon valley", "特斯拉", "英伟达", "苹果"] },
    { label: "美国爱达荷州", scope: "United States", lat: 43.615, lon: -116.2023, tokens: ["micron", "美光"] },
    { label: "中国北京", scope: "China", lat: 39.9042, lon: 116.4074, tokens: ["beijing", "pboc", "china policy", "中国政策", "国新办", "商务部", "人民银行", "央行", "证监会", "国务院"] },
    { label: "中国上海", scope: "China", lat: 31.2304, lon: 121.4737, tokens: ["shanghai", "a-share", "sse", "china market", "上交所", "沪指", "上海", "a股", "中国市场", "外资机构"] },
    { label: "中国深圳", scope: "China", lat: 22.5431, lon: 114.0579, tokens: ["shenzhen", "szse", "深交所", "创业板", "深圳"] },
    { label: "中国香港", scope: "Hong Kong", lat: 22.3193, lon: 114.1694, tokens: ["hong kong", "hang seng", "hkex", "香港", "港股", "恒生", "港交所"] },
    { label: "英国伦敦", scope: "United Kingdom", lat: 51.5072, lon: -0.1276, tokens: ["uk ", "britain", "london", "starmer", "英国", "伦敦", "英媒"] },
    { label: "日本东京", scope: "Japan", lat: 35.6762, lon: 139.6503, tokens: ["japan", "tokyo", "boj", "日本", "东京"] },
    { label: "德国法兰克福", scope: "Germany", lat: 50.1109, lon: 8.6821, tokens: ["germany", "frankfurt", "德国", "法兰克福"] },
    { label: "欧盟布鲁塞尔", scope: "Eurozone", lat: 50.8503, lon: 4.3517, tokens: ["eurozone", "european central bank", "ecb", "brussels", "欧盟", "欧元区", "欧洲央行"] },
    { label: "刚果（金）金沙萨", scope: "Africa", lat: -4.4419, lon: 15.2663, tokens: ["congo", "ebola", "刚果", "埃博拉"] }
  ];
  return rules.find((rule) => rule.tokens.some((token) => haystack.includes(token))) || null;
}

function addGraphNode(map, id, label, type, extra = {}) {
  if (!map.has(id)) map.set(id, { id, label, type, value: 0, ...extra });
  const node = map.get(id);
  node.value += 1;
  return node;
}

function edgeKey(source, target, relation) {
  return `${source}::${target}::${relation}`;
}

function addGraphEdge(map, source, target, relation, weight = 1) {
  const key = edgeKey(source, target, relation);
  if (!map.has(key)) map.set(key, { source, target, relation, weight: 0 });
  map.get(key).weight += weight;
}

function extractEntities(text) {
  const matches = String(text || "").match(/\b[A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3}\b/g) || [];
  return [...new Set(matches)]
    .filter((item) => !["The", "And", "For", "With", "After", "Before", "June", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].includes(item))
    .slice(0, 6);
}

async function buildFinancialKnowledgeGraph(seedMarketData = null) {
  const marketData = seedMarketData || await buildGlobalMarketGraph();
  const nodeById = new Map(marketData.nodes.map((node) => [node.id, node]));
  const localNews = await readNewsDirectory();
  const enrichedNews = localNews.map((item) => {
    const related = resolveNewsNode(item, nodeById);
    const itemLat = Number(item.lat);
    const itemLon = Number(item.lon);
    const hasEventGeo = Number.isFinite(itemLat) && Number.isFinite(itemLon) && Boolean(item.locationLabel || item.geoScope);
    const inferredGeo = hasEventGeo ? null : inferNewsGeo(item);
    return {
      ...item,
      relatedNodeId: related?.id || item.relatedNodeId || "spx",
      relatedLabel: related?.label || item.relatedLabel || "S&P 500",
      lat: hasEventGeo ? itemLat : inferredGeo?.lat ?? related?.lat ?? 20,
      lon: hasEventGeo ? itemLon : inferredGeo?.lon ?? related?.lon ?? 0,
      locationLabel: item.locationLabel || inferredGeo?.label || related?.country || related?.region || "全球",
      geoScope: item.geoScope || inferredGeo?.scope || related?.region || "Global",
      category: categorizeNews(item.title, item.summary, item.category),
      entities: item.entities?.length ? item.entities : extractEntities(`${item.title} ${item.summary}`)
    };
  });

  const graphNodes = new Map();
  const graphEdges = new Map();

  for (const category of newsCategories) {
    addGraphNode(graphNodes, `cat:${category.id}`, category.label, "category", { category: category.id });
  }

  for (const asset of marketData.nodes.filter((node) => node.type !== "hub")) {
    addGraphNode(graphNodes, `asset:${asset.id}`, asset.label, "asset", {
      assetId: asset.id,
      symbol: asset.symbol,
      changePct: asset.changePct,
      region: asset.region
    });
  }

  enrichedNews.slice(0, 360).forEach((item) => {
    const newsId = `news:${item.id}`;
    const categoryId = `cat:${item.category || "finance"}`;
    const assetId = `asset:${item.relatedNodeId}`;
    addGraphNode(graphNodes, newsId, item.title, "news", {
      category: item.category,
      sentiment: item.sentiment,
      publishedAt: item.publishedAt,
      source: item.source,
      lat: item.lat,
      lon: item.lon,
      locationLabel: item.locationLabel,
      geoScope: item.geoScope
    });
    addGraphEdge(graphEdges, categoryId, newsId, "分类包含", 1);
    addGraphEdge(graphEdges, newsId, assetId, "影响资产", item.sentiment === "negative" ? 1.4 : item.sentiment === "positive" ? 1.2 : 1);
    for (const entity of item.entities || []) {
      const entityId = `entity:${entity.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      addGraphNode(graphNodes, entityId, entity, "entity", { category: item.category });
      addGraphEdge(graphEdges, newsId, entityId, "提及对象", 0.9);
      addGraphEdge(graphEdges, entityId, assetId, "关联市场", 0.7);
    }
  });

  const categoryCounts = newsCategories.map((category) => ({
    ...category,
    count: enrichedNews.filter((item) => item.category === category.id).length
  }));

  return {
    generatedAt: new Date().toISOString(),
    newsDir,
    news: enrichedNews,
    categories: categoryCounts,
    nodes: [...graphNodes.values()],
    edges: [...graphEdges.values()].sort((a, b) => b.weight - a.weight),
    summary: {
      newsCount: enrichedNews.length,
      categoryCount: newsCategories.length,
      graphNodeCount: graphNodes.size,
      graphEdgeCount: graphEdges.size,
      topCategories: categoryCounts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 6)
    }
  };
}

function selectSimulationEvidence(graph, question, selectedCategories = []) {
  const terms = String(question || "").toLowerCase().split(/\s+/).filter((item) => item.length > 2);
  const categorySet = new Set(selectedCategories);
  return graph.news
    .filter((item) => !categorySet.size || categorySet.has(item.category))
    .map((item) => {
      const text = `${item.title} ${item.summary} ${item.relatedLabel}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 2 : 0), 0) + (item.sentiment === "negative" ? 1 : 0) + (item.category === "risk" ? 1 : 0);
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 18);
}

function topValues(items, getter, limit = 4) {
  const counts = new Map();
  for (const item of items) {
    const value = getter(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value);
}

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key) values[key] = value;
  }
  return values;
}

async function readEnvFile(filePath) {
  try {
    return parseEnvFile(await fs.readFile(filePath, "utf-8"));
  } catch {
    return {};
  }
}

const projectEnvFiles = [
  path.join(__dirname, ".env"),
  path.join(__dirname, ".env.local")
];
let projectEnvCache = null;

async function getProjectEnvValues() {
  if (!projectEnvCache) {
    projectEnvCache = Object.assign({}, ...(await Promise.all(projectEnvFiles.map(readEnvFile))));
  }
  return projectEnvCache;
}

function cleanEnvValue(value) {
  const text = String(value || "").trim();
  if (!text || /^your[_-]/i.test(text) || /your_.*_here/i.test(text)) return "";
  return text;
}

async function getModelApiConfig() {
  const fileValues = await getProjectEnvValues();
  const pick = (...values) => {
    for (const value of values) {
      const cleaned = cleanEnvValue(value);
      if (cleaned) return cleaned;
    }
    return "";
  };
  const timeoutMs = Number(pick(process.env.FINTERRA_MODEL_API_TIMEOUT_MS, fileValues.FINTERRA_MODEL_API_TIMEOUT_MS)) || 120000;
  return {
    baseUrl: pick(process.env.FINTERRA_MODEL_API_BASE_URL, fileValues.FINTERRA_MODEL_API_BASE_URL).replace(/\/+$/, ""),
    apiKey: pick(process.env.FINTERRA_MODEL_API_KEY, fileValues.FINTERRA_MODEL_API_KEY),
    serverKey: pick(process.env.FINTERRA_MODEL_API_SERVER_KEY, fileValues.FINTERRA_MODEL_API_SERVER_KEY),
    timeoutMs
  };
}

function getBearerToken(req) {
  const header = String(req.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function requireModelApiKey(req, res) {
  const { serverKey } = await getModelApiConfig();
  if (!serverKey) return true;
  const provided = String(req.get("x-api-key") || "").trim() || getBearerToken(req);
  if (provided && provided === serverKey) return true;
  res.status(401).json({ error: "模型 API 未授权" });
  return false;
}

async function proxyModelApi(req, res, apiPath) {
  const { baseUrl, apiKey, timeoutMs } = await getModelApiConfig();
  if (!baseUrl) return false;

  const target = new URL(apiPath.replace(/^\//, ""), `${baseUrl}/`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => target.searchParams.append(key, item));
    } else if (value !== undefined) {
      target.searchParams.set(key, String(value));
    }
  }

  const headers = { accept: "application/json" };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers.authorization = `Bearer ${apiKey}`;
  }

  const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
  if (hasBody) headers["content-type"] = "application/json";

  try {
    const response = await fetchWithTimeout(
      target,
      {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body || {}) : undefined
      },
      timeoutMs
    );
    const text = await response.text();
    res.status(response.status);
    res.set("content-type", response.headers.get("content-type") || "application/json; charset=utf-8");
    res.send(text);
  } catch (error) {
    res.status(502).json({
      error: "远端模型 API 调用失败",
      detail: error.message,
      target: target.origin
    });
  }
  return true;
}

async function getMiroFishLLMConfig(override = null) {
  const envFiles = [
    "/Users/avalok/work/QuanKnowledeg/MiroFish/.env",
    path.join(__dirname, "vendor", "MiroFish", ".env"),
    path.join(__dirname, ".env"),
    path.join(__dirname, ".env.local")
  ];
  const fileValues = Object.assign({}, ...(await Promise.all(envFiles.map(readEnvFile))));
  const clean = (value) => {
    const text = String(value || "").trim();
    if (!text || /^your[_-]/i.test(text) || /your_.*_here/i.test(text)) return "";
    return text;
  };
  const apiKey = clean(override?.api_key) || clean(override?.apiKey) || clean(process.env.DEEPSEEK_API_KEY) || clean(process.env.LLM_API_KEY) || clean(process.env.LLM_BOOST_API_KEY) || clean(fileValues.DEEPSEEK_API_KEY) || clean(fileValues.LLM_API_KEY) || clean(fileValues.LLM_BOOST_API_KEY);
  const normalizeModel = (value) => {
    const model = clean(value);
    if (!model) return "";
    if (/deepseek-v4/i.test(model)) return "deepseek-chat";
    return model;
  };
  return {
    apiKey,
    baseUrl: clean(override?.base_url) || clean(override?.baseUrl) || clean(process.env.LLM_BASE_URL) || clean(process.env.DEEPSEEK_BASE_URL) || clean(process.env.LLM_BOOST_BASE_URL) || clean(fileValues.LLM_BASE_URL) || clean(fileValues.DEEPSEEK_BASE_URL) || clean(fileValues.LLM_BOOST_BASE_URL) || "https://api.deepseek.com/v1",
    model: normalizeModel(override?.model) || normalizeModel(process.env.LLM_MODEL_NAME) || normalizeModel(process.env.DEEPSEEK_MODEL) || normalizeModel(process.env.LLM_BOOST_MODEL_NAME) || normalizeModel(fileValues.LLM_MODEL_NAME) || normalizeModel(fileValues.DEEPSEEK_MODEL) || normalizeModel(fileValues.LLM_BOOST_MODEL_NAME) || "deepseek-chat"
  };
}

function evidenceForRole(evidence, keywords, fallbackCount = 3) {
  const picked = evidence.filter((item) => {
    const text = `${item.title} ${item.summary} ${item.category} ${item.relatedLabel} ${item.geoScope}`.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
  });
  return (picked.length ? picked : evidence).slice(0, fallbackCount);
}

function buildSimulationRoles(graph, evidence, question) {
  const topAssets = topValues(evidence, (item) => item.relatedLabel, 5);
  const topRegions = topValues(evidence, (item) => item.locationLabel || item.geoScope, 5);
  const topCategories = graph.summary.topCategories.map((item) => item.label).slice(0, 5);
  const questionText = String(question || "").toLowerCase();
  const commodityFocus = /(oil|crude|gold|copper|energy|commodity|原油|黄金|铜|能源|商品)/i.test(questionText);
  const cryptoFocus = /(btc|bitcoin|crypto|ethereum|solana|加密|比特币|以太坊)/i.test(questionText);

  const roles = [
    {
      id: "macro-rates-agent",
      name: "宏观利率观察员",
      stance: "从央行、通胀、增长和债券收益率判断市场约束条件。",
      keywords: ["central-bank", "rates", "bond", "yield", "rate", "inflation", "fed", "央行", "利率", "债券", "通胀"]
    },
    {
      id: "liquidity-fx-agent",
      name: "流动性与美元观察员",
      stance: "观察美元、汇率、跨境资金和避险流动如何改变资产定价。",
      keywords: ["fx", "dollar", "currency", "ruble", "rand", "naira", "peso", "美元", "汇率", "外汇"]
    },
    {
      id: "risk-assets-agent",
      name: cryptoFocus ? "风险资产与加密观察员" : "风险资产观察员",
      stance: "跟踪股票、科技、加密和高波动资产的风险偏好变化。",
      keywords: ["technology", "finance", "crypto", "stock", "equity", "nasdaq", "spacex", "bitcoin", "科技", "股票", "加密"]
    },
    {
      id: "commodities-agent",
      name: commodityFocus ? "商品能源主辩手" : "商品能源观察员",
      stance: "分析原油、黄金、铜和资源国市场对冲击的放大或缓冲。",
      keywords: ["commodities", "oil", "crude", "gold", "copper", "energy", "mining", "原油", "黄金", "铜", "能源"]
    },
    {
      id: "regional-events-agent",
      name: "区域事件观察员",
      stance: "把俄罗斯、加拿大、南美、非洲、澳洲、中国与中东事件放回地理链路。",
      keywords: ["russia", "canada", "south america", "africa", "australia", "china", "middle east", "俄罗斯", "加拿大", "非洲", "澳洲", "中国"]
    }
  ];

  return roles.map((role) => {
    const roleEvidence = evidenceForRole(evidence, role.keywords);
    return {
      ...role,
      anchors: {
        assets: topAssets,
        regions: topRegions,
        categories: topCategories
      },
      evidenceIds: roleEvidence.map((item) => item.id),
      evidenceTitles: roleEvidence.map((item) => item.title)
    };
  });
}

function roleSignal(role, evidence) {
  const roleEvidence = evidence.filter((item) => role.evidenceIds.includes(item.id));
  const negative = roleEvidence.filter((item) => item.sentiment === "negative").length;
  const positive = roleEvidence.filter((item) => item.sentiment === "positive").length;
  if (negative > positive) return "偏谨慎";
  if (positive > negative) return "偏建设性";
  return "中性观察";
}

function roleEvidenceText(role, evidence) {
  const roleEvidence = evidence.filter((item) => role.evidenceIds.includes(item.id));
  const first = roleEvidence[0];
  if (!first) return "当前证据不足，先以图谱主导类别和资产链路作为参照。";
  return `关键证据是「${first.title}」，位置在${first.locationLabel || first.geoScope || "全球"}，关联${first.relatedLabel || "主要资产"}。`;
}

function buildRoundTurns(roundNumber, roles, evidence, graph, question) {
  const dominant = graph.summary.topCategories[0]?.label || "财经";
  return roles.map((role) => {
    const signal = roleSignal(role, evidence);
    const evidenceText = roleEvidenceText(role, evidence);
    const assets = role.anchors.assets.join("、") || "核心资产";
    const regions = role.anchors.regions.join("、") || "主要区域";
    let message = "";
    if (roundNumber === 1) {
      message = `${evidenceText} 我对问题「${question}」的第一判断是${signal}：先看${dominant}是否继续压过其他主题，并观察${assets}的同步或背离。`;
    } else if (roundNumber === 2) {
      message = `我把上一轮观点放到传导链里复核：${regions}的事件如果继续聚集，会通过${assets}形成二阶影响。现在不宜只看单一新闻，关键是跨区域、跨资产是否同向增强。`;
    } else {
      message = `第三轮给出行动化观察口径：若后续资讯继续支持${signal}，就把${assets}作为主要跟踪锚；若证据分裂，则降低单点预测权重，改用情景跟踪。`;
    }
    return {
      roleId: role.id,
      roleName: role.name,
      message
    };
  });
}

function buildRoundSummary(roundNumber, turns, evidence, graph) {
  const negative = evidence.filter((item) => item.sentiment === "negative").length;
  const positive = evidence.filter((item) => item.sentiment === "positive").length;
  const dominant = graph.summary.topCategories[0]?.label || "财经";
  const tone = negative > positive ? "风险链条略占上风" : positive > negative ? "修复线索略占上风" : "多空证据仍然均衡";
  if (roundNumber === 1) return `第1轮总结：角色已完成证据读入，当前主导主题是「${dominant}」，整体判断为${tone}。`;
  if (roundNumber === 2) return `第2轮总结：讨论重点从单条资讯转向传导路径，需观察区域事件是否向利率、美元、商品和风险资产同步扩散。`;
  return `第3轮总结：结论收敛为情景跟踪框架，优先盯住证据最密集的区域、资产和类别，不把当前信号误读成确定性预测。`;
}

function buildAgentRoundtable(question, graph, evidence, local) {
  const roles = buildSimulationRoles(graph, evidence, question);
  const rounds = [1, 2, 3].map((roundNumber) => {
    const turns = buildRoundTurns(roundNumber, roles, evidence, graph, question);
    return {
      round: roundNumber,
      focus: roundNumber === 1 ? "证据读取" : roundNumber === 2 ? "传导交叉质询" : "结论收敛",
      turns,
      summary: buildRoundSummary(roundNumber, turns, evidence, graph)
    };
  });
  const focusAssets = [...new Set(evidence.map((item) => item.relatedLabel).filter(Boolean))].slice(0, 6);
  const focusRegions = [...new Set(evidence.map((item) => item.locationLabel || item.geoScope).filter(Boolean))].slice(0, 6);
  const finalConclusion = `三轮多智能体讨论后的结论：${local.answer} 当前最需要持续跟踪的资产锚是${focusAssets.join("、") || "主要资产"}，地理锚是${focusRegions.join("、") || "主要区域"}。`;
  return { roles, rounds, finalConclusion };
}

function buildScenarioScaffold(graph, evidence) {
  const negative = evidence.filter((item) => item.sentiment === "negative").length;
  const positive = evidence.filter((item) => item.sentiment === "positive").length;
  const dominant = graph.summary.topCategories[0]?.label || "财经";
  return {
    confidence: evidence.length >= 8 ? "medium-high" : "medium",
    scenarios: [
      { name: "基准路径", probability: 0.52, description: `${dominant} 继续主导新闻流，资产反应以结构分化为主。` },
      { name: "风险扩散", probability: negative > positive ? 0.34 : 0.22, description: "负面资讯向利率、美元和高波动资产扩散，避险资产相对占优。" },
      { name: "情绪修复", probability: positive > negative ? 0.31 : 0.18, description: "政策或企业事件缓和风险，成长与周期资产同步修复。" }
    ]
  };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM 未返回 JSON 对象");
    return JSON.parse(match[0]);
  }
}

function validateMiroFishRoundtable(payload) {
  if (!Array.isArray(payload?.roles) || !payload.roles.length) throw new Error("MiroFish 未生成角色");
  if (!Array.isArray(payload?.rounds) || payload.rounds.length !== 3) throw new Error("MiroFish 未返回三轮讨论");
  payload.rounds.forEach((round, index) => {
    if (!Array.isArray(round.turns) || round.turns.length < payload.roles.length) throw new Error(`MiroFish 第 ${index + 1} 轮没有让全部角色发言`);
    if (!round.summary) throw new Error(`MiroFish 第 ${index + 1} 轮缺少总结`);
  });
  if (!payload.finalConclusion && !payload.answer) throw new Error("MiroFish 缺少最终结论");
  return payload;
}

function runJsonWorker(command, args, input, timeoutMs = 50000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: __dirname,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${path.basename(args[0] || command)} timeout`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`MiroFish worker returned invalid JSON: ${error.message}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function enrichRoundtableGraphFocus(payload, seedRoles, graph, evidence) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const seedById = new Map(seedRoles.map((role) => [role.id, role]));
  const edgeIds = new Map((graph.edges || []).map((edge, index) => {
    const id = `${edge.source}->${edge.target}:${edge.relation || index}`;
    return [`${edge.source}->${edge.target}`, { ...edge, id }];
  }));
  const fallbackEvidence = evidence.slice(0, 4);

  const focusForRole = (roleId) => {
    const seed = seedById.get(roleId) || seedRoles[0];
    const roleEvidence = (seed?.evidenceIds || [])
      .map((id) => evidenceById.get(id))
      .filter(Boolean);
    const picked = (roleEvidence.length ? roleEvidence : fallbackEvidence).slice(0, 5);
    const focusNodeIds = new Set();
    const focusEdgeIds = new Set();

    picked.forEach((item) => {
      const newsId = `news:${item.id}`;
      const assetId = item.relatedNodeId ? `asset:${item.relatedNodeId}` : null;
      const categoryId = item.category ? `cat:${item.category}` : null;
      focusNodeIds.add(newsId);
      if (assetId) focusNodeIds.add(assetId);
      if (categoryId) focusNodeIds.add(categoryId);
      [assetId, categoryId].filter(Boolean).forEach((target) => {
        const edge = edgeIds.get(`${newsId}->${target}`);
        if (edge) focusEdgeIds.add(edge.id);
      });
      (graph.edges || [])
        .filter((edge) => edge.source === newsId && String(edge.target).startsWith("entity:"))
        .slice(0, 2)
        .forEach((edge) => {
          focusNodeIds.add(edge.target);
          const graphEdge = edgeIds.get(`${edge.source}->${edge.target}`);
          if (graphEdge) focusEdgeIds.add(graphEdge.id);
        });
    });

    return {
      focusNodeIds: [...focusNodeIds],
      focusEdgeIds: [...focusEdgeIds]
    };
  };

  return {
    ...payload,
    roles: payload.roles.map((role) => {
      const seed = seedById.get(role.id);
      return {
        ...role,
        seedEvidenceIds: seed?.evidenceIds || [],
        seedEvidenceTitles: seed?.evidenceTitles || []
      };
    }),
    rounds: payload.rounds.map((round) => ({
      ...round,
      turns: (round.turns || []).map((turn) => ({
        ...turn,
        ...focusForRole(turn.roleId)
      }))
    }))
  };
}

async function callMiroFishDeepSeekRoundtable({ question, graph, evidence, seedRoles, modelConfig = null }) {
  const { apiKey, baseUrl, model } = await getMiroFishLLMConfig(modelConfig);
  if (!apiKey) {
    throw new Error("未配置 MiroFish LLM_API_KEY/DEEPSEEK_API_KEY，不能执行真实 MiroFish 多智能体推演");
  }

  const compactGraph = {
    summary: graph.summary,
    categories: graph.categories.filter((item) => item.count > 0).slice(0, 12),
    seedRoles: seedRoles.map((role) => ({
      id: role.id,
      name: role.name,
      stance: role.stance,
      anchors: role.anchors,
      evidenceTitles: role.evidenceTitles
    })),
    evidence: evidence.slice(0, 18).map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      sentiment: item.sentiment,
      relatedLabel: item.relatedLabel,
      locationLabel: item.locationLabel,
      geoScope: item.geoScope,
      source: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary?.slice(0, 220)
    }))
  };

  const workerPayload = await runJsonWorker("python3", [mirofishRoundtableWorkerPath], {
    apiKey,
    baseUrl,
    model,
    question,
    graph: compactGraph
  }, 75000);
  if (workerPayload.error) throw new Error(workerPayload.error);
  const parsed = enrichRoundtableGraphFocus(validateMiroFishRoundtable(workerPayload.result), seedRoles, graph, evidence);
  return {
    roles: parsed.roles,
    rounds: parsed.rounds,
    finalConclusion: parsed.finalConclusion || parsed.answer,
    confidence: parsed.confidence || "medium",
    raw: workerPayload.raw || "",
    model,
    baseUrl
  };
}

async function runMiroFishFinancialSimulation({ question, selectedCategories = [], modelConfig = null }) {
  const marketData = await buildGlobalMarketGraph();
  const graph = await buildFinancialKnowledgeGraph(marketData);
  const evidence = selectSimulationEvidence(graph, question, selectedCategories);
  const seedRoles = buildSimulationRoles(graph, evidence, question);
  const scaffold = buildScenarioScaffold(graph, evidence);
  let roundtable;
  try {
    roundtable = await callMiroFishDeepSeekRoundtable({ question, graph, evidence, seedRoles, modelConfig });
  } catch (error) {
    error.partial = {
      generatedAt: new Date().toISOString(),
      question,
      stages: [
        { name: "Graph Building", status: "complete", detail: `从 news 目录读取 ${graph.summary.newsCount} 条资讯，构建 ${graph.summary.graphNodeCount} 个节点和 ${graph.summary.graphEdgeCount} 条边。` },
        { name: "Role Seeding", status: "complete", detail: `金融图谱已生成 ${seedRoles.length} 个种子角色：${seedRoles.map((role) => role.name).join("、")}。` },
        { name: "MiroFish Runtime", status: "failed", detail: error.message }
      ],
      roles: seedRoles,
      rounds: [],
      evidence,
      scenarios: scaffold.scenarios,
      graph
    };
    throw error;
  }

  const stages = [
    { name: "Graph Building", status: "complete", detail: `从 news 目录读取 ${graph.summary.newsCount} 条资讯，构建 ${graph.summary.graphNodeCount} 个节点和 ${graph.summary.graphEdgeCount} 条边。` },
    { name: "Role Seeding", status: "complete", detail: `金融图谱只负责生成 ${seedRoles.length} 个种子角色：${seedRoles.map((role) => role.name).join("、")}。` },
    { name: "MiroFish Runtime", status: "llm", detail: `已通过 MiroFish LLMClient 调用 ${roundtable.model} 完成 3 轮多智能体轮流发言，并由 MiroFish 返回每轮总结。` },
    { name: "Report Generation", status: "complete", detail: "最终结论由 MiroFish 多智能体讨论收敛生成，未使用本地伪推演替代。" },
    { name: "Deep Interaction", status: "ready", detail: "用户可继续追问，新的资讯文件进入 news 目录后会被纳入下一轮推演。" }
  ];

  return {
    generatedAt: new Date().toISOString(),
    engine: {
      name: "MiroFish financial adapter",
      repo: "666ghj/MiroFish",
      installedPath: path.join(__dirname, "vendor", "MiroFish"),
      nativeRequires: ["LLM_API_KEY"],
      usingDeepSeek: true,
      model: roundtable.model,
      baseUrl: roundtable.baseUrl
    },
    question,
    stages,
    roles: roundtable.roles,
    rounds: roundtable.rounds,
    evidence,
    scenarios: scaffold.scenarios,
    answer: roundtable.finalConclusion,
    confidence: roundtable.confidence || scaffold.confidence,
    graph
  };
}

async function buildGlobalMarketGraph() {
  const failures = [];
  const yahooResults = await runLimited(globalMarketInstruments, 16, async (instrument) => {
    try {
      return await fetchYahooInstrument(instrument);
    } catch (error) {
      failures.push({ symbol: instrument.symbol, source: "Yahoo Finance chart", error: error.message });
      return { ...instrument, price: null, changePct: null, currency: "USD", marketState: "unavailable", source: "Yahoo Finance chart" };
    }
  });

  let cryptoResults = [];
  try {
    cryptoResults = await fetchCryptoNodes();
  } catch (error) {
    failures.push({ symbol: "crypto basket", source: "CoinGecko", error: error.message });
    cryptoResults = cryptoInstruments.map((instrument) => ({ ...instrument, price: null, changePct: null, currency: "USD", marketState: "unavailable", source: "CoinGecko simple price" }));
  }

  const assetNodes = [...yahooResults, ...cryptoResults];
  const nodes = [...graphHubs, ...assetNodes];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const newsResult = await fetchNewsEvents(nodeById);
  failures.push(...newsResult.failures.map((item) => ({ ...item, source: `${item.source} RSS` })));
  const hubEdges = assetNodes.map((node) => edge(node.hub, node.id, "contains", Math.max(1, Math.abs(node.changePct || 0)), `${node.region} -> ${node.label}`));
  const thematicEdges = [
    edge("ust10y", "nasdaq", "discount-rate", 2.2, "美债收益率影响成长股估值"),
    edge("ust10y", "gold", "real-rate", 1.9, "利率与黄金避险/实际收益率联动"),
    edge("dxy", "gold", "dollar-sensitive", 1.8, "美元强弱影响美元计价商品"),
    edge("dxy", "hsi", "liquidity", 1.4, "美元流动性影响离岸风险资产"),
    edge("crude", "bovespa", "commodity-beta", 1.4, "大宗商品周期影响资源型市场"),
    edge("copper", "shcomp", "growth-demand", 1.6, "铜价常被视作全球需求温度计"),
    edge("btc", "nasdaq", "risk-appetite", 1.5, "高波动风险资产同受流动性影响"),
    edge("btc", "hub-crypto", "dominance", 2.0, "BTC 是加密资产风险锚"),
    edge("hsi", "shcomp", "china-link", 1.7, "A股与港股共享中国增长预期"),
    edge("nikkei", "usdjpy", "yen-link", 1.5, "日元走势影响日本出口权益资产"),
    edge("spx", "stoxx", "global-beta", 1.6, "欧美股指共享全球风险偏好"),
    edge("spx", "nikkei", "global-beta", 1.5, "美股波动向亚太市场传导")
  ];
  const pulse = calculatePulse(nodes);

  return {
    generatedAt: new Date().toISOString(),
    cacheTtlMs: marketGraphCache.ttlMs,
    sources: [
      { name: "Yahoo Finance chart", url: "https://query1.finance.yahoo.com/v8/finance/chart", coverage: "全球指数、汇率、利率、商品期货；通常为实时或延迟行情" },
      { name: "CoinGecko simple price", url: "https://api.coingecko.com/api/v3/simple/price", coverage: "加密资产价格与24小时涨跌幅" },
      { name: "免费 RSS 资讯源", url: "Yahoo/CNBC/Fed/CoinDesk/ECB RSS", coverage: "全球市场、央行、加密资产和宏观新闻标题流" },
      { name: "Anthropic financial-services", url: financialServicesRepo.url, coverage: "参考 Agent、技能、MCP connector 目录；已安装到 vendor/financial-services" }
    ],
    nodes,
    edges: [...hubEdges, ...thematicEdges],
    news: newsResult.events.slice(0, 42),
    agents: financialServiceAgents,
    mcpIntegrations: financialServiceConnectors,
    agentRuns: buildAgentStarterRuns(nodes, newsResult.events),
    installedFinancialServices: financialServicesRepo,
    pulse,
    failures
  };
}

app.get("/api/markets", async (_req, res) => {
  res.json({ markets: await buildMarketList() });
});

app.get("/api/global-market-graph", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const now = Date.now();
    if (!forceRefresh && marketGraphCache.data && now - marketGraphCache.updatedAt < marketGraphCache.ttlMs) {
      res.json({ ...marketGraphCache.data, cache: { hit: true, updatedAt: new Date(marketGraphCache.updatedAt).toISOString() } });
      return;
    }

    const data = await buildGlobalMarketGraph();
    marketGraphCache.data = data;
    marketGraphCache.updatedAt = now;
    res.json({ ...data, cache: { hit: false, updatedAt: new Date(now).toISOString() } });
  } catch (error) {
    res.status(500).json({ error: "全球市场图谱数据拉取失败", detail: error.message });
  }
});

app.get("/api/financial-intel-lab", async (_req, res) => {
  try {
    const marketData = await buildGlobalMarketGraph();
    const financialGraph = await buildFinancialKnowledgeGraph(marketData);
    res.json({
      generatedAt: new Date().toISOString(),
      marketData,
      financialGraph,
      newsCategories,
      mirofish: {
        repo: "666ghj/MiroFish",
        url: "https://github.com/666ghj/MiroFish",
        installedPath: path.join(__dirname, "vendor", "MiroFish"),
        nativeEngineRequires: ["LLM_API_KEY", "ZEP_API_KEY"],
        adapterMode: "financial graph role seeding + MiroFish LLMClient roundtable"
      }
    });
  } catch (error) {
    res.status(500).json({ error: "金融资讯推演实验室加载失败", detail: error.message });
  }
});

app.post("/api/mirofish-simulate", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) {
      res.status(400).json({ error: "请输入需要推演的问题" });
      return;
    }
    const selectedCategories = Array.isArray(req.body?.selectedCategories) ? req.body.selectedCategories : [];
    const modelConfig = req.body?.modelConfig && typeof req.body.modelConfig === "object" ? req.body.modelConfig : null;
    res.json(await runMiroFishFinancialSimulation({ question, selectedCategories, modelConfig }));
  } catch (error) {
    res.status(500).json({ error: "MiroFish 金融推演失败", detail: error.message, partial: error.partial || null });
  }
});

app.get("/api/latest-model", async (_req, res) => {
  if (await proxyModelApi(_req, res, "/api/latest-model")) return;
  if (!(await requireModelApiKey(_req, res))) return;
  try {
    const raw = await fs.readFile(latestTrainingModelPath, "utf-8");
    res.json({ result: JSON.parse(raw), path: latestTrainingModelPath });
  } catch {
    res.status(404).json({ error: "暂无已保存的训练参数" });
  }
});

app.get("/api/model-overview", async (_req, res) => {
  try {
    const raw = await fs.readFile(modelOverviewDataPath, "utf-8");
    res.json({ data: JSON.parse(raw), path: modelOverviewDataPath });
  } catch (error) {
    res.status(404).json({ error: "暂无模型总览数据，请先运行 build_model_overview_data.py", detail: error.message });
  }
});

app.get("/api/selector-experiments", async (_req, res) => {
  if (await proxyModelApi(_req, res, "/api/selector-experiments")) return;
  if (!(await requireModelApiKey(_req, res))) return;
  try {
    const raw = await fs.readFile(selectorExperimentHistoryPath, "utf-8");
    res.json({ experiments: JSON.parse(raw), path: selectorExperimentHistoryPath });
  } catch {
    res.json({ experiments: [], path: selectorExperimentHistoryPath });
  }
});

app.get("/api/time-split-progress", async (_req, res) => {
  if (await proxyModelApi(_req, res, "/api/time-split-progress")) return;
  if (!(await requireModelApiKey(_req, res))) return;
  try {
    const candidates = await Promise.all(
      timeSplitProgressFiles.map(async (fileName) => {
        const candidatePath = path.join(tempDir, fileName);
        try {
          const stat = await fs.stat(candidatePath);
          return { path: candidatePath, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    const latest = candidates.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) {
      res.json({ progress: null, path: path.join(tempDir, timeSplitProgressFiles[0]) });
      return;
    }
    const raw = await fs.readFile(latest.path, "utf-8");
    res.json({ progress: JSON.parse(raw), path: latest.path });
  } catch {
    res.json({ progress: null, path: path.join(tempDir, timeSplitProgressFiles[0]) });
  }
});

app.post("/api/backtest", async (req, res) => {
  const defaultEnd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const { symbol, name, start = "20220101", end = defaultEnd } = req.body || {};
  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "缺少股票代码" });
    return;
  }

  const tempDir = path.join(__dirname, ".tmp");
  await fs.mkdir(tempDir, { recursive: true });
  const jsonPath = path.join(tempDir, `backtest-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

  const args = [
    path.join(__dirname, "stock1.py"),
    "--symbol",
    symbol,
    "--name",
    name || symbol,
    "--start",
    start,
    "--end",
    end,
    "--json-output",
    jsonPath,
    "--no-html"
  ];

  const child = spawn("python3", args, { cwd: __dirname });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, 120000);

  child.on("close", async (code, signal) => {
    clearTimeout(timer);
    try {
      if (code !== 0) {
        res.status(500).json({
          error: signal ? `计算超时或被终止: ${signal}` : "计算失败",
          stdout,
          stderr
        });
        return;
      }

      const raw = await fs.readFile(jsonPath, "utf-8");
      const result = JSON.parse(raw);
      await fs.rm(jsonPath, { force: true });
      res.json({ result, stdout });
    } catch (error) {
      res.status(500).json({
        error: "读取回测结果失败",
        detail: error.message,
        stdout,
        stderr
      });
    }
  });
});

app.post("/api/train-model", async (req, res) => {
  if (await proxyModelApi(req, res, "/api/train-model")) return;
  if (!(await requireModelApiKey(req, res))) return;
  const defaultEnd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const {
    start = "20220101",
    end = defaultEnd,
    markets: selectedMarkets = ["A股"],
    maxPerMarket,
    workers = 8,
    validationFraction = 0.3,
    downloadPause = 0.5,
    downloadTimeout = 15
  } = req.body || {};

  const tempDir = path.join(__dirname, ".tmp");
  await fs.mkdir(tempDir, { recursive: true });
  const jsonPath = path.join(tempDir, `training-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

  const marketArg = Array.isArray(selectedMarkets) && selectedMarkets.length
    ? selectedMarkets.join(",")
    : "A股";

  const args = [
    path.join(__dirname, "model_training.py"),
    "--start",
    start,
    "--end",
    end,
    "--markets",
    marketArg,
    "--workers",
    String(workers),
    "--validation-fraction",
    String(validationFraction),
    "--download-pause",
    String(downloadPause),
    "--download-timeout",
    String(downloadTimeout),
    "--data-source",
    "tencent",
    "--json-output",
    jsonPath
  ];

  if (maxPerMarket) {
    args.push("--max-per-market", String(maxPerMarket));
  }

  const child = spawn("python3", args, { cwd: __dirname, env: process.env });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, 2700000);

  child.on("close", async (code, signal) => {
    clearTimeout(timer);
    try {
      if (code !== 0) {
        res.status(500).json({
          error: signal ? `模型训练超时或被终止: ${signal}` : "模型训练失败",
          stdout,
          stderr
        });
        return;
      }

      const raw = await fs.readFile(jsonPath, "utf-8");
      const result = JSON.parse(raw);
      await fs.writeFile(latestTrainingModelPath, raw, "utf-8");
      await fs.rm(jsonPath, { force: true });
      res.json({ result: { ...result, savedModelPath: latestTrainingModelPath } });
    } catch (error) {
      res.status(500).json({
        error: "读取训练结果失败",
        detail: error.message,
        stdout,
        stderr
      });
    }
  });
});

app.post("/api/run-selector-experiment", async (_req, res) => {
  if (await proxyModelApi(_req, res, "/api/run-selector-experiment")) return;
  if (!(await requireModelApiKey(_req, res))) return;
  const tempDir = path.join(__dirname, ".tmp");
  await fs.mkdir(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, "asset-selector-experiment-latest.json");
  let sourcePath = null;

  for (const fileName of selectorSourceCandidates) {
    const candidatePath = path.join(tempDir, fileName);
    try {
      await fs.access(candidatePath);
      sourcePath = candidatePath;
      break;
    } catch {}
  }

  if (!sourcePath) {
    res.status(404).json({ error: "没有找到可用于选择器实验的训练模型文件" });
    return;
  }

  const args = [
    path.join(__dirname, "asset_selector_experiment.py"),
    "--source",
    sourcePath,
    "--output",
    outputPath,
    "--history",
    selectorExperimentHistoryPath
  ];

  const child = spawn("python3", args, { cwd: __dirname, env: process.env });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, 600000);

  child.on("close", async (code, signal) => {
    clearTimeout(timer);
    try {
      if (code !== 0) {
        res.status(500).json({
          error: signal ? `选择器实验超时或被终止: ${signal}` : "选择器实验失败",
          stdout,
          stderr
        });
        return;
      }

      const raw = await fs.readFile(outputPath, "utf-8");
      const historyRaw = await fs.readFile(selectorExperimentHistoryPath, "utf-8");
      res.json({
        result: JSON.parse(raw),
        experiments: JSON.parse(historyRaw),
        sourcePath,
        outputPath,
        historyPath: selectorExperimentHistoryPath,
        stdout,
        stderr
      });
    } catch (error) {
      res.status(500).json({
        error: "读取选择器实验结果失败",
        detail: error.message,
        stdout,
        stderr
      });
    }
  });
});

// app.listen(...) removed, as app is now mounted inside vite.config.js
