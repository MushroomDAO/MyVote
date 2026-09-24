# 架构评审记录（Architecture Review）

> 由 claude-planner 于仓库只读分析时产出。本文档仅记录事实，未做任何代码改动。

---

## 📌 2026-09 复核（自主迭代后）

下方为当时的**只读快照**，保留原样。其中多数条目已在此后的迭代中修复，现状如下——**请勿再按未修复状态跟进**：

| 原条目 | 现状 |
|---|---|
| `CLAUDE.md` 过时（测试运行器 / hub / 组件缺失） | ✅ 已重写（含 Functions、错误码、默认 testnet hub、环境变量表） |
| M2 文档清单未勾选、`tenants.json` 描述过时 | ✅ M2 文档按 KV + 自助注册重写；`apps/web/tenants.json` 已删除 |
| `POST /api/register` 无鉴权 / 限流 | 🟡 已加按 IP 限流（#11）与**空间所有权校验**（#20）；验证码/身份待邮箱服务（M6-3） |
| 注册 TOCTOU 竞态 | 🟡 写入 reservation 后读回确认（#11）；彻底修复需 Durable Objects（KV 无 CAS） |
| `_middleware` 注入 `__TENANT__` 未转义 `<` | ✅ `escapeForScript`（#11） |
| `register.ts` 吞掉 CF 域名注册失败 | ✅ 失败**回滚 KV 并返回 502**（#14），成功/未托管写入 `domainStatus` |
| 读取路径无取消 / 去重 | ✅ 过期响应令牌守卫（#6）；`AbortController` 仍为可选未做 |
| 投票后不失效缓存 | ✅ Explore 缓存按 host 隔离（#7）；投票数据不在该缓存中，暂无需失效 |
| 读取路径零测试 | ✅ `lib/graphql.ts`、`lib/sx/*`、页面竞态与协议分流均有测试；Functions 三路由均有端点测试（#14/#29/#30） |
| 错误信息硬编码中文 | ✅ 投票路径与 auth/SSO 路径均改为**稳定错误码 + i18n**（#10/#19） |
| AirAccount 签名未实现 / SSO token 存 sessionStorage | ⏸ 仍阻塞于 E-5 KMS 与 cos72 落地页 |
| `v-html` XSS 面 | ✅ 维持 DOMPurify 已缓解（未变） |

> 评审时尚未存在、现已具备的能力：**多后端投票**（链下默认 + 可选 Snapshot X EVM/OP）、Explore 链上空间发现、注册自助流程与所有权校验。

---

## 一、架构（Architecture）

**技术栈：** Vue 3（Composition API、`<script setup>`）+ TypeScript，Vite 构建，Vue Router 4，vue-i18n，Vitest 测试。没有状态管理库，用 `ref`/`computed` 单例代替。后端完全外部化：Snapshot Hub GraphQL + 投票接收 sequencer，外加一组 Cloudflare Pages Functions 用于多租户。

**目录结构：** 虽然被称为 "monorepo"，但仓库根目录没有 `package.json` 或 `pnpm-workspace.yaml` —— `apps/web` 是唯一的、自包含的包（有自己的 `package.json`、`tsconfig*.json`）。实际上是单应用仓库，还不是真正的工作区。

**运行时分层：**

```
Cloudflare Pages edge (apps/web/functions/)
  ├── _middleware.ts          → /api/graphql 代理到 Snapshot Hub（国内连通性）+
  │                              从 KV 解析租户，注入 window.__TENANT__ 到 HTML
  └── api/{check,register,status}.ts → 自助子域名注册（KV 后端）

Vue SPA (apps/web/src/)
  ├── tenant.ts               → 读取 window.__TENANT__，合并覆盖 branding.ts 默认值
  ├── main.ts                 → 应用解析后的 branding 为 CSS 变量，挂载应用
  ├── router.ts               → 5 条路由；tenant.spaceId 存在时重定向到单空间
  ├── auth/useAuth.ts         → 响应式单例 auth 状态，可插拔 provider
  ├── lib/graphql.ts          → Snapshot Hub GraphQL 读取
  ├── lib/snapshotVote.ts     → 手写 EIP-712 投票信封 + hub/sequencer 提交
  └── pages/*.vue             → Explore、Space、Proposal、Register、SsoCallback
```

