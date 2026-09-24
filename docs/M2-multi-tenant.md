# M2: Multi-Tenant（多租户系统）

> **状态**：✅ 已完成（KV 后端 + 自助注册）
> **最后更新**：2026-09-24
> **说明**：本文件旧版描述的是「静态 `tenants.json`」模型，已被实际实现取代。`apps/web/tenants.json` 已删除。

**目标**：一次部署服务多个社区，每个社区通过自己的子域名访问，看到独立的品牌和 Space。

---

## 架构（实际实现）

```
请求到达 Cloudflare Pages 边缘节点
       ↓
functions/_middleware.ts
  ├── /api/graphql      → 代理到 SNAPSHOT_HUB 的 GraphQL（国内连通性优化）
  ├── /api/*            → 交给对应的 Pages Function
  └── 其它（HTML）      → 用 hostname 查 KV（TENANTS_KV）取租户配置
       ↓
向 HTML </head> 注入 <script>window.__TENANT__={...}</script>
       ↓
Vue SPA 启动 → src/tenant.ts 读取 window.__TENANT__
       ↓
与默认 branding.ts 合并（租户字段覆盖默认值）→ resolvedBranding
       ↓
main.ts 应用品牌 CSS 变量；router.ts 在 spaceId 存在时把 /、/explore 重定向到单空间
```

> 本地开发若无 KV 绑定，`_middleware.ts` 会优雅跳过注入，应用回退到 `branding.ts` 默认值。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| `apps/web/src/branding.ts` | 默认品牌配置（M1 已实现） |
| `apps/web/src/tenant.ts` | 读取 `window.__TENANT__`，合并为 `resolvedBranding` |
| `apps/web/src/router.ts` | 6 条路由；`tenant.spaceId` 存在时单空间重定向（SSO 回调除外） |
| `apps/web/functions/_middleware.ts` | 边缘：tenant 注入 + `/api/graphql` 代理 |
| `apps/web/functions/api/register.ts` | `POST /api/register` 自助注册（写 KV + 注册 CF Pages 域名） |
| `apps/web/functions/api/check.ts` | `GET /api/check?name=` 名称可用性 |
| `apps/web/functions/api/status.ts` | `GET /api/status?name=` 注册状态查询 |
| `apps/web/src/pages/RegisterPage.vue` | 自助注册 UI（防抖可用性检查） |
| `apps/web/wrangler.toml` | KV 绑定 + `CF_ROOT_DOMAIN` / `SNAPSHOT_HUB` 变量 |

> `apps/web/tenants.json` **已删除**——实际实现从 KV 读取，`functions/` 中没有任何代码读它。

---

## 租户配置格式（KV value）

KV key = 完整 hostname，value = JSON：

```json
{
  "spaceId": "aastar.eth",
  "name": "AAStar Governance",
  "description": "Vote on AAStar community proposals",
  "logo": "https://cdn.aastar.io/logo.svg",
  "colors": {
    "primary": "#ff6b35",
    "primaryHover": "#e55a2b",
    "selectedBg": "rgba(255, 107, 53, 0.08)"
  },
  "createdAt": "2026-07-14T15:55:00.000Z"
}
```

- 当 `spaceId` 存在时，`/` 与 `/explore` 自动重定向到该 Space，应用变为单 Space 模式。
- `colors` 为**部分覆盖**：只替换列出的键。

---

## 自助注册流程

1. 用户在 `/register` 输入名称与 `spaceId`。
2. `GET /api/check?name=` 做防抖可用性检查（读 KV）。
3. `POST /api/register`：
   - 校验名称（`/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/`）与 `spaceId` 非空；
   - 读 KV 判重（`existing !== null` → 409）；
   - 写入 KV；
   - 调 CF API 把 `<name>.<CF_ROOT_DOMAIN>` 加入 Pages 项目自定义域名（触发 SSL 签发）。
4. 子域名解析由**通配符 DNS**（`*.<CF_ROOT_DOMAIN>` → CF Pages）承担，无需逐租户建 DNS 记录。

