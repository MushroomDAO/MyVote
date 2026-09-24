# M1: Clone & Deploy

**目标**: 社区 clone 仓库 → 修改一个文件 → 部署 → 拥有自己的治理门户。

---

## 功能范围

| 功能 | 状态 |
|------|------|
| Explore 页面（浏览所有 Space） | ✅ 完成（含 Load More 分页） |
| Space 详情页（Space 信息 + 提案列表） | ✅ 完成（含 Load More 分页） |
| Proposal 详情页（提案详情 + 投票） | ✅ 完成 |
| 投票（EIP-712 签名 → Snapshot Hub） | ✅ 完成 |
| 投票结果展示（得票比例条形图） | ✅ 完成 |
| Proposal body Markdown 渲染 | ✅ 完成 |
| 多语言（zh-CN 默认 / English） | ✅ 完成 |
| 钱包连接（MetaMask 等注入钱包） | ✅ 完成 |
| 邮箱登录（临时 Web2 登录） | ✅ 完成 |
| AirAccount Web2 登录（cos72 SSO + KMS） | 🟡 管道已通；E-5 KMS 与 cos72 落地页未交付 |
| Snapshot X（链上，EVM/OP）可选后端 | ✅ 读 / 投 / 结果 / 投票预检已就绪 |
| 品牌配置（单文件定制） | ✅ 完成 |
| CSS 变量主题系统 | ✅ 完成 |
| 部署配置（Vercel/Netlify/CF Pages） | ✅ 完成 |

---

## 如何定制并部署

### Step 1: Clone 仓库

```bash
git clone https://github.com/your-org/MyVote.git my-dao-vote
cd my-dao-vote
```

### Step 2: 编辑品牌配置

打开 `apps/web/src/branding.ts`，修改以下字段：

```typescript
export const branding = {
  name: 'MyDAO Governance',          // 改成你的 DAO 名字
  description: 'Vote on MyDAO proposals',

  logo: '/logo.svg',                 // 把 logo 放在 apps/web/public/ 下

  colors: {
    primary: '#ff6b35',              // 改成你的品牌主色
    primaryHover: '#e55a2b',
    error: '#b00020',
    selectedBg: 'rgba(255, 107, 53, 0.08)',
  },

  links: {
    github: 'https://github.com/my-dao',
    discord: 'https://discord.gg/my-dao',
  }
}
```

### Step 3: 配置环境变量（可选）

复制 `.env.example` 为 `.env.local`，根据需要修改：

```bash
cp apps/web/.env.example apps/web/.env.local
```

默认连接 `hub.snapshot.org`，无需修改即可使用。

### Step 4: 本地开发验证

```bash
cd apps/web
pnpm install
pnpm run dev -- --host 0.0.0.0 --port 5173
```

访问 http://localhost:5173 确认品牌和功能正常。

### Step 5: 构建

```bash
cd apps/web
pnpm run build
# 产物在 apps/web/dist/
```

---

## 部署选项

### Vercel（推荐）

1. 导入 GitHub 仓库到 Vercel
2. 设置：
   - **Root Directory**: `apps/web`
   - **Framework**: Vite
   - **Build Command**: `pnpm run build`
   - **Output Directory**: `dist`
3. 在 Vercel 环境变量中设置 `VITE_*` 变量（如需）
4. 部署 → 自动处理 SPA 路由

### Netlify

1. 导入仓库，配置：
   - **Base directory**: `apps/web`
   - **Build command**: `pnpm run build`
   - **Publish directory**: `apps/web/dist`
2. SPA 路由回退由 `public/_redirects` 自动处理

### Cloudflare Pages

1. 导入仓库，配置：
   - **Root directory**: `apps/web`
   - **Build command**: `pnpm run build`
   - **Build output directory**: `dist`
2. SPA 路由回退由 `public/_redirects` 自动处理
3. **重要**：使用自定义域名，不要用 `*.pages.dev`（中国访问更稳定）

---

## 数据说明

本版本对接 **经典 Snapshot Hub**（hub.snapshot.org）：
- 数据与 snapshot.org 完全互通
- 在你的界面发布的投票，在 snapshot.org 也可见
- 免 Gas：投票仅需 EIP-712 签名，无需支付链上 Gas

### 可选的链上后端（Snapshot X）

`0x…` 形式的 space 会自动走 [Snapshot X](https://docs.snapshot.box/snapshot-x/overview)（EVM，含 **Optimism**）：
从 `api.snapshot.box` 读取，经 Mana 免 Gas 中继投票；ENS 空间仍走上面的链下 Hub。
二者**共存**、按 space 路由（见 `apps/web/src/lib/voteRouting.ts`）。

在 Explore 页可用「打开链上空间」按地址进入，或直接看「链上空间（Snapshot X）」列表
（例：Optimism 上的 Ryu0x167 Space Command `0x03C7431e14F7b759Aa44398AD7901e6053c197Bf`）。

---

## 已知限制

- AirAccount 真实登录仍阻塞于外部（E-5 KMS 签名端点、cos72 SSO 落地页）；当前提供**邮箱登录**作为临时替代
- Snapshot X 的**真实投票**尚待一个持有投票权的 space 做端到端验证（只读、结果、投票预检、payload 构造已在真实 Optimism space 上验证）
- 注册的身份校验目前是**可选**的空间所有权签名（不提供也可注册，记为 `unverified`）；验证码 / 强身份待接入邮箱服务
- 提案创建 UI 未实现（可通过 snapshot.org / snapshot.box 创建）
- Space 管理 UI 未实现