**数据流：**

1. 页面通过 `graphqlRequest` → `GRAPHQL_ENDPOINT`（默认 testnet hub；可走 `/api/graphql` 代理）。
2. 投票不再用 `snapshot.js`/ethers —— `lib/snapshotVote.ts` 手写重建了精确的 EIP-712 payload（因为 `snapshot.js` 的 `Client712` 硬编码了 ethers v5），直接 POST 到 hub/sequencer。
3. 一个 `AuthProvider` 接口下有两个 provider：`walletProvider`（EIP-1193 `window.ethereum`）和 `airAccountProvider` → `airAccountBridge`（cos72 OAuth 风格 SSO + 远程 KMS 签名，因为 AirAccount 是智能合约账户，其 ERC-1271 校验需要 owner key，而该 key 永远不会进入浏览器）。
4. 多租户：hostname → edge 层 KV 查询 → `window.__TENANT__` → 客户端与 `branding.ts` 合并。仓库根目录的 `tenants.json` 是已废弃的静态回退（M2 文档描述了它，但落地实现已改为 Cloudflare KV + 自助注册，见 `functions/api/register.ts`）。

## 二、主要组件（Major Components）

| 组件 | 职责 |
|---|---|
| `pages/ExplorePage.vue` | 列出 spaces，5 分钟内存缓存（`lib/cache.ts`），Load More 分页，手动刷新 |
| `pages/SpacePage.vue` | 空间详情 + 提案列表，Load More 分页 |
| `pages/ProposalPage.vue` | 提案详情，Markdown 正文渲染（`marked` + `dompurify`），投票结果条，选票 UI，通过 `castVote` 提交 |
| `pages/RegisterPage.vue` | 自助社区子域名注册 UI，防抖的名称可用性检查 |
| `pages/SsoCallbackPage.vue` | 固定 `/sso/callback` 落地页；消费 cos72 的 `?code=`，重定向到暂存的 `returnTo` |
| `router.ts` | 5 条路由 + 租户感知的 `beforeEach` 守卫用于单空间重定向 |
| `auth/useAuth.ts` | 中央响应式 auth 状态；provider 切换；`restoreSession`/`completeSsoLogin`/`startLogin` 编排 |
| `auth/walletProvider.ts` | EIP-1193 connect/sign，为 `eth_signTypedData_v4` 兼容重新添加 `EIP712Domain` 类型条目 |
| `auth/airAccountBridge.ts` | cos72 SSO code 交换/校验，sessionStorage 会话，防开放重定向的 `returnTo` 处理，单次 code 的并发去重 |
| `auth/kms.ts` | AirAccount 远程签名接口；占位实现抛 `KmsNotConfiguredError`（E-5 尚未交付） |
| `lib/graphql.ts` | 带类型的 GraphQL 查询：`fetchSpaces`、`fetchSpaceWithProposals`、`fetchProposal` |
| `lib/snapshotVote.ts` | EIP-712 投票 payload 构造（与 `snapshot.js` 白名单类型逐字节一致）+ hub/sequencer 提交 |
| `lib/cache.ts` | 简单 TTL 内存缓存，目前只有 ExplorePage 使用 |
| `tenant.ts` / `branding.ts` | 租户覆盖与单社区默认 branding 的合并 |
| `functions/_middleware.ts`、`functions/api/*.ts` | Edge GraphQL 代理、租户 HTML 注入、子域名注册/可用性/状态 API |

## 三、潜在技术债（Potential Technical Debt）

### 文档漂移

