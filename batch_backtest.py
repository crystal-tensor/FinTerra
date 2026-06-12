import numpy as np
import pandas as pd
import yfinance as yf
import time
from scipy.stats import expon, beta
import warnings
warnings.filterwarnings('ignore')

# ===================== 1. 核心工具函数 =====================
def generate_pt_sample(n: int) -> np.ndarray:
    return expon.rvs(size=n, random_state=42)

def pt_rank_weight(return_series: np.ndarray, vol_series: np.ndarray, eta: float = 0.5) -> np.ndarray:
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
    cdf_pt = expon.cdf(pt_y)
    xi = 0.85 * beta.ppf(cdf_pt, 2, 12) + 0.15 * beta.ppf(cdf_pt, 8, 2)
    new_ret = original_ret * (1 + xi * np.sign(original_ret))
    return new_ret

def split_long_tail_bucket(df: pd.DataFrame, q_head=0.8, q_tail=0.95) -> pd.DataFrame:
    ret_abs = df["daily_ret_abs"]
    h_thres = ret_abs.quantile(q_head)
    l_thres = ret_abs.quantile(q_tail)
    def label_bucket(x):
        if x <= h_thres: return "H"
        elif x <= l_thres: return "M"
        else: return "L"
    df["bucket"] = ret_abs.apply(label_bucket)
    return df

def get_stock_data(stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
    import requests
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })
    start = f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}"
    end = f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:]}"
    
    if stock_code.startswith('6'):
        yf_symbol = f"{stock_code}.SS"
    else:
        yf_symbol = f"{stock_code}.SZ"
        
    df = yf.download(yf_symbol, start=start, end=end, progress=False, session=session)
    if df.empty:
        return pd.DataFrame()
        
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
        
    if "Adj Close" in df.columns:
        df["close"] = df["Adj Close"]
    else:
        df["close"] = df["Close"]
        
    df.index.name = "date"
    df["daily_ret"] = df["close"].pct_change()
    df["daily_ret_abs"] = df["daily_ret"].abs()
    df["vol_20d"] = df["daily_ret"].rolling(window=20).std()
    df = df.dropna()
    return df

def calc_backtest_metrics(net_series: pd.Series, ret_series: pd.Series) -> dict:
    total_ret = net_series.iloc[-1] - 1
    rolling_max = net_series.cummax()
    drawdown = (net_series - rolling_max) / rolling_max
    max_dd = drawdown.min()
    daily_mean = ret_series.mean()
    daily_std = ret_series.std()
    sharpe = (daily_mean / daily_std) * np.sqrt(252) if daily_std > 0 else 0
    return {
        "累计收益率": total_ret,
        "最大回撤": max_dd,
        "夏普比率": sharpe
    }

# ===================== 2. 单只股票处理逻辑 =====================
def process_single_stock(stock_code, market_name, start_date="20220101", end_date="20260601"):
    try:
        df = get_stock_data(stock_code, start_date, end_date)
        if len(df) < 50:
            return None
        
        df = split_long_tail_bucket(df)
        ret_arr = df["daily_ret"].values
        vol_arr = df["vol_20d"].values
        n_data = len(ret_arr)
        
        pt_weights = pt_rank_weight(ret_arr, vol_arr, eta=0.5)
        df["pt_weight"] = pt_weights
        
        pt_y_all = generate_pt_sample(n_data)
        df["ret_perturbed"] = df["daily_ret"].copy()
        
        mask_ml = df["bucket"].isin(["M", "L"])
        df.loc[mask_ml, "ret_perturbed"] = pt_ot_perturb(
            df.loc[mask_ml, "daily_ret"].values, pt_y_all[mask_ml]
        )
        
        # 量子算法价格路径
        pt_factors = 1 + df["ret_perturbed"]
        pt_factors.iloc[0] = 1
        df["pt_close"] = float(df["close"].iloc[0]) * pt_factors.cumprod()
        
        df["ma5"] = df["close"].rolling(5).mean()
        df["ma20"] = df["close"].rolling(20).mean()
        df["signal"] = np.where(df["ma5"] > df["ma20"], 1, 0)
        df["signal_shift"] = df["signal"].shift(1).fillna(0)
        
        df["pt_ma5"] = df["pt_close"].rolling(5).mean()
        df["pt_ma20"] = df["pt_close"].rolling(20).mean()
        df["pt_signal"] = np.where(df["pt_ma5"] > df["pt_ma20"], 1, 0)
        df["pt_signal_shift"] = df["pt_signal"].shift(1).fillna(0)
        
        # 统一截断前面的 NaN
        df = df.dropna(subset=["ma20", "pt_ma20"])
        
        df["strategy_ret_origin"] = df["signal_shift"] * df["daily_ret"]
        # 根据用户要求：PT策略的信号在真实价格上的收益表现
        df["strategy_ret_pt"] = df["pt_signal_shift"] * df["daily_ret"]
        
        df["net_origin"] = (1 + df["strategy_ret_origin"]).cumprod()
        df["net_pt"] = (1 + df["strategy_ret_pt"]).cumprod()
        
        m_orig = calc_backtest_metrics(df["net_origin"], df["strategy_ret_origin"])
        m_pt = calc_backtest_metrics(df["net_pt"], df["strategy_ret_pt"])
        
        return {
            "市场": market_name,
            "代码": stock_code,
            "均匀_累计收益": m_orig["累计收益率"],
            "均匀_最大回撤": m_orig["最大回撤"],
            "均匀_夏普比率": m_orig["夏普比率"],
            "PT_累计收益": m_pt["累计收益率"],
            "PT_最大回撤": m_pt["最大回撤"],
            "PT_夏普比率": m_pt["夏普比率"]
        }
    except Exception as e:
        print(f"Error {stock_code}: {e}")
        return None

# ===================== 3. 批量执行 =====================
if __name__ == "__main__":
    markets = {
        "沪市主板": ['600519', '601398', '601288', '601988', '601857', '601088', '600036', '601628', '601006', '601328', '600028', '600900', '601166', '601998', '600030', '601318', '600104', '601688', '600000', '600048'],
        "深市":     ['300750', '000858', '002594', '000333', '300498', '002415', '000651', '000001', '000002', '002304', '002142', '000568', '000776', '002714', '000895', '002230', '000166', '000063', '001979', '002027'],
        "科创板":   ['688981', '688012', '688036', '688111', '688008', '688256', '688041', '688187', '688063', '688271', '688114', '688009', '688599', '688208', '688002', '688126', '688220', '688037', '688052', '688303']
    }
    
    results = []
    total = sum(len(v) for v in markets.values())
    count = 0
    print(f"开始批量回测，共计 {total} 只股票...")
    
    for market_name, stock_list in markets.items():
        for code in stock_list:
            count += 1
            print(f"[{count}/{total}] 正在计算 {market_name} - {code} ...", end="\r")
            res = process_single_stock(code, market_name)
            if res:
                results.append(res)
            time.sleep(0.1) # 避免请求过快被封
            
    print("\n计算完成！正在生成报告...")
    
    df_res = pd.DataFrame(results)
    df_res.to_csv("batch_backtest_results.csv", index=False, encoding="utf-8-sig")
    
    # 按市场统计平均表现
    summary = df_res.groupby("市场").mean(numeric_only=True).round(4)
    summary.to_csv("batch_backtest_summary.csv", encoding="utf-8-sig")
    
    print("\n========== 分市场平均表现汇总 ==========")
    print(summary.to_markdown())
    print("\n结果已保存至 batch_backtest_results.csv 和 batch_backtest_summary.csv")
