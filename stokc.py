# ===================== 1. 导入依赖库 =====================
import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
from scipy.stats import expon, beta
from scipy import stats

# 设置中文字体（解决matplotlib中文乱码）
plt.rcParams["font.family"] = ["SimHei", "WenQuanYi Micro Hei", "Heiti TC"]
plt.rcParams["axes.unicode_minus"] = False

# ===================== 2. 核心工具函数（论文PT框架实现） =====================
def generate_pt_sample(n: int) -> np.ndarray:
    """
    生成 Porter-Thomas 分布样本 (Exp(1) 标准指数分布)
    对应论文 RCS 输出的 PT 统计特性
    """
    return expon.rvs(size=n, random_state=42)

def pt_rank_weight(return_series: np.ndarray, vol_series: np.ndarray, eta: float = 0.5) -> np.ndarray:
    """
    PT-Rank 排序最优匹配权重（论文 3.4 样本调度）
    :param return_series: 日收益率序列
    :param vol_series: 滚动波动率序列
    :param eta: 混合系数 0.3~0.7 最优，平衡头部/尾部
    :return: 每条数据最终采样权重
    """
    n = len(return_series)
    # 1. 计算样本优先级：收益率绝对值 + 波动率（极端行情优先级更高）
    tau = np.abs(return_series) + vol_series

    # 2. 生成PT样本并归一化为权重
    pt_y = generate_pt_sample(n)
    pt_weight = pt_y / pt_y.sum()

    # 3. 排序最优匹配（重排不等式：大权重分配给高优先级长尾样本）
    idx_tau_desc = np.argsort(-tau)    # 优先级从高到低索引
    idx_pt_desc = np.argsort(-pt_weight)  # PT权重从高到低索引

    matched_weight = np.zeros(n)
    matched_weight[idx_tau_desc] = pt_weight[idx_pt_desc]

    # 4. 混合均匀权重 + PT权重（避免完全抛弃常态行情）
    uniform_w = np.ones(n) / n
    final_weight = (1 - eta) * uniform_w + eta * matched_weight
    return final_weight

def pt_ot_perturb(original_ret: np.ndarray, pt_y: np.ndarray) -> np.ndarray:
    """
    PT + 最优传输OT 生成长尾行情扰动（论文 3.5 风险场景生成）
    目标分布：Beta混合分布 85%小幅波动 + 15%极端长尾波动
    """
    # PT分布累积概率
    cdf_pt = expon.cdf(pt_y)
    # 目标混合分布 G = 0.85*Beta(2,12) + 0.15*Beta(8,2)
    xi = 0.85 * beta.ppf(cdf_pt, 2, 12) + 0.15 * beta.ppf(cdf_pt, 8, 2)
    # 对原始收益率叠加扰动，保留涨跌方向
    new_ret = original_ret * (1 + xi * np.sign(original_ret))
    return new_ret

def split_long_tail_bucket(df: pd.DataFrame, q_head=0.8, q_tail=0.95) -> pd.DataFrame:
    """
    数据头尾分桶：头部(常态)、中部、尾部(极端长尾)
    :param q_head: 头部分位数 80%
    :param q_tail: 尾部分位数 95%
    :return: 新增 bucket 标签列 H/M/L
    """
    ret_abs = df["daily_ret_abs"]
    h_thres = ret_abs.quantile(q_head)
    l_thres = ret_abs.quantile(q_tail)

    def label_bucket(x):
        if x <= h_thres:
            return "H"  # 头部：常态行情
        elif x <= l_thres:
            return "M"  # 中部：小幅异动
        else:
            return "L"  # 尾部：极端长尾行情

    df["bucket"] = ret_abs.apply(label_bucket)
    return df

