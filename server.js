import express from "express";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const app = express();

app.use(express.json({ limit: "1mb" }));

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

app.get("/api/markets", (_req, res) => {
  res.json({ markets });
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
          error: signal ? `回测超时或被终止: ${signal}` : "stock1.py 运行失败",
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

// app.listen(...) removed, as app is now mounted inside vite.config.js
