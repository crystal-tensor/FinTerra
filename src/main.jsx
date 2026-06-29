import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
import { Atom, BarChart3, BrainCircuit, CandlestickChart, ChevronRight, Layers3, Play, Search, ShieldCheck, Sparkles, TrendingUp, X } from "lucide-react";
import { GlobalMarketGraph } from "./globalMarketGraph.jsx";
import { FinancialIntelligenceLab } from "./financialIntelligenceLab.jsx";
import { PortalHome } from "./portalHome.jsx";
import { AgentEvolution } from "./agentEvolution.jsx";
import { ModelOverview } from "./modelOverview.jsx";
import { ModelApiPage } from "./modelApiPage.jsx";
import "./styles.css";

function todayAsYYYYMMDD() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

const defaultRange = {
  start: "20220101",
  end: todayAsYYYYMMDD()
};

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function number(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(2);
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

function useEChart(option, deps) {
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
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return ref;
}

function KlinePanel({ dates, data }) {
  const option = useMemo(() => {
    if (!dates || !data) return null;
    const { kline, ma5, ma20, buyPoints, sellPoints } = data;
    const buyData = buyPoints.map((item) => [item.date, item.price]);
    const sellData = sellPoints.map((item) => [item.date, item.price]);

    return {
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      legend: { top: 8, data: ["K线", "MA5", "MA20", "买入", "卖出"] },
      grid: { left: 54, right: 32, top: 48, bottom: 42 },
      xAxis: { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: "#94a3b8" } } },
      yAxis: { scale: true, splitLine: { show: false } },
      dataZoom: [
        { type: "inside", start: 50, end: 100 },
        { type: "slider", height: 18, bottom: 8, start: 50, end: 100 }
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          data: kline,
          itemStyle: {
            color: "#ef4444",
            color0: "#10b981",
            borderColor: "#ef4444",
            borderColor0: "#10b981"
          }
        },
        { name: "MA5", type: "line", data: ma5, smooth: true, showSymbol: false, lineStyle: { width: 1.5, color: "#f59e0b" } },
        { name: "MA20", type: "line", data: ma20, smooth: true, showSymbol: false, lineStyle: { width: 1.5, color: "#2563eb" } },
        {
          name: "买入",
          type: "scatter",
          data: buyData,
          symbol: "triangle",
          symbolSize: 18,
          itemStyle: { color: "#a855f7", borderColor: "#f8fafc", borderWidth: 2 },
          z: 5
        },
        {
          name: "卖出",
          type: "scatter",
          data: sellData,
          symbol: "triangle",
          symbolRotate: 180,
          symbolSize: 18,
          itemStyle: { color: "#06b6d4", borderColor: "#f8fafc", borderWidth: 2 },
          z: 5
        }
      ]
    };
  }, [dates, data]);

  const ref = useEChart(option, [option]);
  return <div ref={ref} className="chart chart-tall" />;
}

function ReturnPanel({ result }) {
  const option = useMemo(() => {
    if (!result) return null;
    const { dates, netUniform, netPt } = result.series;
    return {
      animation: false,
      tooltip: { trigger: "axis" },
      legend: { top: 8, data: ["5-20均线策略", "量子5-20均线策略"] },
      grid: { left: 54, right: 28, top: 48, bottom: 34 },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: "#94a3b8" } } },
      yAxis: { type: "value", scale: true, splitLine: { show: false } },
      dataZoom: [{ type: "inside", start: 50, end: 100 }],
      series: [
        { name: "5-20均线策略", type: "line", data: netUniform, showSymbol: false, lineStyle: { width: 2, color: "#2563eb" } },
        { name: "量子5-20均线策略", type: "line", data: netPt, showSymbol: false, lineStyle: { width: 2, color: "#e11d48" } }
      ]
    };
  }, [result]);

  const ref = useEChart(option, [option]);
  return <div ref={ref} className="chart chart-medium" />;
}

