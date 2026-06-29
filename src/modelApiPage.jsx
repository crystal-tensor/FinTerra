import React from "react";
import { ArrowRight, BarChart3, CheckCircle2, Code2, Download, FileText, KeyRound, LockKeyhole, Mail, ServerCog, ShieldCheck, Sparkles } from "lucide-react";
import { SiteTopNav } from "./portalHome.jsx";

const plans = [
  {
    name: "Free",
    price: "免费",
    cadence: "公开研究层",
    desc: "适合先看基础行情、回测和少量 PT 摘要的个人用户。",
    features: [
      "全市场股票搜索与基础日线回测",
      "每天 3 次 PT 深度报告摘要",
      "摘要只展示尾部风险等级、重尾强度、策略稳健性评分",
      "可查看 MiroFish 金融资讯推演结果",
      "不提供详细参数、批量筛选、报告下载或投资建议"
    ]
  },
  {
    name: "Pro",
    price: "¥299",
    cadence: "/ 月起",
    desc: "适合个人量化研究者查看完整单股风险诊断。",
    featured: true,
    features: [
      "完整 PT 重尾风险诊断报告",
      "VaR / CVaR、极端回撤情景、重尾 regime 解释",
      "单股历史模型对比与报告导出",
      "MiroFish 推演报告下载",
      "仅作研究与风控分析，不提供荐股、择时或收益承诺"
    ]
  },
  {
    name: "Research / API",
    price: "定制",
    cadence: "机构与私有部署",
    desc: "适合量化团队、研究机构、数据团队和合规私有环境。",
    features: [
      "批量 PT 尾部风险扫描与 API 调用",
      "自有行情数据接入，避免转售原始行情授权问题",
      "私有化部署、白名单、调用审计和额度管理",
      "模型服务、应用服务可同机部署，也可未来拆到伦敦/新加坡",
      "合同明确用于研究、风控和模型评估"
    ]
  }
];

const useCases = [
  {
    icon: BarChart3,
    title: "基础行情免费开放",
    text: "用户可以搜索全部股票，查看日线、基础回测和量子5-20对照。普通看盘用户不被拦住，让传播和试用成本足够低。"
  },
  {
    icon: Sparkles,
    title: "深度报告付费解锁",
    text: "真正收费的是 PT 重尾模型解释：尾部风险、厚尾强度、极端情景、稳健性评分、历史 regime 与报告导出。"
  },
  {
    icon: ShieldCheck,
    title: "合规边界清晰",
    text: "页面不出现买入、卖出、目标价、机会榜等表达。所有输出定位为研究工具和风险诊断，不构成投资建议。"
  }
];

const endpoints = [
  ["POST", "/api/backtest", "基础单股回测，公开展示层可用"],
  ["GET", "/api/model-overview", "模型总览与全市场候选列表"],
  ["POST", "/api/pt-risk-report", "Pro/Research：完整 PT 风险报告"],
  ["POST", "/api/research/batch-scan", "Research/API：批量尾部风险扫描"]
];

function CodeBlock() {
  return (
    <pre className="api-code-block">
      <code>{`curl https://your-domain.com/api/pt-risk-report \\
  -H "Authorization: Bearer ft_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "market": "US",
    "symbol": "NVDA",
    "report": ["tail_risk", "cvar", "regime", "robustness"]
  }'`}</code>
    </pre>
  );
}