- **根目录 `CLAUDE.md` 过时**：写着 "no test runner configured"（不属实 —— Vitest + 3 个测试文件已存在），且遗漏了 `tenant.ts`、`kms.ts`、`airAccountBridge.ts`、`RegisterPage.vue`、`SsoCallbackPage.vue` 以及整个 `functions/` 多租户 API 层。文档描述的是更早期、更简单的架构。
- **`docs/M2-multi-tenant.md` 检查清单未勾选但工作已完成** —— 底部的任务列表（`tenant.ts`、`_middleware.ts`、`tenants.json` 等）全部空白，尽管列出的每个文件都已存在并实现；该文档仍描述已废弃的静态 `tenants.json` 模型，而非落地实现的 KV 后端自助注册流程。
- **`apps/web/tenants.json` 实际已死** —— 落地的 `_middleware.ts` 从 `TENANTS_KV` 读租户配置，而不是读这个文件；`functions/` 里没有任何代码读 `tenants.json`。对新贡献者造成困惑。

### 安全 / 正确性

- **`POST /api/register` 无认证/限流**（`functions/api/register.ts`）：任何人都可以注册任意子域名并绑定任意 Snapshot `spaceId`，触发真实的 Cloudflare Pages 自定义域名 + SSL 证书开通调用，没有验证码、没有 Snapshot 空间所有权证明、没有按 IP 限流 —— 面临抢注/滥用和 CF API 配额耗尽的风险。
- **注册的 TOCTOU 竞态**：`check.ts`/`register.ts` 先 `KV.get` 做唯一性检查，再单独 `KV.put`；两个同名并发请求可以同时通过检查，其中一个静默覆盖另一个的租户配置。
- **`v-html` XSS 面**在 `ProposalPage.vue:203` —— 已用 `DOMPurify.sanitize` 缓解（这是正确的），但这是应用中唯一渲染不可信远程内容为 HTML 的地方；值得加注释说明为何安全（目前没有），并确认 DOMPurify 配置覆盖了链接的 target-blank/rel-noopener 剥离，因为 `marked` 的输出没有其他审查。
- **SSO token 存于 `sessionStorage`**（`airAccountBridge.ts`）—— 代码自己注释说明这是刻意妥协（XSS/泄露窗口 vs UX），等待 cos72 refresh-token 端点；这里只标记为长期风险，不是 bug。

### 未完成功能

- **AirAccount 投票路径生产环境不可用**（`auth/kms.ts` 的 `createPlaceholderKmsSigner` —— "E-5 pending"）：每个 AirAccount 签名调用都会抛错；只有 UI/管道存在。`cos72` 自己的 SSO-authorize 落地页也尚不存在（见 `config.ts` 中 `COS72_AUTHORIZE_URL` 的注释），所以整个 SSO 登录入口被外部团队阻塞。

### 健壮性

- **`GRAPHQL_ENDPOINT` 请求没有取消/去重** —— 快速路由切换（如快速前进/后退经过 `SpacePage`/`ProposalPage`）会让旧的 in-flight 请求与最新请求竞争；`watch(spaceId | proposalId, ...)` 不会中止上一个请求，慢的旧响应可能覆盖更新的状态。
- **没有跨页缓存失效** —— 投票后不会使任何缓存的列表数据失效；Explore 缓存 key 是全局的、未按租户区分，尽管应用现在已是多租户（单个内存 `Map`，真实部署中切换租户无影响，但若客户端将来切换租户则是一个潜在 bug）。
- **`register.ts` 吞掉了 Pages 域名注册失败**（`functions/api/register.ts:100-102`，只 `console.error`）—— 即使自定义域名/SSL 开通失败，用户仍收到 "success" 响应，留下一个 KV 条目却没有可用域名，直到管理员发现日志。

### 代码质量

