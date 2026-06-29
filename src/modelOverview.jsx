import React, { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { Atom, BadgeCheck, Binary, Boxes, CandlestickChart, DatabaseZap, Gauge, Layers3, LineChart, ShieldCheck, SlidersHorizontal, Sparkles, TrendingUp } from "lucide-react";

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

const PT_REPORT_DAILY_LIMIT = 3;
const MODEL_API_PATH = "/model-api/";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readPtReportQuota() {
  try {
    const raw = window.localStorage.getItem("finterraPtReportQuota");
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.date === todayKey()) return parsed;
  } catch {}
  return { date: todayKey(), used: 0 };
}

function consumePtReportQuota() {
  const quota = readPtReportQuota();
  if (quota.used >= PT_REPORT_DAILY_LIMIT) return { ok: false, quota };
  const next = { date: todayKey(), used: quota.used + 1 };
  window.localStorage.setItem("finterraPtReportQuota", JSON.stringify(next));
  return { ok: true, quota: next };
}

function ptReportRemaining() {
  return Math.max(0, PT_REPORT_DAILY_LIMIT - readPtReportQuota().used);
}

function calculatePtReportSummary(result) {
  const uniform = result?.metrics?.uniform || {};
  const pt = result?.metrics?.pt || {};
  const drawdown = Math.abs(Number(pt["最大回撤"] ?? uniform["最大回撤"] ?? 0));
  const sharpe = Number(pt["夏普比率"] ?? 0);
  const baselineDrawdown = Math.abs(Number(uniform["最大回撤"] ?? 0));
  const drawdownRelief = baselineDrawdown ? Math.max(-1, Math.min(1, (baselineDrawdown - drawdown) / baselineDrawdown)) : 0;
  const returnLift = Number(pt["累计收益率"] ?? 0) - Number(uniform["累计收益率"] ?? 0);
  const tailRiskLevel = drawdown >= 0.42 ? "高" : drawdown >= 0.24 ? "中" : "低";
  const heavyTailStrength = Math.min(100, Math.max(0, drawdown * 120 + Math.max(0, returnLift) * 25 + Math.max(0, 1 - sharpe) * 12));
  const robustnessScore = Math.round(Math.min(100, Math.max(0, 58 + sharpe * 12 + drawdownRelief * 22 + returnLift * 18 - drawdown * 18)));
  return {
    tailRiskLevel,
    heavyTailStrength: Math.round(heavyTailStrength),
    robustnessScore,
    note: "免费摘要只展示风险等级和评分。完整报告会展开 PT 分布参数、VaR/CVaR、极端情景、历史 regime 和可下载证据链。"
  };
}