export function ModelApiPage() {
  return (
    <main className="site-shell api-page">
      <SiteTopNav />

      <section className="api-hero">
        <div className="api-hero-copy">
          <p className="site-kicker">PT Tail Risk Research</p>
          <h1>把普通回测看不见的尾部风险，变成可购买的研究报告和 API。</h1>
          <p>
            FinTerra 免费开放基础日线与回测。收费部分不是荐股，也不是预测价格，
            而是 PT 重尾分布模型生成的风险诊断、完整报告、批量研究 API 和私有部署。
          </p>
          <div className="api-hero-actions">
            <a className="site-primary" href="mailto:wavefunction61@gmail.com?subject=FinTerra%20Pro%20Access">
              申请 Pro / API
              <ArrowRight size={17} />
            </a>
            <a className="site-secondary" href="/model.html">
              先看模型总览
            </a>
          </div>
        </div>

        <aside className="api-status-panel" aria-label="商业化边界">
          <div className="terminal-head">
            <span />
            <span />
            <span />
            <strong>finterra-commercial-boundary</strong>
          </div>
          <div className="api-status-body">
            <div>
              <ServerCog size={18} />
              <span>Deploy</span>
              <strong>App + Model Together</strong>
            </div>
            <div>
              <FileText size={18} />
              <span>Free Quota</span>
              <strong>3 summaries / day</strong>
            </div>
            <div>
              <LockKeyhole size={18} />
              <span>Paid Unlock</span>
              <strong>Full Report + API</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="api-section">
        <div className="section-copy">
          <p className="site-kicker">Plans</p>
          <h2>Free、Pro、Research/API</h2>
          <p>
            免费层负责建立信任和传播；Pro 卖完整 PT 深度报告；Research/API 卖批量计算、私有部署和机构研究能力。
          </p>
        </div>
        <div className="api-pricing-grid api-pricing-grid-3">
          {plans.map((plan) => (
            <article className={plan.featured ? "api-price-card featured" : "api-price-card"} key={plan.name}>
              <div className="api-price-head">
                <h3>{plan.name}</h3>
                <div>
                  <strong>{plan.price}</strong>
                  <span>{plan.cadence}</span>
                </div>
              </div>
              <p>{plan.desc}</p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <CheckCircle2 size={15} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="api-section api-boundary-grid">
        {useCases.map(({ icon: Icon, title, text }) => (
          <article className="api-boundary-card" key={title}>
            <Icon size={22} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="api-section api-doc-layout">
        <div>
          <p className="site-kicker">Paid Details</p>
          <h2>为什么用户会付费</h2>
          <div className="api-step-list">
            <article>
              <FileText size={20} />
              <h3>1. 免费摘要只给结论层</h3>
              <p>尾部风险等级、重尾强度、策略稳健性评分足够让用户理解价值，但不会泄露完整模型细节。</p>
            </article>
            <article>
              <Download size={20} />
              <h3>2. 下载和完整解释进入 Pro</h3>
              <p>MiroFish 资讯推演可以在线查看；导出 PDF、复制完整证据链和下载研究包进入付费页。</p>
            </article>
            <article>
              <KeyRound size={20} />
              <h3>3. 批量和 API 面向机构</h3>
              <p>机构客户通常关心全市场扫描、审计、稳定接口和私有部署，按研究 API 或项目制报价。</p>
            </article>
          </div>
        </div>
        <CodeBlock />
      </section>

      <section className="api-section api-endpoints">
        <div>
          <p className="site-kicker">Interface</p>
          <h2>接口目录</h2>
          <p>公开接口只承载展示；付费接口需要 Key、额度和用途审核。</p>
        </div>
        <div className="api-endpoint-list">
          {endpoints.map(([method, path, desc]) => (
            <div className="api-endpoint-row" key={path}>
              <span>{method}</span>
              <code>{path}</code>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="api-cta">
        <div>
          <p className="site-kicker">Compliance First</p>
          <h2>我们卖研究工具，不卖荐股结论。</h2>
          <p>
            FinTerra 不提供买卖建议、目标价、收益承诺或自动交易指令。商业合作请说明使用场景、市场范围、数据来源和是否需要私有部署。
          </p>
        </div>
        <a className="site-primary" href="mailto:wavefunction61@gmail.com?subject=FinTerra%20Research%20API">
          <Mail size={17} />
          联系开通
        </a>
      </section>

      <footer className="site-footer">
        <span>For research, risk analysis and model evaluation only. Not investment advice.</span>
        <a href="mailto:wavefunction61@gmail.com">wavefunction61@gmail.com</a>
      </footer>
    </main>
  );
}
