# ===================== 1. 导入依赖库 =====================
import argparse
import base64
import io
import json
import logging
import warnings
from datetime import datetime

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import beta, expon

# 忽略 matplotlib 的字体警告
warnings.filterlogging = logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", category=UserWarning, module="matplotlib")

# 设置中文字体（解决matplotlib中文乱码，优先 macOS 字体）
plt.rcParams["font.family"] = ["Arial Unicode MS", "PingFang SC", "Heiti SC", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False


# ===================== 2. 核心工具函数（论文PT框架实现） =====================
def generate_pt_sample(n: int) -> np.ndarray:
    """生成 Porter-Thomas 分布样本 (Exp(1) 标准指数分布)。"""
    return expon.rvs(size=n, random_state=42)


def pt_rank_weight(return_series: np.ndarray, vol_series: np.ndarray, eta: float = 0.5) -> np.ndarray:
    """PT-Rank 排序最优匹配权重。"""
    n = len(return_series)
    tau = np.abs(return_series) + vol_series
    pt_y = generate_pt_sample(n)
    pt_weight = pt_y / pt_y.sum()

    idx_tau_desc = np.argsort(-tau)
    idx_pt_desc = np.argsort(-pt_weight)

    matched_weight = np.zeros(n)
    matched_weight[idx_tau_desc] = pt_weight[idx_pt_desc]

    uniform_w = np.ones(n) / n
    final_weight = (1 - eta) * uniform_w + eta * matched_weight
    return final_weight


def pt_ot_perturb(original_ret: np.ndarray, pt_y: np.ndarray) -> np.ndarray:
    """PT + 最优传输OT 生成长尾行情扰动。"""
    cdf_pt = expon.cdf(pt_y)
    xi = 0.85 * beta.ppf(cdf_pt, 2, 12) + 0.15 * beta.ppf(cdf_pt, 8, 2)
    new_ret = original_ret * (1 + xi * np.sign(original_ret))
    return new_ret


def split_long_tail_bucket(df: pd.DataFrame, q_head=0.8, q_tail=0.95) -> pd.DataFrame:
    """数据头尾分桶：头部(常态)、中部、尾部(极端长尾)。"""
    ret_abs = df["daily_ret_abs"]
    h_thres = ret_abs.quantile(q_head)
    l_thres = ret_abs.quantile(q_tail)

    def label_bucket(x):
        if x <= h_thres:
            return "H"
        if x <= l_thres:
            return "M"
        return "L"

    df["bucket"] = ret_abs.apply(label_bucket)
    return df


# ===================== 3. 数据获取与预处理 =====================
def normalize_yahoo_symbol(stock_code: str) -> str:
    """把常见 A股/港股/美股/加密货币代码转换成 Yahoo Finance 代码。"""
    code = stock_code.strip().upper()
    if "." in code or "-" in code or code.endswith("=F") or code.endswith("=X"):
        return code
    if code.isdigit() and len(code) == 6:
        return f"{code}.SS" if code.startswith("6") else f"{code}.SZ"
    if code.isdigit() and len(code) <= 5:
        return f"{code.zfill(4)}.HK"
    return code


def get_stock_data(stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
    """通过 Yahoo Finance 获取日线数据。"""

    start = pd.to_datetime(start_date).strftime("%Y-%m-%d")
    # yfinance 的 end 为开区间，这里加 1 天以包含传入的结束日期
    end = (pd.to_datetime(end_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")

    ticker = normalize_yahoo_symbol(stock_code)
    df = yf.download(
        ticker,
        start=start,
        end=end,
        auto_adjust=True,
        progress=False,
        timeout=30,
    )
    if df.empty:
        raise RuntimeError(f"Yahoo Finance 未返回数据，请检查股票代码或日期区间: {ticker}")

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df = df.rename(
        columns={
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    required_columns = ["open", "high", "low", "close", "volume"]
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise RuntimeError(f"Yahoo Finance 数据缺少字段: {', '.join(missing_columns)}")

    df = df[required_columns].copy()
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"

    df["daily_ret"] = df["close"].pct_change()
    df["daily_ret_abs"] = df["daily_ret"].abs()
    df["vol_20d"] = df["daily_ret"].rolling(window=20).std()
    df = df.dropna()
    if len(df) < 40:
        raise RuntimeError("可用历史数据不足，无法计算 20 日波动率和均线策略。")
    return df


# ===================== 4. 回测核心逻辑 =====================
def calc_backtest_metrics(net_series: pd.Series, ret_series: pd.Series) -> dict:
    """计算回测核心指标：累计收益、年化收益、最大回撤、胜率、夏普比率。"""
    total_ret = net_series.iloc[-1] - 1
    days = len(net_series)
    annual_ret = (1 + total_ret) ** (252 / days) - 1

    rolling_max = net_series.cummax()
    drawdown = (net_series - rolling_max) / rolling_max
    max_dd = drawdown.min()

    win_rate = (ret_series > 0).sum() / len(ret_series)

    daily_mean = ret_series.mean()
    daily_std = ret_series.std()
    sharpe = (daily_mean / daily_std) * np.sqrt(252) if daily_std > 0 else 0

    return {
        "累计收益率": round(float(total_ret), 4),
        "年化收益率": round(float(annual_ret), 4),
        "最大回撤": round(float(max_dd), 4),
        "胜率": round(float(win_rate), 4),
        "夏普比率": round(float(sharpe), 4),
    }


def build_strategy(df: pd.DataFrame, prefix: str, open_col: str, high_col: str, low_col: str, close_col: str, ret_col: str, real_close_col: str, real_ret_col: str) -> dict:
    """基于指定价格路径独立生成均线信号、买卖点、收益曲线和交易明细。"""
    ma5_col = f"{prefix}_ma5"
    ma20_col = f"{prefix}_ma20"
    signal_col = f"{prefix}_signal"
    signal_shift_col = f"{prefix}_signal_shift"
    action_col = f"{prefix}_trade_action"
    strategy_ret_col = f"{prefix}_strategy_ret"
    net_col = f"{prefix}_net"

    df[ma5_col] = df[close_col].rolling(5).mean()
    df[ma20_col] = df[close_col].rolling(20).mean()
    df[signal_col] = np.where(df[ma5_col] > df[ma20_col], 1, 0)
    df[signal_shift_col] = df[signal_col].shift(1).fillna(0)
    df[action_col] = df[signal_col].diff()

    trades = []
    buy_price = 0
    real_buy_price = 0
    buy_date = None
    for date, row in df.iterrows():
        if row[action_col] == 1:
            buy_price = row[close_col]
            real_buy_price = row[real_close_col]
            buy_date = date
        elif row[action_col] == -1 and buy_price > 0:
            sell_price = row[close_col]
            real_sell_price = row[real_close_col]
            abs_ret = real_sell_price - real_buy_price
            trade_ret = abs_ret / real_buy_price

            trade_data = {
                "买入日期": buy_date.strftime("%Y-%m-%d"),
                "卖出日期": date.strftime("%Y-%m-%d"),
            }
            if prefix == "pt":
                trade_data["量子算法买入价"] = round(float(buy_price), 2)
                trade_data["量子算法卖出价"] = round(float(sell_price), 2)

            trade_data["买入价"] = round(float(real_buy_price), 2)
            trade_data["卖出价"] = round(float(real_sell_price), 2)
            trade_data["绝对收益"] = round(float(abs_ret), 2)
            trade_data["收益率"] = round(float(trade_ret), 6)

            trades.append(trade_data)
            buy_price = 0
            real_buy_price = 0

    df[strategy_ret_col] = df[signal_shift_col] * df[real_ret_col]
    df[net_col] = (1 + df[strategy_ret_col]).cumprod()

    buy_points = []
    sell_points = []
    for date, row in df.iterrows():
        point = {"date": date.strftime("%Y-%m-%d"), "price": round(float(row[close_col]), 4)}
        if row[action_col] == 1:
            buy_points.append(point)
        elif row[action_col] == -1:
            sell_points.append(point)

    return {
        "columns": {
            "open": open_col,
            "high": high_col,
            "low": low_col,
            "close": close_col,
            "ma5": ma5_col,
            "ma20": ma20_col,
            "net": net_col,
        },
        "metrics": calc_backtest_metrics(df[net_col], df[strategy_ret_col]),
        "trades": trades,
        "buyPoints": buy_points,
        "sellPoints": sell_points,
    }


def clean_numeric_list(series: pd.Series, digits: int = 4) -> list:
    """把 Pandas 数列转换成 JSON 友好的数字/空值列表。"""
    values = []
    for value in series:
        values.append(None if pd.isna(value) else round(float(value), digits))
    return values


def build_chart_series(chart_df: pd.DataFrame, strategy: dict) -> dict:
    cols = strategy["columns"]
    return {
        "kline": chart_df[[cols["open"], cols["close"], cols["low"], cols["high"]]].round(4).values.tolist(),
        "close": clean_numeric_list(chart_df[cols["close"]], 4),
        "ma5": clean_numeric_list(chart_df[cols["ma5"]], 4),
        "ma20": clean_numeric_list(chart_df[cols["ma20"]], 4),
        "buyPoints": strategy["buyPoints"],
        "sellPoints": strategy["sellPoints"],
    }


def run_backtest(stock_code: str, stock_name: str, start_date: str, end_date: str, eta_param: float = 0.5) -> dict:
    """运行单只股票的 PT 框架和均线策略回测。"""
    yahoo_symbol = normalize_yahoo_symbol(stock_code)
    df_raw = get_stock_data(stock_code, start_date, end_date)
    df_raw = split_long_tail_bucket(df_raw)

    ret_arr = df_raw["daily_ret"].values
    vol_arr = df_raw["vol_20d"].values
    n_data = len(ret_arr)

    pt_weights = pt_rank_weight(ret_arr, vol_arr, eta=eta_param)
    df_raw["pt_weight"] = pt_weights

    pt_y_all = generate_pt_sample(n_data)
    df_raw["ret_perturbed"] = df_raw["daily_ret"].copy()

    mask_ml = df_raw["bucket"].isin(["M", "L"])
    df_raw.loc[mask_ml, "ret_perturbed"] = pt_ot_perturb(
        df_raw.loc[mask_ml, "daily_ret"].values,
        pt_y_all[mask_ml],
    )

    # 真实使用原始价格路径；量子使用扰动收益率重建一条独立价格路径。
    pt_factors = 1 + df_raw["ret_perturbed"]
    pt_factors.iloc[0] = 1
    df_raw["pt_close"] = float(df_raw["close"].iloc[0]) * pt_factors.cumprod()
    pt_scale = df_raw["pt_close"] / df_raw["close"]
    df_raw["pt_open"] = df_raw["open"] * pt_scale
    df_raw["pt_high"] = df_raw["high"] * pt_scale
    df_raw["pt_low"] = df_raw["low"] * pt_scale
    df_raw["pt_high"] = np.maximum.reduce([df_raw["pt_high"], df_raw["pt_open"], df_raw["pt_close"]])
    df_raw["pt_low"] = np.minimum.reduce([df_raw["pt_low"], df_raw["pt_open"], df_raw["pt_close"]])

    uniform_strategy = build_strategy(df_raw, "uniform", "open", "high", "low", "close", "daily_ret", "close", "daily_ret")
    pt_strategy = build_strategy(df_raw, "pt", "pt_open", "pt_high", "pt_low", "pt_close", "ret_perturbed", "close", "daily_ret")

    chart_df = df_raw.reset_index()
    chart_df["date"] = chart_df["date"].dt.strftime("%Y-%m-%d")

    return {
        "stock": {
            "symbol": stock_code,
            "yahooSymbol": yahoo_symbol,
            "name": stock_name or yahoo_symbol,
        },
        "dateRange": {
            "start": str(chart_df["date"].iloc[0]),
            "end": str(chart_df["date"].iloc[-1]),
            "rows": int(len(chart_df)),
        },
        "bucketStats": {
            key: round(float(value) * 100, 2)
            for key, value in df_raw["bucket"].value_counts(normalize=True).sort_index().items()
        },
        "summary": {
            "eta": eta_param,
            "originMean": round(float(df_raw["daily_ret"].mean()), 6),
            "perturbedMean": round(float(df_raw["ret_perturbed"].mean()), 6),
        },
        "metrics": {
            "uniform": uniform_strategy["metrics"],
            "pt": pt_strategy["metrics"],
        },
        "series": {
            "dates": chart_df["date"].tolist(),
            "uniform": build_chart_series(chart_df, uniform_strategy),
            "pt": build_chart_series(chart_df, pt_strategy),
            "netUniform": clean_numeric_list(chart_df["uniform_net"], 6),
            "netPt": clean_numeric_list(chart_df["pt_net"], 6),
        },
        "trades": {
            "uniform": uniform_strategy["trades"],
            "pt": pt_strategy["trades"],
        },
        "tailSamples": chart_df[chart_df["bucket"] == "L"][["date", "close", "daily_ret", "vol_20d", "pt_weight"]]
        .head(10)
        .round(6)
        .to_dict(orient="records"),
    }


# ===================== 5. HTML 报告生成 =====================
def build_report_image(result: dict) -> str:
    dates = pd.to_datetime(result["series"]["dates"])
    close = result["series"]["uniform"]["close"]
    ma5 = result["series"]["uniform"]["ma5"]
    ma20 = result["series"]["uniform"]["ma20"]
    net_origin = result["series"]["netUniform"]
    net_pt = result["series"]["netPt"]
    buy_points = result["series"]["uniform"]["buyPoints"]
    sell_points = result["series"]["uniform"]["sellPoints"]
    metrics_origin = result["metrics"]["uniform"]
    metrics_pt = result["metrics"]["pt"]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 12), gridspec_kw={"height_ratios": [2, 1]})

    line1 = ax1.plot(dates, net_origin, label="传统真实 (净值)", color="#3498db", linewidth=2)
    line2 = ax1.plot(dates, net_pt, label="PT重尾长尾方案 (净值)", color="#e74c3c", linewidth=2)

    ax1_twin = ax1.twinx()
    ax1_twin.plot(dates, close, label="收盘价", color="#2c3e50", linewidth=1.5, alpha=0.5, linestyle="--")
    ax1_twin.plot(dates, ma5, label="5日均线", color="#f1c40f", linewidth=1, alpha=0.4, linestyle=":")
    ax1_twin.plot(dates, ma20, label="20日均线", color="#9b59b6", linewidth=1, alpha=0.4, linestyle=":")

    if buy_points:
        buy_dates = pd.to_datetime([p["date"] for p in buy_points])
        buy_prices = [p["price"] for p in buy_points]
        ax1_twin.scatter(buy_dates, buy_prices, marker="^", color="red", s=100, label="买入", zorder=5)
    if sell_points:
        sell_dates = pd.to_datetime([p["date"] for p in sell_points])
        sell_prices = [p["price"] for p in sell_points]
        ax1_twin.scatter(sell_dates, sell_prices, marker="v", color="green", s=100, label="卖出", zorder=5)

    bbox_props = dict(boxstyle="round,pad=0.3", fc="white", ec="gray", alpha=0.8)
    text_origin = (
        f"【传统真实】\n"
        f"累计收益: {metrics_origin['累计收益率']:.2%}\n"
        f"年化收益: {metrics_origin['年化收益率']:.2%}\n"
        f"最大回撤: {metrics_origin['最大回撤']:.2%}\n"
        f"夏普比率: {metrics_origin['夏普比率']:.2f}"
    )
    text_pt = (
        f"【PT重尾长尾方案】\n"
        f"累计收益: {metrics_pt['累计收益率']:.2%}\n"
        f"年化收益: {metrics_pt['年化收益率']:.2%}\n"
        f"最大回撤: {metrics_pt['最大回撤']:.2%}\n"
        f"夏普比率: {metrics_pt['夏普比率']:.2f}"
    )

    ax1.text(0.02, 0.95, text_origin, transform=ax1.transAxes, fontsize=10, verticalalignment="top", bbox=bbox_props)
    ax1.text(0.18, 0.95, text_pt, transform=ax1.transAxes, fontsize=10, verticalalignment="top", bbox=bbox_props)

    title = f"{result['stock']['name']} 净值曲线与股价走势 (PT重尾长尾回测)"
    ax1.set_title(title, fontsize=14)
    ax1.set_ylabel("策略净值", fontsize=12)
    ax1_twin.set_ylabel("股票价格", fontsize=12)

    scatter_handles, scatter_labels = ax1_twin.get_legend_handles_labels()
    all_lines = line1 + line2 + scatter_handles
    all_labels = [line.get_label() for line in line1 + line2] + scatter_labels
    ax1.legend(all_lines, all_labels, loc="upper right")
    ax1.grid(True, alpha=0.3)

    ax2.plot(dates, close, label="收盘价", color="#334155", linewidth=1.5)
    ax2.set_title("历史收盘价", fontsize=14)
    ax2.set_xlabel("日期")
    ax2.set_ylabel("价格")
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    buffer = io.BytesIO()
    plt.savefig(buffer, format="png", dpi=150)
    buffer.seek(0)
    image_base64 = base64.b64encode(buffer.read()).decode("utf-8")
    plt.close()
    return image_base64


def write_html_report(result: dict, html_file: str = "backtest_report.html") -> None:
    image_base64 = build_report_image(result)
    trades = result["trades"]["uniform"]

    if trades:
        df_trades_html = pd.DataFrame(trades)

        def color_ret(val):
            color = "#e74c3c" if val > 0 else "#2ecc71"
            return f'<span style="color: {color}; font-weight: bold;">{val:.2%}</span>'

        def color_abs(val):
            color = "#e74c3c" if val > 0 else "#2ecc71"
            return f'<span style="color: {color}; font-weight: bold;">{val:.2f}</span>'

        df_trades_html["收益率"] = df_trades_html["收益率"].apply(color_ret)
        df_trades_html["绝对收益"] = df_trades_html["绝对收益"].apply(color_abs)
        table_html = df_trades_html.to_html(index=False, escape=False, classes="trade-table", border=0)
    else:
        table_html = "<p>区间内无完整交易。</p>"

    stock = result["stock"]
    html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>回测报告 - {stock['name']}</title>
    <style>
        body {{ font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 20px; }}
        .container {{ max-width: 1200px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }}
        h1, h2 {{ text-align: center; color: #2c3e50; }}
        .chart-wrapper {{ text-align: center; margin: 30px 0; }}
        .chart-wrapper img {{ max-width: 100%; height: auto; border: 1px solid #eee; border-radius: 4px; }}
        .trade-table {{ width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }}
        .trade-table th, .trade-table td {{ padding: 12px 15px; text-align: center; border-bottom: 1px solid #eee; }}
        .trade-table th {{ background-color: #34495e; color: #fff; text-transform: uppercase; }}
        .trade-table tr:hover {{ background-color: #f8f9fa; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>量化策略回测报告 - {stock['name']} ({stock['yahooSymbol']})</h1>
        <div class="chart-wrapper">
            <img src="data:image/png;base64,{image_base64}" alt="回测图表">
        </div>
        <h2>历史交易明细</h2>
        {table_html}
    </div>
</body>
</html>
"""
    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html_content)


def print_console_report(result: dict) -> None:
    stock = result["stock"]
    date_range = result["dateRange"]
    print("=" * 60)
    print(f"【{stock['name']} {stock['yahooSymbol']}】原始数据行数: {date_range['rows']}")
    print(f"数据区间: {date_range['start']} ~ {date_range['end']}")

    print("\n【样本分桶统计】")
    print(pd.Series(result["bucketStats"]).to_string())

    print(f"\n【PT框架处理完成】混合系数 η = {result['summary']['eta']}")
    print(f"原始收益率均值: {result['summary']['originMean']:.6f}")
    print(f"扰动后收益率均值: {result['summary']['perturbedMean']:.6f}")

    for key, title in [("uniform", "真实"), ("pt", "量子")]:
        print("\n" + "=" * 60)
        print(f"【{title}每次交易买卖点及收益】")
        trades = result["trades"][key]
        if trades:
            df_trades_print = pd.DataFrame(trades)
            df_trades_print["收益率"] = df_trades_print["收益率"].apply(lambda x: f"{x:.2%}")
            print(df_trades_print.to_markdown())
        else:
            print("区间内无完整交易。")

    print("\n" + "=" * 60)
    print("【回测指标对比】")
    print(f"传统真实回测: {result['metrics']['uniform']}")
    print(f"PT重尾长尾方案回测: {result['metrics']['pt']}")

    print("\n" + "=" * 60)
    print("【前10条长尾极端行情样本】")
    print(pd.DataFrame(result["tailSamples"]).to_string(index=False))


def main():
    parser = argparse.ArgumentParser(description="PT 重尾长尾策略回测")
    parser.add_argument("--symbol", default="688027.SS", help="股票代码，支持 Yahoo Finance 代码，如 688027.SS、AAPL、0700.HK、BTC-USD")
    parser.add_argument("--name", default="国盾量子", help="股票显示名称")
    parser.add_argument("--start", default="20220101", help="开始日期，如 20220101")
    parser.add_argument("--end", default=datetime.now().strftime("%Y%m%d"), help="结束日期，如 20260601")
    parser.add_argument("--eta", type=float, default=0.5, help="PT 混合系数")
    parser.add_argument("--json-output", default="", help="把结构化回测结果写入指定 JSON 文件")
    parser.add_argument("--html-output", default="backtest_report.html", help="HTML 报告路径")
    parser.add_argument("--no-html", action="store_true", help="不生成 HTML 报告")
    args = parser.parse_args()

    result = run_backtest(args.symbol, args.name, args.start, args.end, args.eta)

    if args.json_output:
        with open(args.json_output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)

    print_console_report(result)

    if not args.no_html:
        write_html_report(result, args.html_output)
        print(f"\n============================================================")
        print(f"回测 HTML 报告已生成完毕！请在浏览器中打开查看：{args.html_output}")


if __name__ == "__main__":
    main()
