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
| AirAccount Web2 登录 | 🔲 接口占位，实现在后续版本 |
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

后续 M3 将迁移到 **Snapshot X**（基于 Starknet 的链上投票）。

---

## 已知限制

- AirAccount (Web2 登录) 为接口占位，实现在后续版本
- 提案创建 UI 未实现（可通过 snapshot.org 官网创建）
- Space 管理 UI 未实现