- **读取路径没有自动化测试** —— `lib/graphql.ts`、三个页面组件、`lib/cache.ts`、`walletProvider.ts`/`airAccountProvider.ts` 的测试覆盖为零；只有 `airAccountBridge`、`snapshotVote`、`SsoCallbackPage` 有测试。投票签名/EIP-712 编码逻辑（`ProposalPage.vue` 中的 `encodeChoice`）以及 `ExplorePage.vue`/`SpacePage.vue` 的分页/缓存逻辑均未测试。
- **类型安全缺口**：`graphql.ts` 的 `graphqlRequest` 和 `snapshotVote.ts` 的 `submitVoteEnvelope` 响应在顶层之外是 `unknown`/宽松类型（目前可接受，但 `ProposalPage.vue:28` 的 `voteReceipt` 是 `ref<unknown | null>` 且从不检查真实性 —— 精度浪费）。
- **i18n**：只有 `zh-CN`/`en` 支持（按 CLAUDE.md 是刻意的），但 `airAccountBridge.ts`/`snapshotVote.ts` 通过 `Error.message` 抛出的所有错误字符串都是硬编码中文，不随当前 locale 变化（如 `'cos72 API 未配置...'`、`'Snapshot hub 拒绝了投票...'`）—— 英文 locale 用户的大多数失败路径仍看到中文错误文本，与 `t()` 驱动的正常路径标签不一致。

## 四、deepseek-worker 的改进建议（仅记录，未实施）

### 建议 1（主建议）：给分页加载器加「过期响应守卫」

**问题：** `SpacePage.vue` 的 `loadSpace()`（38–70 行，由 `watch(spaceId)` 在 78 行触发）是异步函数，在 `await` 完 GraphQL 调用后直接写入组件状态（`space.value`、`proposals.value`、`hasMore.value`、loading 标志），没有检查这次请求是否仍是最新的。Vue Router 在 `/space/:id` 变化时会复用同一个 `SpacePage` 实例，所以 `watch(spaceId)` 会在旧请求还在飞行时启动第二个并发加载。响应可能乱序到达——空间 A 的慢响应可能落在空间 B 之后，覆盖 B 的标题/提案（或把 A 的第 2 页「加载更多」追加进 B 的列表）。`finally` 也无条件清掉 loading 标志，导致最新请求还在进行时 spinner 就消失。

**为什么重要：** 普通快速导航（前进/后退、连续点击空间）在非瞬时网络上会显示错误数据；难以复现/定位，且目前无测试覆盖，会静默回归；同样的缺陷被复制粘贴到 `ProposalPage` 和 `ExplorePage`，修一处模式可覆盖多处。

**建议改动（未应用）：** 每个组件引入一个单调递增的请求令牌，让所有 `await` 之后的状态写入（含 `finally` 标志复位和 `catch` 分支）都以「令牌仍是最新」为条件：

```ts
let loadToken = 0
async function loadSpace(skip: number) {
  if (!spaceId.value) return
  const token = ++loadToken
  // ... 设置 loading 标志，然后：
  try {
    const data = await fetchSpaceWithProposals(...)
    if (token !== loadToken) return   // 已有更新的加载取代了我们
    // ... 原有的状态写入
  } catch (e) {
    if (token !== loadToken) return
    ...
  } finally {
    if (token === loadToken) { loading.value = false; loadingMore.value = false }
  }
}
```

同样的守卫应用到 `ProposalPage.loadProposal()` 和 `ExplorePage.loadSpaces()`。（`AbortController` 是备选方案，但令牌守卫更小且足够，因为这些页面本就不需要被中止的响应。）

**为什么低风险：** 纯增量改动，只丢弃已知无效的结果，请求形状/GraphQL 查询/渲染输出都不变；无新依赖，现有 Vitest + happy-dom 即可验证；`watch`/`onMounted` 与 `skip===0` vs `skip>0` 语义不动；易于测试（挂载 `SpacePage`，触发两次加载让第一次最后才返回，断言第二次数据胜出）。

### 建议 2（次要）：`_middleware.ts` 注入 `__TENANT__` 时未转义 `<`

`functions/_middleware.ts` 把 `window.__TENANT__=${JSON.stringify(tenantConfig)}` 注入 `<script>` 标签时没有做 `<` 转义，而 `api/register.ts` 里 `description` 字段是未净化存储的——该字段出现 `</script>` 会破坏标签逃逸出脚本。把 `<` 转义为 `\u003c` 即可修复。影响低于建议 1。