function StockModal({ market, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const customSymbol = query.trim().toUpperCase();
  const stocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return market.stocks;
    return market.stocks.filter((stock) => `${stock.symbol} ${stock.name}`.toLowerCase().includes(q));
  }, [market, query]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" aria-modal="true">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{market.region}</p>
            <h2>{market.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <label className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码或名称" />
        </label>
        <div className="stock-grid">
          {customSymbol && !stocks.some((stock) => stock.symbol.toUpperCase() === customSymbol) && (
            <button className="stock-row custom-stock" type="button" onClick={() => onSelect({ symbol: customSymbol, name: customSymbol })}>
              <span>使用代码</span>
              <strong>{customSymbol}</strong>
            </button>
          )}
          {stocks.map((stock) => (
            <button key={stock.symbol} className="stock-row" type="button" onClick={() => onSelect(stock)}>
              <span>{stock.name}</span>
              <strong>{stock.symbol}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metrics({ title, metrics, accent }) {
  const items = [
    ["夏普比率", number(metrics?.["夏普比率"])],
    ["累计收益率", percent(metrics?.["累计收益率"])],
    ["年化收益率", percent(metrics?.["年化收益率"])],
    ["最大回撤", percent(metrics?.["最大回撤"])]
  ];

  return (
    <section className="metric-group">
      <div className="metric-title" style={{ "--accent": accent }}>
        <span />
        {title}
      </div>
      <div className="metrics">
        {items.map(([label, value]) => (
          <div className="metric" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function TradesTable({ trades }) {
  // 检查是否包含“量子算法买入价”这一列，来决定显示哪些表头
  const isPT = trades.length > 0 && "量子算法买入价" in trades[0];

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>买入日期</th>
            <th>卖出日期</th>
            {isPT && <th>量子算法买入价</th>}
            {isPT && <th>量子算法卖出价</th>}
            <th>买入价</th>
            <th>卖出价</th>
            <th>绝对收益</th>
            <th>收益率</th>
          </tr>
        </thead>
        <tbody>
          {trades.length ? (
            trades.map((trade, index) => (
              <tr key={`${trade["买入日期"]}-${index}`}>
                <td>{trade["买入日期"]}</td>
                <td>{trade["卖出日期"]}</td>
                {isPT && <td>{number(trade["量子算法买入价"])}</td>}
                {isPT && <td>{number(trade["量子算法卖出价"])}</td>}
                <td>{number(trade["买入价"])}</td>
                <td>{number(trade["卖出价"])}</td>
                <td className={trade["绝对收益"] >= 0 ? "up" : "down"}>{number(trade["绝对收益"])}</td>
                <td className={trade["收益率"] >= 0 ? "up" : "down"}>{percent(trade["收益率"])}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={isPT ? 8 : 6}>区间内无完整交易</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceRow({ label, params, trainEvidence, validationEvidence }) {
  const validation = validationEvidence || {};
  const improvement = validation.avgImprovement || {};
  return (
    <tr>
      <td>{label}</td>
      <td>{params?.mode || "-"}</td>
      <td>{number(params?.qHead)}</td>
      <td>{number(params?.qTail)}</td>
      <td>{number(params?.eta)}</td>
      <td>{trainEvidence?.stocks || 0}</td>
      <td>{validation.stocks || 0}</td>
      <td>{number(validation.avgScore)}</td>
      <td>{percent(validation.positiveScoreRate)}</td>
      <td>{percent(validation.returnImprovedRate)}</td>
      <td>{percent(validation.sharpeImprovedRate)}</td>
      <td>{percent(validation.drawdownImprovedRate)}</td>
      <td>{percent(validation.allObjectivesImprovedRate)}</td>
      <td className={(improvement.totalReturn || 0) >= 0 ? "up" : "down"}>{percent(improvement.totalReturn)}</td>
      <td className={(improvement.sharpe || 0) >= 0 ? "up" : "down"}>{number(improvement.sharpe)}</td>
      <td className={(improvement.maxDrawdown || 0) >= 0 ? "up" : "down"}>{percent(improvement.maxDrawdown)}</td>
    </tr>
  );
}

function SelectorExperiments({ experiments, onRun, running }) {
  if (!experiments.length) {
    return (
      <section className="table-section">
        <div className="section-head">
          <h3>资产选择器实验记录</h3>
          <button className="small-run-button" type="button" disabled={running} onClick={onRun}>
            <Play size={15} fill="currentColor" />
            {running ? "实验中" : "运行选择器实验"}
          </button>
        </div>
        <div className="empty-inline">暂无选择器实验结果</div>
      </section>
    );
  }

  const latest = experiments[experiments.length - 1];
  const summary = latest.bestConfig?.summary || {};
  const improvement = summary.avgImprovement || {};
  const byMarket = summary.byMarket || {};
  const oracle = latest.oracleUpperBound || {};

  return (
    <section className="table-section">
      <div className="section-head">
        <h3>资产选择器实验记录</h3>
        <button className="small-run-button" type="button" disabled={running} onClick={onRun}>
          <Play size={15} fill="currentColor" />
          {running ? "实验中" : "运行选择器实验"}
        </button>
      </div>
      <div className="selector-summary">
        <div className="metric">
          <small>最新实验</small>
          <strong>{latest.generatedAt}</strong>
        </div>
        <div className="metric">
          <small>启用变换比例</small>
          <strong>{percent(summary.activeRate)}</strong>
        </div>
        <div className="metric">
          <small>平均收益提升</small>
          <strong className={(improvement.totalReturn || 0) >= 0 ? "up" : "down"}>{percent(improvement.totalReturn)}</strong>
        </div>
        <div className="metric">
          <small>平均夏普提升</small>
          <strong className={(improvement.sharpe || 0) >= 0 ? "up" : "down"}>{number(improvement.sharpe)}</strong>
        </div>
        <div className="metric">
          <small>平均回撤改善</small>
          <strong className={(improvement.maxDrawdown || 0) >= 0 ? "up" : "down"}>{percent(improvement.maxDrawdown)}</strong>
        </div>
        <div className="metric">
          <small>同时改善覆盖率</small>
          <strong>{percent(summary.allObjectivesImprovedRate)}</strong>
        </div>
        <div className="metric">
          <small>理论上限同时改善</small>
          <strong>{percent(oracle.allObjectivesImprovedRate)}</strong>
        </div>
      </div>
      <div className="model-path">
        <small>当前结论</small>
        <strong>{latest.conclusion}</strong>
      </div>
      <div className="model-path">
        <small>实验来源</small>
        <strong>{latest.sourceModelPath || "-"}</strong>
      </div>
      <div className="table-wrap">
        <table className="training-table">
          <thead>
            <tr>
              <th>市场</th>
              <th>标的数</th>
              <th>启用比例</th>
              <th>收益提升</th>
              <th>年化提升</th>
              <th>夏普提升</th>
              <th>回撤改善</th>
              <th>三项同时改善</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byMarket).map(([market, item]) => (
              <tr key={market}>
                <td>{market}</td>
                <td>{item.assets}</td>
                <td>{percent(item.activeRate)}</td>
                <td className={(item.avgImprovement?.totalReturn || 0) >= 0 ? "up" : "down"}>{percent(item.avgImprovement?.totalReturn)}</td>
                <td className={(item.avgImprovement?.annualReturn || 0) >= 0 ? "up" : "down"}>{percent(item.avgImprovement?.annualReturn)}</td>
                <td className={(item.avgImprovement?.sharpe || 0) >= 0 ? "up" : "down"}>{number(item.avgImprovement?.sharpe)}</td>
                <td className={(item.avgImprovement?.maxDrawdown || 0) >= 0 ? "up" : "down"}>{percent(item.avgImprovement?.maxDrawdown)}</td>
                <td>{percent(item.allObjectivesImprovedRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap selector-history-wrap">
        <table className="training-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>状态</th>
              <th>样本</th>
              <th>模型</th>
              <th>目标分</th>
              <th>启用比例</th>
              <th>收益提升</th>
              <th>夏普提升</th>
              <th>回撤改善</th>
              <th>同时改善</th>
              <th>特征数</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {[...experiments].reverse().map((item) => {
              const itemSummary = item.bestConfig?.summary || {};
              const itemImprovement = itemSummary.avgImprovement || {};
              return (
                <tr key={`${item.generatedAt}-${item.experimentName}`}>
                  <td>{item.generatedAt}</td>
                  <td>{item.status}</td>
                  <td>{item.sampleCount}</td>
                  <td>{item.bestConfig?.model || "-"}</td>
                  <td>{number(item.bestConfig?.objective)}</td>
                  <td>{percent(itemSummary.activeRate)}</td>
                  <td className={(itemImprovement.totalReturn || 0) >= 0 ? "up" : "down"}>{percent(itemImprovement.totalReturn)}</td>
                  <td className={(itemImprovement.sharpe || 0) >= 0 ? "up" : "down"}>{number(itemImprovement.sharpe)}</td>
                  <td className={(itemImprovement.maxDrawdown || 0) >= 0 ? "up" : "down"}>{percent(itemImprovement.maxDrawdown)}</td>
                  <td>{percent(itemSummary.allObjectivesImprovedRate)}</td>
                  <td>{item.featureCount || "-"}</td>
                  <td>{item.sourceModelPath || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TimeSplitProgress({ progress }) {
  if (!progress) return null;
  const partial = progress.partial || {};
  const final = progress.final || {};
  const stable = final.stabilityGateConfig?.summary || partial.stableSelected;
  const calibrated = partial.calibrated;
  const oracle = final.oracleUpperBound || partial.oracleUpperBound;
  const percentComplete = progress.totalAssets ? progress.completedAssets / progress.totalAssets : progress.percent;
  const rows = [
    ["直接校准", calibrated],
    ["稳定门控", stable],
    ["理论上限", oracle]
  ].filter(([, item]) => item);

  return (
    <section className="table-section">
      <div className="section-head">
        <h3>时间切分训练进度</h3>
        <span className={progress.status === "complete" ? "status-pill complete" : "status-pill running"}>
          {progress.status === "complete" ? "已完成" : "训练中"}
        </span>
      </div>
      <div className="progress-grid">
        <div className="metric">
          <small>完成标的</small>
          <strong>
            {progress.completedAssets || 0}/{progress.totalAssets || 0}
          </strong>
        </div>
        <div className="metric">
          <small>完成比例</small>
          <strong>{percent(percentComplete)}</strong>
        </div>
        <div className="metric">
          <small>成功 / 失败</small>
          <strong>
            {progress.successAssets || 0}/{progress.failedAssets || 0}
          </strong>
        </div>
        <div className="metric">
          <small>最近完成</small>
          <strong>{progress.latestCompleted?.symbol || "-"}</strong>
        </div>
      </div>
      <div className="model-path">
        <small>更新时间</small>
        <strong>{progress.updatedAt || "-"}</strong>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="training-table compact-training-table">
            <thead>
              <tr>
                <th>结果类型</th>
                <th>启用比例</th>
                <th>收益提升</th>
                <th>年化提升</th>
                <th>夏普提升</th>
                <th>回撤改善</th>
                <th>三项同时改善</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, item]) => {
                const improvement = item.avgImprovement || {};
                return (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{percent(item.activeRate)}</td>
                    <td className={(improvement.totalReturn || 0) >= 0 ? "up" : "down"}>{percent(improvement.totalReturn)}</td>
                    <td className={(improvement.annualReturn || 0) >= 0 ? "up" : "down"}>{percent(improvement.annualReturn)}</td>
                    <td className={(improvement.sharpe || 0) >= 0 ? "up" : "down"}>{number(improvement.sharpe)}</td>
                    <td className={(improvement.maxDrawdown || 0) >= 0 ? "up" : "down"}>{percent(improvement.maxDrawdown)}</td>
                    <td>{percent(item.allObjectivesImprovedRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TrainingPage({ range, setRange }) {
  const [trainingResult, setTrainingResult] = useState(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState("");
  const [selectorExperiments, setSelectorExperiments] = useState([]);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [selectorError, setSelectorError] = useState("");
  const [timeSplitProgress, setTimeSplitProgress] = useState(null);

  useEffect(() => {
    let mounted = true;
    const loadProgress = () => {
      fetch("/api/time-split-progress")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (mounted) {
            setTimeSplitProgress(data?.progress || null);
          }
        })
        .catch(() => {});
    };
    fetch("/api/latest-model")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (mounted && data?.result) {
          setTrainingResult({ ...data.result, savedModelPath: data.path || data.result.savedModelPath });
        }
      })
      .catch(() => {});
    fetch("/api/selector-experiments")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (mounted && Array.isArray(data?.experiments)) {
          setSelectorExperiments(data.experiments);
        }
      })
      .catch(() => {});
    loadProgress();
    const progressTimer = window.setInterval(loadProgress, 5000);
    return () => {
      mounted = false;
      window.clearInterval(progressTimer);
    };
  }, []);

  const runTraining = async () => {
    setTrainingLoading(true);
    setTrainingError("");
    try {
      const response = await fetch("/api/train-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: range.start,
          end: range.end,
          markets: ["A股"],
          dataSource: "tencent",
          validationFraction: 0.3,
          downloadPause: 0.5,
          downloadTimeout: 15
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "模型训练失败");
      }
      setTrainingResult(data.result);
    } catch (err) {
      setTrainingError(err.message);
    } finally {
      setTrainingLoading(false);
    }
  };

  const runSelectorExperiment = async () => {
    setSelectorLoading(true);
    setSelectorError("");
    try {
      const response = await fetch("/api/run-selector-experiment", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "选择器实验失败");
      }
      setSelectorExperiments(data.experiments || []);
    } catch (err) {
      setSelectorError(err.message);
    } finally {
      setSelectorLoading(false);
    }
  };

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Model Training</p>
          <h2>A股模型训练</h2>
        </div>
        <div className="range-chip">
          腾讯前复权日线
          <span>50 标的</span>
        </div>
      </header>

      {trainingError && <div className="error-banner">{trainingError}</div>}
      {selectorError && <div className="error-banner">{selectorError}</div>}

      <section className="training-control">
        <div>
          <p className="eyebrow">Training Range</p>
          <h3>先训练 A股统一分桶参数和混合系数</h3>
        </div>
        <div className="training-actions">
          <label>
            <span>开始</span>
            <input value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />
          </label>
          <label>
            <span>结束</span>
            <input value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} />
          </label>
          <button className="run-button" type="button" disabled={trainingLoading} onClick={runTraining}>
            <Play size={18} fill="currentColor" />
            {trainingLoading ? "训练中" : "开始训练"}
          </button>
        </div>
      </section>

      {trainingLoading && (
        <section className="loading-state">
          <div className="loader" />
          <h2>正在训练模型……</h2>
        </section>
      )}

      {!trainingResult && !trainingLoading && (
        <section className="empty-state">
          <BrainCircuit size={44} />
          <h2>点击开始训练生成参数模型</h2>
        </section>
      )}

      {trainingResult && (
        <>
          <div className="training-overview">
            <div className="metric">
              <small>参数组合</small>
              <strong>{trainingResult.grid.combinations}</strong>
            </div>
            <div className="metric">
              <small>训练标的</small>
              <strong>{trainingResult.splitCounts?.train || 0}</strong>
            </div>
            <div className="metric">
              <small>验证标的</small>
              <strong>{trainingResult.splitCounts?.validation || 0}</strong>
            </div>
            <div className="metric">
              <small>失败标的</small>
              <strong>{trainingResult.counts.failedStocks}</strong>
            </div>
          </div>

          {trainingResult.savedModelPath && (
            <div className="model-path">
              <small>参数保存位置</small>
              <strong>{trainingResult.savedModelPath}</strong>
            </div>
          )}

          <TimeSplitProgress progress={timeSplitProgress} />

          <SelectorExperiments experiments={selectorExperiments} onRun={runSelectorExperiment} running={selectorLoading} />

          <section className="table-section">
            <div className="section-head">
              <h3>统一模型验证</h3>
            </div>
            <div className="table-wrap">
              <table className="training-table model-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>模式</th>
                    <th>q_head</th>
                    <th>q_tail</th>
                    <th>混合系数</th>
                    <th>训练数</th>
                    <th>验证数</th>
                    <th>验证得分</th>
                    <th>综合改善率</th>
                    <th>收益改善率</th>
                    <th>夏普改善率</th>
                    <th>回撤改善率</th>
                    <th>三项同时改善</th>
                    <th>平均收益提升</th>
                    <th>平均夏普提升</th>
                    <th>平均回撤改善</th>
                  </tr>
                </thead>
                <tbody>
                  <EvidenceRow
                    label="全市场统一参数"
                    params={trainingResult.modelSummary?.globalModel?.params}
                    trainEvidence={trainingResult.modelSummary?.globalModel?.trainEvidence}
                    validationEvidence={trainingResult.modelSummary?.globalModel?.validationEvidence}
                  />
                  {trainingResult.modelSummary?.marketModels?.map((item) => (
                    <EvidenceRow
                      key={item.market}
                      label={`${item.market}市场参数`}
                      params={item.params}
                      trainEvidence={item.trainEvidence}
                      validationEvidence={item.validationEvidence}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="table-section">
            <div className="section-head">
              <h3>分市场股票内最优参数</h3>
            </div>
            <div className="table-wrap">
              <table className="training-table">
                <thead>
                  <tr>
                    <th>市场</th>
                    <th>股票数</th>
                    <th>模式</th>
                    <th>q_head</th>
                    <th>q_tail</th>
                    <th>混合系数</th>
                    <th>平均得分</th>
                    <th>收益提升</th>
                    <th>年化提升</th>
                    <th>夏普提升</th>
                    <th>回撤改善</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingResult.marketSummary.map((item) => (
                    <tr key={item.market}>
                      <td>{item.market}</td>
                      <td>{item.stocks}</td>
                      <td>{item.bestParams.mode || "-"}</td>
                      <td>{number(item.bestParams.qHead)}</td>
                      <td>{number(item.bestParams.qTail)}</td>
                      <td>{number(item.bestParams.eta)}</td>
                      <td>{number(item.avgScore)}</td>
                      <td className={item.avgImprovement.totalReturn >= 0 ? "up" : "down"}>{percent(item.avgImprovement.totalReturn)}</td>
                      <td className={item.avgImprovement.annualReturn >= 0 ? "up" : "down"}>{percent(item.avgImprovement.annualReturn)}</td>
                      <td className={item.avgImprovement.sharpe >= 0 ? "up" : "down"}>{number(item.avgImprovement.sharpe)}</td>
                      <td className={item.avgImprovement.maxDrawdown >= 0 ? "up" : "down"}>{percent(item.avgImprovement.maxDrawdown)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="table-section">
            <div className="section-head">
              <h3>每只股票最优参数</h3>
            </div>
            <div className="table-wrap stock-training-wrap">
              <table className="training-table">
                <thead>
                  <tr>
                    <th>市场</th>
                    <th>名称</th>
                    <th>代码</th>
                    <th>集合</th>
                    <th>模式</th>
                    <th>q_head</th>
                    <th>q_tail</th>
                    <th>混合系数</th>
                    <th>得分</th>
                    <th>累计收益</th>
                    <th>年化收益</th>
                    <th>夏普</th>
                    <th>最大回撤</th>
                    <th>收益提升</th>
                    <th>夏普提升</th>
                    <th>回撤改善</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingResult.stockResults.map((item) => (
                    <tr key={`${item.market}-${item.symbol}`}>
                      <td>{item.market}</td>
                      <td>{item.name}</td>
                      <td>{item.symbol}</td>
                      <td>{item.split === "validation" ? "验证" : "训练"}</td>
                      <td>{item.best.mode || "-"}</td>
                      <td>{number(item.best.qHead)}</td>
                      <td>{number(item.best.qTail)}</td>
                      <td>{number(item.best.eta)}</td>
                      <td>{number(item.best.score)}</td>
                      <td className={item.best.metrics.totalReturn >= 0 ? "up" : "down"}>{percent(item.best.metrics.totalReturn)}</td>
                      <td className={item.best.metrics.annualReturn >= 0 ? "up" : "down"}>{percent(item.best.metrics.annualReturn)}</td>
                      <td>{number(item.best.metrics.sharpe)}</td>
                      <td className="down">{percent(item.best.metrics.maxDrawdown)}</td>
                      <td className={item.best.improvement.totalReturn >= 0 ? "up" : "down"}>{percent(item.best.improvement.totalReturn)}</td>
                      <td className={item.best.improvement.sharpe >= 0 ? "up" : "down"}>{number(item.best.improvement.sharpe)}</td>
                      <td className={item.best.improvement.maxDrawdown >= 0 ? "up" : "down"}>{percent(item.best.improvement.maxDrawdown)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {trainingResult.failures.length > 0 && (
            <section className="table-section">
              <div className="section-head">
                <h3>训练失败标的</h3>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>市场</th>
                      <th>名称</th>
                      <th>代码</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainingResult.failures.map((item) => (
                      <tr key={`${item.market}-${item.symbol}`}>
                        <td>{item.market}</td>
                        <td>{item.name}</td>
                        <td>{item.symbol}</td>
                        <td>{item.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function AlgorithmPage() {
  const proofPoints = [
    ["论文基础", "Random Circuit Sampling 的输出概率在混沌极限下服从 Porter-Thomas 分布，一种天然重尾、非均匀、可解析的量子随机先验。"],
    ["代码落地", "stock1.py 不重写用户策略，而是并行运行经典路径与 PT 路径，把同一套买卖逻辑放到更懂尾部风险的价格路径上重放。"],
    ["投资价值", "对客户来说，它像一个策略增强层：保留原策略的可解释性，同时把注意力重新分配给少见但决定收益和回撤的市场状态。"]
  ];

  const steps = [
    ["1", "读取真实行情", "保留原始 OHLCV、收益率、20 日波动率，形成不被模型篡改的历史市场底座。"],
    ["2", "识别长尾状态", "按收益绝对值分桶为 H/M/L，把平常日、过渡日、极端日区分开。"],
    ["3", "注入 PT 先验", "用 Porter-Thomas 重尾随机性与 OT 映射改造中尾和尾部收益，不碰用户策略本身。"],
    ["4", "重放原策略", "5-20 均线只是示例，任何已有策略都可以作为黑盒接入，得到经典版与 PT 增强版对照。"]
  ];

  const metrics = [
    ["MT10 尾部成功率", "52.9% -> 56.5%", "论文实验：PT-rank 提升尾部任务表现，同时保持头部成功率。"],
    ["硬件退化", "仅 3.2%", "真实 Quafu/Baihua RCS 数据相对理想 PT 只出现小幅性能退化。"],
    ["推荐混合区间", "0.3 - 0.7", "论文敏感性分析显示，该区间更容易兼顾头部保持与尾部改善。"],
    ["单股示例", "不改策略", "回测页展示同一均线策略在经典路径与量子路径上的并行结果。"]
  ];

  return (
    <section className="content algorithm-page">
      <header className="algorithm-hero">
        <div className="algorithm-copy">
          <p className="eyebrow">Quantum Distributional Prior</p>
          <h2>把量子重尾先验变成策略收益增强层</h2>
          <p>
            我们的方法不是发明一个新的买卖策略，而是在不改变客户现有策略、算法或交易规则的情况下，
            用量子随机线路采样背后的 Porter-Thomas 分布，为策略增加一层面向极端行情的分布工程。
          </p>
          <div className="algorithm-cta-row">
            <span><ShieldCheck size={16} /> 原策略可保留</span>
            <span><TrendingUp size={16} /> 收益和夏普可比较</span>
            <span><Layers3 size={16} /> 可作为外接增强模块</span>
          </div>
        </div>
        <div className="quantum-diagram" aria-label="量子算法流程图">
          <div className="diagram-node source">
            <Atom size={26} />
            <strong>RCS</strong>
            <small>量子随机线路</small>
          </div>
          <div className="diagram-rail" />
          <div className="diagram-node prior">
            <Sparkles size={26} />
            <strong>PT Prior</strong>
            <small>重尾分布先验</small>
          </div>
          <div className="diagram-rail" />
          <div className="diagram-node strategy">
            <CandlestickChart size={26} />
            <strong>Strategy Replay</strong>
            <small>原策略重放</small>
          </div>
        </div>
      </header>

      <section className="algorithm-strip">
        {proofPoints.map(([title, body]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="algorithm-section">
        <div className="section-head">
          <h3>一句话讲清楚</h3>
        </div>
        <div className="plain-language">
          <strong>传统策略像司机，PT 算法像一套重尾路况模拟器。</strong>
          <p>
            司机的驾驶习惯不变，但我们让它在更多“平时很少见、真正出事时很关键”的路况中重新演练。
            到金融市场里，就是让原策略在真实历史价格之外，再经过一条由量子重尾先验塑形的路径，
            从而检验并强化它在尾部行情中的买卖时机、收益曲线和回撤表现。
          </p>
        </div>
      </section>

      <section className="algorithm-section">
        <div className="section-head">
          <h3>从论文到 stock1.py 的落地路径</h3>
        </div>
        <div className="method-timeline">
          {steps.map(([index, title, body]) => (
            <article key={title}>
              <span>{index}</span>
              <div>
                <h4>{title}</h4>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="algorithm-section">
        <div className="section-head">
          <h3>为什么它适合做成产品</h3>
        </div>
        <div className="product-grid">
          <article>
            <h4>非侵入式</h4>
            <p>客户不用交出策略源码，也不需要推翻原交易系统。我们只需要行情、信号接口或回测输出，就能做并行增强评估。</p>
          </article>
          <article>
            <h4>可解释</h4>
            <p>经典路径和 PT 路径同时展示，买入价、卖出价、收益率、夏普、最大回撤都能逐笔对照。</p>
          </article>
          <article>
            <h4>面向尾部</h4>
            <p>市场收益往往由少数极端区间决定。PT 分布天然给稀有事件更多概率质量，适合做黑天鹅压力增强。</p>
          </article>
          <article>
            <h4>可扩展</h4>
            <p>5-20 均线只是演示层。CTA、机器学习择时、组合调仓、风控止损，都可以接到同一套 PT 增强框架。</p>
          </article>
        </div>
      </section>

      <section className="algorithm-section">
        <div className="section-head">
          <h3>投资人应该记住的证据</h3>
        </div>
        <div className="evidence-grid">
          {metrics.map(([label, value, note]) => (
            <article key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
              <p>{note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="algorithm-section investor-close">
        <div>
          <p className="eyebrow">Commercial Positioning</p>
          <h3>我们卖的不是“又一个策略”，而是策略的量子增强底座。</h3>
        </div>
        <p>
          现有量化机构最难接受的是替换已有系统。我们的切入点正相反：让客户继续使用自己的策略，
          我们提供一层可插拔、可回测、可对照的 PT 重尾增强层。它的价值在于提高尾部行情下的暴露质量，
          让原本已经可用的策略，在不改变交易思想的前提下，获得更高的收益弹性和更好的风险画像。
        </p>
      </section>
    </section>
  );
}

function PTReportSummaryCard({ result }) {
  const [summary, setSummary] = useState(null);
  const [remaining, setRemaining] = useState(() => ptReportRemaining());
  const reportKey = result?.stock?.symbol || result?.stock?.yahooSymbol || "";

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
    <section className="table-section pt-report-card">
      <div className="section-head">
        <div>
          <h3>PT 深度风险诊断</h3>
          <p className="section-subtitle">每天免费生成 3 次摘要；完整参数、VaR/CVaR、极端情景和下载报告进入 Pro。</p>
        </div>
        <div className="pt-report-actions">
          <span>今日剩余 {remaining}/{PT_REPORT_DAILY_LIMIT}</span>
          <button className="small-run-button" type="button" onClick={generateSummary}>
            <Sparkles size={15} />
            生成免费摘要
          </button>
          <a className="small-run-button paid-link" href={MODEL_API_PATH}>
            查看详细报告
          </a>
        </div>
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
          <span>免费层只展示摘要结论，不提供荐股、择时、目标价或收益承诺。</span>
        </div>
      )}
    </section>
  );
}

function StrategyWorkbench() {
  const [page, setPage] = useState("backtest");
  const [markets, setMarkets] = useState([]);
  const [activeMarket, setActiveMarket] = useState(null);
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/markets")
      .then((response) => response.json())
      .then((data) => {
        setMarkets(data.markets);
        const firstMarket = data.markets[0];
        setSelected(firstMarket?.stocks[0] || null);
      })
      .catch((err) => setError(err.message));
  }, []);

  const runBacktest = async () => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selected.symbol, name: selected.name, start: range.start, end: range.end })
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402 && data.upgradeUrl) {
          window.location.href = new URL(data.upgradeUrl, window.location.origin).toString();
          return;
        }
        throw new Error(data.error || "回测失败");
      }
      setResult(data.result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <BarChart3 size={22} />
          <div>
            <h1>市场数据</h1>
          </div>
        </div>

        <nav className="mode-switch">
          <button className={page === "backtest" ? "mode-button active" : "mode-button"} type="button" onClick={() => setPage("backtest")}>
            <CandlestickChart size={18} />
            单股回测
          </button>
          <button className={page === "training" ? "mode-button active" : "mode-button"} type="button" onClick={() => setPage("training")}>
            <BrainCircuit size={18} />
            模型训练
          </button>
          <button className={page === "model" ? "mode-button active" : "mode-button"} type="button" onClick={() => setPage("model")}>
            <Sparkles size={18} />
            模型总览
          </button>
          <button className={page === "algorithm" ? "mode-button active" : "mode-button"} type="button" onClick={() => setPage("algorithm")}>
            <Atom size={18} />
            算法介绍
          </button>
        </nav>

        {page === "backtest" && (
          <>
            <nav className="market-list">
              {markets.map((market) => (
                <button key={market.id} className="market-button" type="button" onClick={() => setActiveMarket(market)}>
                  <span>
                    <strong>{market.name}</strong>
                    <small>{market.region}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </nav>

            <section className="run-panel">
              <p className="eyebrow">Selected</p>
              <h2>{selected?.name || "-"}</h2>
              <code>{selected?.symbol || "-"}</code>
              <div className="date-grid">
                <label>
                  <span>开始</span>
                  <input value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />
                </label>
                <label>
                  <span>结束</span>
                  <input value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} />
                </label>
              </div>
              <button className="run-button" type="button" disabled={!selected || loading} onClick={runBacktest}>
                <Play size={18} fill="currentColor" />
                {loading ? "运行中" : "运行"}
              </button>
            </section>
          </>
        )}

        {page === "training" && (
          <section className="run-panel">
            <p className="eyebrow">Training</p>
            <h2>参数训练</h2>
            <code>4 个市场 x 50 标的</code>
            <div className="date-grid">
              <label>
                <span>开始</span>
                <input value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />
              </label>
              <label>
                <span>结束</span>
                <input value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} />
              </label>
            </div>
          </section>
        )}

        {page === "model" && (
          <section className="run-panel">
            <p className="eyebrow">Model Overview</p>
            <h2>合成数据模型</h2>
            <code>4 个市场验证通过</code>
          </section>
        )}

        {page === "algorithm" && (
          <section className="run-panel">
            <p className="eyebrow">Algorithm</p>
            <h2>PT 重尾增强</h2>
            <code>不改变原策略</code>
          </section>
        )}

        <div className="disclaimer" style={{ marginTop: "24px", padding: "16px", backgroundColor: "#f8fafc", borderRadius: "8px", fontSize: "12px", color: "#64748b", lineHeight: "1.6" }}>
          <strong style={{ color: "#475569", display: "block", marginBottom: "8px" }}>重要声明：</strong>
          <ul style={{ margin: 0, paddingLeft: "16px" }}>
            <li>量子算法是研究工具，不是自动荐股工具</li>
            <li>不预测价格，不承诺收益，不保证风险控制</li>
            <li>所有回测结果仅供参考，不代表未来表现</li>
            <li>回测使用真实数据和量子算法计算的历史数据</li>
            <li>实盘前请自行验证策略并评估风险</li>
          </ul>
          <div style={{ marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
            联系方式：e-mail：<a href="mailto:wavefunction61@gmail.com" style={{ color: "#2563eb", textDecoration: "none" }}>wavefunction61@gmail.com</a>
          </div>
        </div>
      </aside>

      {page === "training" ? (
        <TrainingPage range={range} setRange={setRange} />
      ) : page === "model" ? (
        <ModelOverview />
      ) : page === "algorithm" ? (
        <AlgorithmPage />
      ) : (
        <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Backtest Workspace</p>
            <h2>{result ? `${result.stock.name} (${result.stock.yahooSymbol || result.stock.symbol})` : "等待运行回测"}</h2>
          </div>
          {result && (
            <div className="range-chip">
              {result.dateRange.start} 至 {result.dateRange.end}
              <span>{result.dateRange.rows} 行</span>
            </div>
          )}
        </header>

        {error && <div className="error-banner">{error}</div>}

        {!result && !loading && (
          <section className="empty-state">
            <CandlestickChart size={44} />
            <h2>选择市场和股票后运行回测</h2>
          </section>
        )}

        {loading && (
          <section className="loading-state">
            <div className="loader" />
            <h2>正在计算……</h2>
          </section>
        )}

        {result && (
          <>
            <div className="metric-layout">
              <Metrics title="5-20均线回测" metrics={result.metrics.uniform} accent="#2563eb" />
              <Metrics title="量子5-20均线回测" metrics={result.metrics.pt} accent="#e11d48" />
            </div>

            <PTReportSummaryCard result={result} />

            <section className="chart-section">
              <div className="section-head">
                <h3>真实历史 K 线与5-20均线买卖点</h3>
              </div>
              <KlinePanel dates={result.series.dates} data={result.series.uniform} />
            </section>

            <section className="chart-section">
              <div className="section-head">
                <h3>真实历史 K 线量子5-20均线与买卖点</h3>
              </div>
              <KlinePanel dates={result.series.dates} data={result.series.pt} />
            </section>

            <section className="chart-section">
              <div className="section-head">
                <h3>量子5-20均线算法与5-20均线收益率曲线</h3>
              </div>
              <ReturnPanel result={result} />
            </section>

            <section className="table-section">
              <div className="section-head">
                <h3>真实每次交易细节</h3>
              </div>
              <TradesTable trades={result.trades.uniform} />
            </section>

            <section className="table-section">
              <div className="section-head">
                <h3>量子算法每次交易细节</h3>
              </div>
            <TradesTable trades={result.trades.pt} />
          </section>
        </>
        )}
      </section>
      )}

      {activeMarket && (
        <StockModal
          market={activeMarket}
          onClose={() => setActiveMarket(null)}
          onSelect={(stock) => {
            setSelected(stock);
            setActiveMarket(null);
          }}
        />
      )}
    </main>
  );
}

function Root() {
  const pageName = window.location.pathname.split("/").pop() || "index.html";
  if (window.location.pathname.startsWith("/model-api")) return <ModelApiPage />;
  if (pageName === "global_financial_map.html") return <GlobalMarketGraph />;
  if (pageName === "financial_intelligence_lab.html") return <FinancialIntelligenceLab />;
  if (pageName === "agent_finance_evolution.html") return <AgentEvolution />;
  if (pageName === "model.html") return <ModelOverview />;
  if (pageName === "strategy.html") return <StrategyWorkbench />;
  return <PortalHome />;
}

createRoot(document.getElementById("root")).render(<Root />);