# ===================== 3. 数据获取与预处理（国盾量子 688027.SH） =====================
def get_stock_data(stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
    """获取A股日线前复权数据"""
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
        
    # 统一列名以匹配后续逻辑
    if "Adj Close" in df.columns:
        df["close"] = df["Adj Close"]
    else:
        df["close"] = df["Close"]
        
    df.index.name = "date"
    # 计算日收益率、收益率绝对值
    df["daily_ret"] = df["close"].pct_change()
    df["daily_ret_abs"] = df["daily_ret"].abs()
    # 计算20日滚动波动率（衡量行情波动强度）
    df["vol_20d"] = df["daily_ret"].rolling(window=20).std()
    # 剔除空值（前20行波动率为空）
    df = df.dropna()
    return df

# ------------ 执行数据拉取 ------------
STOCK_CODE = "688027"  # 国盾量子
START_DATE = "20220101"
END_DATE = "20260601"
df_raw = get_stock_data(STOCK_CODE, START_DATE, END_DATE)
print("="*60)
print(f"【国盾量子 {STOCK_CODE}】原始数据行数: {len(df_raw)}")
print(f"数据区间: {df_raw.index.min().date()} ~ {df_raw.index.max().date()}")

# 头尾分桶（标记长尾样本）
df_raw = split_long_tail_bucket(df_raw)
print("\n【样本分桶统计】")
print(df_raw["bucket"].value_counts(normalize=True).round(3) * 100)

# ===================== 4. 应用PT框架：权重 + 长尾扰动 =====================
# 提取序列
ret_arr = df_raw["daily_ret"].values
vol_arr = df_raw["vol_20d"].values
n_data = len(ret_arr)

# 1. 计算 PT-Rank 采样权重（仅用于后续训练损失加权，不直接乘收益）
eta_param = 0.5  # 混合系数，论文推荐 0.3~0.7
pt_weights = pt_rank_weight(ret_arr, vol_arr, eta=eta_param)
df_raw["pt_weight"] = pt_weights

# 2. 生成PT样本 + 长尾行情扰动（仅对中部、尾部样本叠加扰动）
pt_y_all = generate_pt_sample(n_data)
df_raw["ret_perturbed"] = df_raw["daily_ret"].copy()

# 只给 M / L 样本加扰动（保护头部常态行情）
mask_ml = df_raw["bucket"].isin(["M", "L"])
df_raw.loc[mask_ml, "ret_perturbed"] = pt_ot_perturb(
    df_raw.loc[mask_ml, "daily_ret"].values,
    pt_y_all[mask_ml]
)

print(f"\n【PT框架处理完成】混合系数 η = {eta_param}")
print(f"原始收益率均值: {df_raw['daily_ret'].mean():.6f}")
print(f"扰动后收益率均值: {df_raw['ret_perturbed'].mean():.6f}")

# ===================== 5. 简单趋势策略回测（适配PT长尾数据） =====================
# 策略逻辑：5日均线 > 20日均线 持有，否则空仓（经典均线策略）
df_raw["ma5"] = df_raw["close"].rolling(5).mean()
df_raw["ma20"] = df_raw["close"].rolling(20).mean()

# 生成交易信号 1=持仓 0=空仓
df_raw["signal"] = np.where(df_raw["ma5"] > df_raw["ma20"], 1, 0)
# 信号滞后1天（规避未来函数）
df_raw["signal_shift"] = df_raw["signal"].shift(1).fillna(0)

# ------------- 两组回测对比 -------------
# 对比组1：原始行情 + 真实（传统回测）
df_raw["strategy_ret_origin"] = df_raw["signal_shift"] * df_raw["daily_ret"]
# 对比组2：PT扰动长尾行情（修复错误：不再乘以pt_weight）
df_raw["strategy_ret_pt"] = df_raw["signal_shift"] * df_raw["ret_perturbed"]

# 计算净值曲线
df_raw["net_origin"] = (1 + df_raw["strategy_ret_origin"]).cumprod()
df_raw["net_pt"] = (1 + df_raw["strategy_ret_pt"]).cumprod()

# ===================== 6. 回测指标计算 =====================
def calc_backtest_metrics(net_series: pd.Series, ret_series: pd.Series) -> dict:
    """计算回测核心指标：累计收益、年化收益、最大回撤、胜率"""
    total_ret = net_series.iloc[-1] - 1
    days = len(net_series)
    annual_ret = (1 + total_ret) ** (252 / days) - 1

    # 最大回撤
    rolling_max = net_series.cummax()
    drawdown = (net_series - rolling_max) / rolling_max
    max_dd = drawdown.min()

    # 胜率（正收益天数占比）
    win_rate = (ret_series > 0).sum() / len(ret_series)

    return {
        "累计收益率": round(total_ret, 4),
        "年化收益率": round(annual_ret, 4),
        "最大回撤": round(max_dd, 4),
        "胜率": round(win_rate, 4)
    }

metrics_origin = calc_backtest_metrics(df_raw["net_origin"], df_raw["strategy_ret_origin"])
metrics_pt = calc_backtest_metrics(df_raw["net_pt"], df_raw["strategy_ret_pt"])

print("\n" + "="*60)
print("【回测指标对比】")
print(f"传统真实回测: {metrics_origin}")
print(f"PT重尾长尾方案回测: {metrics_pt}")

# ===================== 7. 可视化结果 =====================
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10))

# 图1：净值曲线对比
ax1.plot(df_raw.index, df_raw["net_origin"], label="传统真实", color="#3498db", linewidth=2)
ax1.plot(df_raw.index, df_raw["net_pt"], label="PT重尾长尾方案", color="#e74c3c", linewidth=2)
ax1.set_title("国盾量子 净值曲线对比 (PT重尾长尾回测)", fontsize=14)
ax1.set_ylabel("净值", fontsize=12)
ax1.legend()
ax1.grid(True, alpha=0.3)

# 图2：头部/尾部样本收益率分布
h_ret = df_raw[df_raw["bucket"] == "H"]["daily_ret"]
l_ret = df_raw[df_raw["bucket"] == "L"]["daily_ret"]
ax2.hist(h_ret, bins=50, alpha=0.6, label="头部常态行情", color="#2ecc71")
ax2.hist(l_ret, bins=50, alpha=0.6, label="尾部极端行情", color="#f39c12")
ax2.set_title("收益率分布 (头部VS长尾)", fontsize=14)
ax2.set_xlabel("日收益率")
ax2.set_ylabel("频次")
ax2.legend()
ax2.grid(True, alpha=0.3)

plt.tight_layout()
plt.show()

# 输出尾部样本明细（查看长尾极端数据）
print("\n" + "="*60)
print("【前10条长尾极端行情样本】")
print(df_raw[df_raw["bucket"]=="L"][["close","daily_ret","vol_20d","pt_weight"]].head(10))