function useChart(option, deps) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    chartRef.current = echarts.init(ref.current);
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(option, true);
    }
  }, deps);

  useEffect(() => {
    const resize = () => chartRef.current?.resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return ref;
}

function ModelChart({ markets }) {
  const option = useMemo(() => {
    const names = markets.map((item) => item.market);
    const totalReturn = markets.map((item) => asNumber(item.validationEvidence?.avgImprovement?.totalReturn) * 100);
    const annualReturn = markets.map((item) => asNumber(item.validationEvidence?.avgImprovement?.annualReturn) * 100);
    const drawdown = markets.map((item) => asNumber(item.validationEvidence?.avgImprovement?.maxDrawdown) * 100);
    const sharpe = markets.map((item) => asNumber(item.validationEvidence?.avgImprovement?.sharpe));
    return {
      animation: false,
      color: ["#2563eb", "#dc2626", "#059669", "#7c3aed"],
      tooltip: { trigger: "axis" },
      legend: { top: 0, data: ["累计收益改善", "年化收益改善", "最大回撤改善", "夏普改善"] },
      grid: { left: 48, right: 22, top: 46, bottom: 34 },
      xAxis: { type: "category", data: names, axisTick: { show: false } },
      yAxis: [
        { type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
        { type: "value", axisLabel: { formatter: "{value}" }, splitLine: { show: false } }
      ],
      series: [
        { name: "累计收益改善", type: "bar", data: totalReturn, barMaxWidth: 28 },
        { name: "年化收益改善", type: "bar", data: annualReturn, barMaxWidth: 28 },
        { name: "最大回撤改善", type: "bar", data: drawdown, barMaxWidth: 28 },
        { name: "夏普改善", type: "line", yAxisIndex: 1, data: sharpe, symbolSize: 8, lineStyle: { width: 3 } }
      ]
    };
  }, [markets]);
  const ref = useChart(option, [option]);
  return <div className="model-chart" ref={ref} />;
}

function MarketScoreChart({ markets }) {
  const option = useMemo(() => {
    const data = markets.map((item) => {
      const improvement = item.validationEvidence?.avgImprovement || {};
      return [
        asNumber(improvement.totalReturn) * 100,
        asNumber(improvement.maxDrawdown) * 100,
        asNumber(improvement.sharpe),
        item.market,
        item.counts?.successfulStocks || 0
      ];
    });
    return {
      animation: false,
      color: ["#0f766e"],
      tooltip: {
        formatter: (params) => {
          const item = params.value;
          return `${item[3]}<br/>收益改善: ${item[0].toFixed(2)}%<br/>回撤改善: ${item[1].toFixed(2)}%<br/>夏普改善: ${item[2].toFixed(3)}<br/>成功标的: ${item[4]}`;
        }
      },
      grid: { left: 54, right: 24, top: 18, bottom: 42 },
      xAxis: { name: "收益改善", type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
      yAxis: { name: "回撤改善", type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
      series: [
        {
          type: "scatter",
          symbolSize: (value) => Math.max(22, Math.min(64, Math.sqrt(value[4]) * 0.58)),
          data,
          label: { show: true, formatter: (params) => params.value[3], color: "#0f172a", fontWeight: 800 },
          itemStyle: { color: "#14b8a6", opacity: 0.78, borderColor: "#ffffff", borderWidth: 2 }
        }
      ]
    };
  }, [markets]);
  const ref = useChart(option, [option]);
  return <div className="model-chart compact" ref={ref} />;
}

function HeroStat({ label, value, note, icon: Icon }) {
  return (
    <article className="hero-stat">
      <span><Icon size={18} /></span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function MarketCard({ market, active, onClick }) {
  const improvement = market.validationEvidence?.avgImprovement || {};
  const params = market.parameters || {};
  return (
    <button className={active ? "model-market-card active" : "model-market-card"} type="button" onClick={onClick}>
      <div className="model-market-head">
        <span>{market.market}</span>
        <strong>{params.modeLabel || params.mode}</strong>
      </div>
      <div className="model-market-metrics">
        <div>
          <small>收益改善</small>
          <b>{pct(improvement.totalReturn)}</b>
        </div>
        <div>
          <small>年化改善</small>
          <b>{pct(improvement.annualReturn)}</b>
        </div>
        <div>
          <small>夏普改善</small>
          <b>{num(improvement.sharpe, 3)}</b>
        </div>
        <div>
          <small>回撤改善</small>
          <b>{pct(improvement.maxDrawdown)}</b>
        </div>
      </div>
    </button>
  );
}

function stockStatus(stock) {
  if (stock.selectionStatus === "fallback_best_available") return "候选最优";
  if (stock.drawdownPass || stock.passAll) return "四项通过";
  if (stock.strictPass) return "三项提升";
  return "部分改善";
}

function metricPctValue(metrics, key) {
  return pct(metrics?.[key]);
}

function metricNumValue(metrics, key, digits = 3) {
  return num(metrics?.[key], digits);
}

function BacktestCurve({ result }) {
  const option = useMemo(() => {
    const dates = result?.series?.dates || [];
    return {
      animation: false,
      color: ["#2563eb", "#db2777"],
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => `${((Number(value) - 1) * 100).toFixed(2)}%`
      },
      legend: { top: 0, data: ["5-20收益率曲线", "量子5-20收益率曲线"] },
      grid: { left: 54, right: 22, top: 42, bottom: 32 },
      xAxis: { type: "category", data: dates, axisTick: { show: false } },
      yAxis: {
        type: "value",
        axisLabel: { formatter: (value) => `${((value - 1) * 100).toFixed(0)}%` },
        splitLine: { show: false }
      },
      series: [
        { name: "5-20收益率曲线", type: "line", symbol: "none", data: result?.series?.netUniform || [], lineStyle: { width: 2 } },
        { name: "量子5-20收益率曲线", type: "line", symbol: "none", data: result?.series?.netPt || [], lineStyle: { width: 3 } }
      ]
    };
  }, [result]);
  const ref = useChart(option, [option]);
  return <div className="stock-detail-chart" ref={ref} />;
}

function BacktestKlineChart({ result, seriesKey, title }) {
  const option = useMemo(() => {
    const dates = result?.series?.dates || [];
    const series = result?.series?.[seriesKey] || {};
    const buyData = (series.buyPoints || []).map((point) => [point.date, point.price]);
    const sellData = (series.sellPoints || []).map((point) => [point.date, point.price]);
    return {
      animation: false,
      color: ["#ef4444", "#2563eb", "#a3e635", "#a855f7", "#06b6d4"],
      tooltip: { trigger: "axis" },
      legend: { top: 0, data: ["K线", "MA5", "MA20", "买入", "卖出"] },
      grid: { left: 54, right: 22, top: 42, bottom: 44 },
      xAxis: { type: "category", data: dates, axisTick: { show: false } },
      yAxis: { scale: true, splitLine: { show: false } },
      dataZoom: [
        { type: "inside", start: 58, end: 100 },
        { type: "slider", start: 58, end: 100, bottom: 6, height: 18 }
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          data: series.kline || [],
          itemStyle: {
            color: "#ef4444",
            color0: "#10b981",
            borderColor: "#ef4444",
            borderColor0: "#10b981"
          }
        },
        { name: "MA5", type: "line", data: series.ma5 || [], symbol: "none", smooth: true, lineStyle: { width: 1.8 } },
        { name: "MA20", type: "line", data: series.ma20 || [], symbol: "none", smooth: true, lineStyle: { width: 1.8 } },
        { name: "买入", type: "scatter", data: buyData, symbol: "triangle", symbolSize: 12, itemStyle: { color: "#a855f7", borderColor: "#ffffff", borderWidth: 1 } },
        { name: "卖出", type: "scatter", data: sellData, symbol: "triangle", symbolRotate: 180, symbolSize: 12, itemStyle: { color: "#06b6d4", borderColor: "#ffffff", borderWidth: 1 } }
      ]
    };
  }, [result, seriesKey]);
  const ref = useChart(option, [option]);
  return (
    <article className="stock-kline-card">
      <h4>{title}</h4>
      <div ref={ref} />
    </article>
  );
}

function TradePreview({ title, trades, quantum }) {
  const rows = (trades || []).slice(0, 10);
  return (
    <article className="trade-preview">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>买入日期</th>
              <th>卖出日期</th>
              {quantum && <th>量子买入价</th>}
              {quantum && <th>量子卖出价</th>}
              <th>买入价</th>
              <th>卖出价</th>
              <th>收益率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((trade, index) => (
              <tr key={`${trade["买入日期"]}-${trade["卖出日期"]}-${index}`}>
                <td>{trade["买入日期"]}</td>
                <td>{trade["卖出日期"]}</td>
                {quantum && <td>{num(trade["量子算法买入价"], 2)}</td>}
                {quantum && <td>{num(trade["量子算法卖出价"], 2)}</td>}
                <td>{num(trade["买入价"], 2)}</td>
                <td>{num(trade["卖出价"], 2)}</td>
                <td className={asNumber(trade["收益率"]) >= 0 ? "up" : "down"}>{pct(trade["收益率"])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PTReportSummaryPanel({ result, stock }) {
  const [summary, setSummary] = useState(null);
  const [remaining, setRemaining] = useState(() => ptReportRemaining());
  const reportKey = stock?.symbol || "";

  useEffect(() => {
    setSummary(null);
    setRemaining(ptReportRemaining());
  }, [reportKey]);

  const generateSummary = () => {
    const consumed = consumePtReportQuota();
    setRemaining(Math.max(0, PT_REPORT_DAILY_LIMIT - consumed.quota.used));
    if (!consumed.ok) {
      window.location.href = new URL(MODEL_API_PATH, window.location.origin).toString();
      return;
    }
    setSummary(calculatePtReportSummary(result));
  };

  return (
    <article className="stock-pt-summary-card">
      <div>
        <p className="eyebrow">Free PT Deep Report</p>
        <h4>PT 深度风险诊断摘要</h4>
        <p>每天免费生成 3 次摘要；完整报告、参数解释、VaR/CVaR、极端情景和下载能力进入 Pro。</p>
      </div>
      <div className="pt-report-actions">
        <span>今日剩余 {remaining}/{PT_REPORT_DAILY_LIMIT}</span>
        <button className="small-run-button" type="button" onClick={generateSummary}>
          <Sparkles size={15} />
          生成免费摘要
        </button>
        <a className="small-run-button paid-link" href={MODEL_API_PATH}>查看详细报告</a>
      </div>
      {summary ? (
        <div className="pt-summary-grid">
          <article>
            <small>尾部风险等级</small>
            <strong>{summary.tailRiskLevel}</strong>
          </article>
          <article>
            <small>重尾强度</small>
            <strong>{summary.heavyTailStrength}/100</strong>
          </article>
          <article>
            <small>策略稳健性评分</small>
            <strong>{summary.robustnessScore}/100</strong>
          </article>
          <p>{summary.note}</p>
        </div>
      ) : (
        <div className="pt-report-locked">
          <ShieldCheck size={20} />
          <span>免费层只展示摘要，不提供荐股、买卖点、目标价或收益承诺。</span>
        </div>
      )}
    </article>
  );
}

function StockBacktestDetail({ stock, result, loading, error }) {
  if (!stock) {
    return (
      <div className="stock-detail-empty">
        <strong>点击任意股票</strong>
        <span>同页运行单股回测，直接查看 5-20 与量子5-20 的收益、年化、夏普、回撤和交易明细。</span>
      </div>
    );
  }

  const uniform = result?.metrics?.uniform || {};
  const pt = result?.metrics?.pt || {};
  const summary = result?.summary || {};

  return (
    <div className="stock-detail-panel">
      <div className="stock-detail-head">
        <div>
          <p className="eyebrow">{stock.market} Single Stock Backtest</p>
          <h3>{stock.name} ({stock.symbol})</h3>
          {result?.dateRange && <p>{result.dateRange.start} 至 {result.dateRange.end}，{result.dateRange.rows} 行</p>}
        </div>
        <div className="stock-param-tags">
          <span>mode {summary.mode || stock.params?.mode || "-"}</span>
          <span>qHead {num(summary.qHead ?? stock.params?.qHead, 2)}</span>
          <span>qTail {num(summary.qTail ?? stock.params?.qTail, 2)}</span>
          <span>eta {num(summary.eta ?? stock.params?.eta, 2)}</span>
        </div>
      </div>
      {loading && <div className="inline-loading">正在计算这只股票的单股回测...</div>}
      {error && <div className="error-banner">{error}</div>}
      {result && (
        <>
          <div className="single-backtest-grid">
            <article>
              <h4>5-20均线回测</h4>
              <dl>
                <div><dt>夏普比率</dt><dd>{metricNumValue(uniform, "夏普比率")}</dd></div>
                <div><dt>累计收益率</dt><dd>{metricPctValue(uniform, "累计收益率")}</dd></div>
                <div><dt>年化收益率</dt><dd>{metricPctValue(uniform, "年化收益率")}</dd></div>
                <div><dt>最大回撤</dt><dd>{metricPctValue(uniform, "最大回撤")}</dd></div>
              </dl>
            </article>
            <article className="quantum">
              <h4>量子5-20均线回测</h4>
              <dl>
                <div><dt>夏普比率</dt><dd>{metricNumValue(pt, "夏普比率")}</dd></div>
                <div><dt>累计收益率</dt><dd>{metricPctValue(pt, "累计收益率")}</dd></div>
                <div><dt>年化收益率</dt><dd>{metricPctValue(pt, "年化收益率")}</dd></div>
                <div><dt>最大回撤</dt><dd>{metricPctValue(pt, "最大回撤")}</dd></div>
              </dl>
            </article>
          </div>
          <PTReportSummaryPanel result={result} stock={stock} />
          <BacktestCurve result={result} />
          <div className="stock-kline-grid">
            <BacktestKlineChart result={result} seriesKey="uniform" title="真实历史 K 线与5-20均线买卖点" />
            <BacktestKlineChart result={result} seriesKey="pt" title="真实历史 K 线量子5-20均线与买卖点" />
          </div>
          <div className="trade-preview-grid">
            <TradePreview title="真实每次交易细节" trades={result.trades?.uniform} />
            <TradePreview title="量子算法每次交易细节" trades={result.trades?.pt} quantum />
          </div>
        </>
      )}
    </div>
  );
}

function StockTable({ stocks, selectedSymbol, onSelect }) {
  return (
    <div className="table-wrap model-stock-wrap">
      <table className="model-stock-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>代码</th>
            <th>状态</th>
            <th>原累计</th>
            <th>PT累计</th>
            <th>改善</th>
            <th>原年化</th>
            <th>PT年化</th>
            <th>原夏普</th>
            <th>PT夏普</th>
            <th>原回撤</th>
            <th>PT回撤</th>
            <th>回撤改善</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock) => (
            <tr
              key={`${stock.market}-${stock.symbol}`}
              className={selectedSymbol === stock.symbol ? "selected" : ""}
              onClick={() => onSelect(stock)}
            >
              <td>{stock.name}</td>
              <td>{stock.symbol}</td>
              <td>{stockStatus(stock)}</td>
              <td>{pct(stock.baseline?.totalReturn)}</td>
              <td>{pct(stock.metrics?.totalReturn)}</td>
              <td className={asNumber(stock.improvement?.totalReturn) >= 0 ? "up" : "down"}>{pct(stock.improvement?.totalReturn)}</td>
              <td>{pct(stock.baseline?.annualReturn)}</td>
              <td>{pct(stock.metrics?.annualReturn)}</td>
              <td>{num(stock.baseline?.sharpe, 3)}</td>
              <td>{num(stock.metrics?.sharpe, 3)}</td>
              <td>{pct(stock.baseline?.maxDrawdown)}</td>
              <td>{pct(stock.metrics?.maxDrawdown)}</td>
              <td className={asNumber(stock.improvement?.maxDrawdown) >= 0 ? "up" : "down"}>{pct(stock.improvement?.maxDrawdown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModelOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activeMarket, setActiveMarket] = useState("A股");
  const [rankMode, setRankMode] = useState("balanced");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedStock, setSelectedStock] = useState(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");

  useEffect(() => {
    fetch("/api/model-overview")
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!ok) throw new Error(payload.error || "模型总览加载失败");
        setData(payload.data);
        setActiveMarket(payload.data?.markets?.[0]?.market || "A股");
      })
      .catch((err) => setError(err.message));
  }, []);

  const markets = data?.markets || [];
  const selectedMarket = markets.find((item) => item.market === activeMarket) || markets[0];
  const allMarketStocks = selectedMarket?.allStocks || selectedMarket?.topStocks?.balanced || [];
  const selectedStocks = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const filtered = allMarketStocks.filter((stock) => {
      const matchesKeyword = !keyword
        || String(stock.name || "").toLowerCase().includes(keyword)
        || String(stock.symbol || "").toLowerCase().includes(keyword);
      const status = stockStatus(stock);
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "four" && status === "四项通过")
        || (statusFilter === "strict" && status === "三项提升")
        || (statusFilter === "partial" && status !== "四项通过");
      return matchesKeyword && matchesStatus;
    });

    const scoreFor = (stock) => {
      if (rankMode === "score") return asNumber(stock.score);
      if (rankMode === "return") return asNumber(stock.improvement?.totalReturn);
      if (rankMode === "annual") return asNumber(stock.improvement?.annualReturn);
      if (rankMode === "sharpe") return asNumber(stock.improvement?.sharpe);
      if (rankMode === "drawdown") return asNumber(stock.improvement?.maxDrawdown);
      return asNumber(stock.strictObjective ?? stock.rankScore ?? stock.score);
    };

    return [...filtered].sort((a, b) => {
      if (rankMode === "symbol") return String(a.symbol || "").localeCompare(String(b.symbol || ""));
      return scoreFor(b) - scoreFor(a);
    });
  }, [allMarketStocks, rankMode, searchTerm, statusFilter]);

  useEffect(() => {
    setSearchTerm("");
    setStatusFilter("all");
    setSelectedStock(null);
    setBacktestResult(null);
    setBacktestError("");
    setBacktestLoading(false);
  }, [activeMarket]);

  const runStockBacktest = async (stock) => {
    setSelectedStock(stock);
    setBacktestResult(null);
    setBacktestError("");
    setBacktestLoading(true);
    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.symbol, name: stock.name, start: "20220101" })
      });
      const payload = await response.json();
      if (response.status === 402 && payload.upgradeUrl) {
        window.location.href = new URL(payload.upgradeUrl, window.location.origin).toString();
        return;
      }
      if (!response.ok) throw new Error(payload.error || payload.detail || "单股回测失败");
      setBacktestResult(payload.result);
    } catch (err) {
      setBacktestError(err.message);
    } finally {
      setBacktestLoading(false);
    }
  };

  if (error) {
    return (
      <main className="model-overview-page">
        <section className="error-banner">{error}</section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="model-overview-page">
        <section className="loading-state">
          <div className="loader" />
          <h2>正在加载模型总览</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="model-overview-page">
      <section className="model-hero">
        <div className="model-hero-copy">
          <p className="eyebrow">Synthetic Market Data Engine</p>
          <h1>PT 重尾合成数据模型</h1>
          <p>
            我们最终售卖的是一套可交付给量化机构的合成 OHLCV 数据。它保留真实市场的骨架，
            再用 Porter-Thomas 重尾分布和个股 alpha 优化器生成更关注极端行情的 PT 价格路径。
          </p>
          <div className="model-hero-tags">
            <span><DatabaseZap size={16} /> 合成行情数据</span>
            <span><Atom size={16} /> Porter-Thomas 重尾先验</span>
            <span><ShieldCheck size={16} /> 不改变客户原策略</span>
          </div>
        </div>
        <div className="model-machine">
          <div className="machine-row">
            <span>真实 OHLCV</span>
            <b>Market Tape</b>
          </div>
          <div className="machine-row">
            <span>H / M / L 分桶</span>
            <b>Tail Regime Split</b>
          </div>
          <div className="machine-row accent">
            <span>PT 重尾映射</span>
            <b>Synthetic OHLCV</b>
          </div>
          <div className="machine-row">
            <span>市场级参数</span>
            <b>Per-Stock Alpha</b>
          </div>
        </div>
      </section>

      <section className="hero-stat-grid">
        <HeroStat icon={Boxes} label="覆盖市场" value={`${data.marketTotals.markets} 个`} note="A股、美股、港股、加密货币分别训练独立模型。" />
        <HeroStat icon={CandlestickChart} label="成功标的" value={data.marketTotals.successfulStocks.toLocaleString()} note="全量本地 CSV 已完成训练并生成候选结果。" />
        <HeroStat icon={BadgeCheck} label="模型目标" value="个股增强" note="每只股票保留自己的最高得分 PT 参数。" />
        <HeroStat icon={SlidersHorizontal} label="参数网格" value={`${data.grid.combinations} 组`} note="模式、分桶分位数、混合系数共同搜索。" />
      </section>

      <section className="model-section">
        <div className="section-head">
          <h2>我们卖的到底是什么</h2>
        </div>
        <div className="product-position">
          <article>
            <DatabaseZap size={24} />
            <h3>不是荐股，也不是单一策略</h3>
            <p>产品交付物是 PT 合成行情数据字段：`pt_open`、`pt_high`、`pt_low`、`pt_close`、`pt_volume`，客户可以把它接入现有回测、风控、择时、组合优化流程。</p>
          </article>
          <article>
            <Layers3 size={24} />
            <h3>三段式重尾状态</h3>
            <p>先把真实收益分成常态、过渡、极端三种状态，再只在关键区间注入 PT 重尾权重，避免把普通行情也改得面目全非。</p>
          </article>
          <article>
            <Gauge size={24} />
            <h3>模型训练优化参数</h3>
            <p>当前使用的是 <strong>{data.modelName}</strong>。优化器在每个市场扫描分桶分位数、混合系数和变换模式，并为每只股票保留收益增强最强的参数。</p>
          </article>
        </div>
      </section>

      <section className="model-section">
        <div className="section-head">
          <h2>PT 重尾分布的三种情况</h2>
        </div>
        <div className="bucket-grid">
          {data.ptBuckets.map((bucket) => (
            <article key={bucket.key}>
              <span>{bucket.key}</span>
              <h3>{bucket.name}</h3>
              <p>{bucket.definition}</p>
              <strong>{bucket.role}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="model-section">
        <div className="section-head">
          <h2>四个市场的整体增强效果</h2>
        </div>
        <div className="model-chart-grid">
          <ModelChart markets={markets} />
          <MarketScoreChart markets={markets} />
        </div>
      </section>

      <section className="model-section">
        <div className="section-head">
          <h2>市场代表参数与逐股 alpha</h2>
        </div>
        <div className="model-market-grid">
          {markets.map((market) => (
            <MarketCard key={market.market} market={market} active={selectedMarket?.market === market.market} onClick={() => setActiveMarket(market.market)} />
          ))}
        </div>
        {selectedMarket && (
          <div className="market-detail-panel">
            <div>
              <p className="eyebrow">{selectedMarket.market} Alpha Model</p>
              <h3>{selectedMarket.parameters.modeLabel}</h3>
              <p>
                qHead={num(selectedMarket.parameters.qHead, 2)}，
                qTail={num(selectedMarket.parameters.qTail, 2)}，
                eta={num(selectedMarket.parameters.eta, 2)}。
                逐股最优参数来自全量候选网格；这里显示的是该市场最常见的代表参数。
              </p>
            </div>
            <div className="detail-metrics">
              <span>成功 {selectedMarket.counts.successfulStocks}</span>
              <span>失败 {selectedMarket.counts.failedStocks}</span>
              <span>逐股参数 {selectedMarket.selectedStockCount}</span>
              <span>四项通过率 {pct(selectedMarket.selectedPassAllRate)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="model-section">
        <div className="section-head">
          <div>
            <h2>个股层面效果</h2>
            <p className="section-subtitle">
              {selectedMarket?.market} 全量 {allMarketStocks.length.toLocaleString()} 只，当前显示 {selectedStocks.length.toLocaleString()} 只。点击任意股票查看单股 5-20 / 量子5-20 回测效果。
            </p>
          </div>
          <div className="stock-controls">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="搜索名称或代码"
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="four">四项通过</option>
              <option value="strict">三项提升</option>
              <option value="partial">非四项通过</option>
            </select>
            <div className="rank-switch">
              {[
                ["balanced", "综合"],
                ["return", "收益"],
                ["annual", "年化"],
                ["sharpe", "夏普"],
                ["drawdown", "回撤"],
                ["symbol", "代码"]
              ].map(([key, label]) => (
                <button key={key} className={rankMode === key ? "active" : ""} type="button" onClick={() => setRankMode(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <StockBacktestDetail stock={selectedStock} result={backtestResult} loading={backtestLoading} error={backtestError} />
        <StockTable stocks={selectedStocks} selectedSymbol={selectedStock?.symbol} onSelect={runStockBacktest} />
      </section>

      <section className="model-section model-close">
        <div>
          <p className="eyebrow">Why It Matters</p>
          <h2>客户不需要换策略，只需要换一层数据底座。</h2>
        </div>
        <p>
          这套模型的商业价值在于：把量子 PT 重尾先验包装成可交付的合成市场数据。
          客户继续运行自己的信号、风控和回测框架，我们提供一条更重视尾部事件的价格路径，
          让原策略在极端状态下暴露出更真实的收益与风险画像。
        </p>
      </section>
    </main>
  );
}