> ⚠️ **已知安全缺口（见 `Plan.md` M6）**：`POST /api/register` 目前**无鉴权、无限流**、无 Snapshot 空间所有权校验，且判重/写入之间存在 TOCTOU 竞态；CF 域名注册失败会被吞掉（只记日志）。上线前需加固。

---

## Cloudflare Pages 部署

### 1. 前置

```bash
# 构建
cd apps/web && pnpm run build

# 创建 KV namespace（把返回的 id 填进 wrangler.toml）
wrangler kv namespace create TENANTS_KV

# 写入密钥（不要放进 wrangler.toml）
wrangler pages secret put CF_API_TOKEN   --project-name myvote
wrangler pages secret put CF_ACCOUNT_ID  --project-name myvote
wrangler pages secret put CF_PAGES_PROJECT --project-name myvote
# CF_ZONE_ID 视需要
```

`wrangler.toml` 中已配置：

- `[[kv_namespaces]]` → `TENANTS_KV`
- `CF_ROOT_DOMAIN = "forest.mushroom.cv"`
- `SNAPSHOT_HUB = "https://testnet.hub.snapshot.org"`（**必须与前端 `VITE_SNAPSHOT_HUB` 一致**）

### 2. 本地开发

```bash
cd apps/web
pnpm run build
wrangler pages dev dist/          # 中间件与 /api/* 自动生效

# 模拟租户：/etc/hosts 加
#   127.0.0.1  bread.forest.mushroom.cv
# 访问 http://bread.forest.mushroom.cv:8788
```

### 3. 生产部署

1. CF Pages 导入仓库，Root Directory `apps/web`，Build `pnpm run build`，输出 `dist`。
2. 添加自定义域名（主域名 + 通配符 `*.<root>`）。
3. 配置 KV 与密钥（见上）。

---

## 租户配置存储演进

| 阶段 | 方案 | 状态 |
|------|------|------|
| M2 起步 | 静态 `tenants.json` 随代码部署 | ❌ 已废弃（文件已删除） |
| **M2 落地** | **Cloudflare KV + 自助注册** | ✅ 当前实现 |
| M3+ | D1 + 自助注册面板 + 审批流 | 🔲 计划 |

---

## 中国访问分析

### 标准 CF 方案（免费/Pro）

- 中国用户流量路由到香港/东京/新加坡节点，延迟增加 30-80ms
- 对治理工具（非实时流媒体）可接受
- `*.pages.dev` 域名历史上有被屏蔽记录 → **必须使用自定义域名**
- Snapshot Hub API 本身在海外，中国用户已习惯此延迟

### 风险缓解

1. **必须用自定义域名**，不用 `*.pages.dev`。
2. 在 `_middleware.ts` 中通过 `/api/graphql` 代理转发到 Snapshot Hub；前端设 `VITE_SNAPSHOT_GRAPHQL_ENDPOINT=/api/graphql`。
   - 代理只允许 `ALLOWED_HUBS` 白名单（testnet/mainnet hub），不接受任意 host。
3. CF 整体不可用时的备选：Vercel（香港节点更稳）或国内云（需 ICP 备案）。

### CF Enterprise + JD Cloud（可选）

- 真正的大陆 PoP 节点，需 ICP 备案 + 企业合同；成本高，适合正式产品。

---

## M2 任务清单（已完成）

- [x] 创建 `apps/web/src/tenant.ts`
- [x] 创建 `apps/web/functions/_middleware.ts`（tenant 注入 + `/api/graphql` 代理）
- [x] 改造 `apps/web/src/main.ts` 使用 `resolvedBranding`
- [x] 改造 `apps/web/src/router.ts` 添加 tenant 感知路由守卫
- [x] 添加 `wrangler.toml`
- [x] 自助注册 API（`register` / `check` / `status`）+ `RegisterPage.vue`
- [x] KV 租户存储（取代静态 `tenants.json`）
- [x] 删除废弃的 `apps/web/tenants.json`
- [ ] 安全加固（鉴权 / 限流 / 所有权校验 / TOCTOU）→ `Plan.md` M6
