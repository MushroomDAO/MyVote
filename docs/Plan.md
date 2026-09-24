# MyVote 路线图（Plan）

> **最后更新**：2026-09-24
> **选型决策**：见 [`docs/snapshot-version-decision.md`](./snapshot-version-decision.md)
> 本文档取代旧版「以 Snapshot X 为唯一后端」的规划；历史调研笔记保留在 [`docs/SnapshotX.md`](./SnapshotX.md) 并已加过时标注。

---

## 1. 目标

构建一个开源、可白标的社区治理门户：

- 数据与 [snapshot.box](https://snapshot.box) 互通（同一协议下创建的空间/提案/投票，官方浏览器也能索引展示）。
- 可插拔登录：标准 Web3 钱包 + Web2 风格登录（AirAccount / cos72 SSO + 远程 KMS 签名）。
- 默认 zh-CN，可切换英文。
- 一次部署服务多个社区（按 hostname 解析租户），或为单社区一键部署。

---

## 2. 路线决策摘要（详见决策文档）

| 维度 | 选择 |
|---|---|
| **协议后端** | **经典链下 Snapshot 为主**（Hub GraphQL + EIP-712），Snapshot X（EVM/OP）作为可选升级后端 |
| **SDK 基座** | 新版 `@snapshot-labs/sx` / `lock` / `tune`（不再投入 `snapshot-v1` / 以 `snapshot.js` 为主 SDK） |
| **前端** | 保持自研精简 SPA（Vue 3），不整体 fork `apps/ui` |
| **写路径** | 抽象 `VoteBackend` 接口，链下为默认实现，SX 为可选实现 |

---

## 3. 当前状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1** Clone & Deploy | 品牌单文件定制、CSS 变量主题、Explore/Space/Proposal 三页、EIP-712 投票、Markdown 正文、zh-CN/en、分页 | ✅ 完成 |
| **M2** Multi-Tenant | 边缘 `_middleware.ts` 从 **KV** 解析 hostname → 注入 `window.__TENANT__`；`/api/graphql` 代理（国内连通） | ✅ 完成 |
| **M2.5** 自助注册 | `api/register.ts` 自助子域名注册 + 名称可用性检查；CF 代理 + 内存缓存 + 刷新 | ✅ 完成（**待安全加固**，见 M6） |
| **Testnet 社区 E2E** | Sepolia 链下全流程：ENSv2 注册 → 建 space → 建提案 → Jason/Anni 真实投票 | ✅ 完成（[`docs/testnet-space-e2e.md`](./testnet-space-e2e.md)） |
| **AirAccount** | cos72 SSO 会话 + 远程 KMS 签名适配层 | 🟡 管道已通，**KMS 后端（E-5）未交付** |

当前数据层默认指向 **testnet hub**（`https://testnet.hub.snapshot.org`），因为目标是 Sepolia 空间。

---

## 4. 后续里程碑

### M3 — 多后端写路径与前端稳健性（进行中）

**目标**：把「链下专用」的投票写路径抽象成可替换后端，并补齐读取路径的健壮性与测试。

- [x] 抽出 `VoteBackend` 接口，`snapshotVote.ts` 作为链下默认实现（不改行为）。
- [x] 读取路径加**过期响应守卫**（请求令牌），修 `SpacePage` / `ProposalPage` / `ExplorePage` 的乱序覆盖竞态（见 `docs/architecture-review.md` 建议 1）。
- [x] 补读取路径测试：`lib/graphql.ts`、`lib/sx/*`、`lib/cache.ts`、`lib/requestGuard.ts`，
      以及页面组件的竞态、协议分流与错误恢复。
- [x] Explore 缓存 key 按租户（host）隔离；投票后失效：Explore 缓存不含投票数据，暂无必要。
- [x] 错误信息接入 i18n：投票路径与 auth/SSO 路径均改为稳定错误码
      （`lib/errors.ts` 的 `ErrorCode` / `errorKey`），UI 侧 `resolveErrorMessage` / `App.vue` 翻译。

### M4 — AirAccount 生产可用（外部阻塞）

**目标**：Web2 登录 + 免助记词投票真正可用。

- [x] **E-5（MyVote 侧）**：`createHttpKmsSigner` 落地 `/kms/SignTypedData`（KMS 的
      数组形式 payload、`x-amz-target`、agent JWT / `x-api-key`），配置 `VITE_KMS_ENDPOINT`
      即可替换 placeholder。
      _2026-09 真机核对（`https://kms.aastar.io` v0.29.0，`KMS_E2E_API_KEY` 有效）：`x-api-key`
      能过端点门，但 `/kms/SignTypedData` 仍要求 **agent JWT 或 challenge-bound WebAuthn**；
      `/kms/create-agent-key` 同为 WebAuthn 门控。故真机签名待 cos72 签发 agent JWT（或浏览器
      passkey ceremony），SSO token 正是这个凭据。_
- [x] **E-5（真机签名）**：2026-09 用 KMS e2e API key + SDK 的 `P256PasskeySigner`
      在 `kms.aastar.io` 创建了绑定软件 passkey 的 key、经 WebAuthn ceremony 铸出
      **agent JWT**，再用**我们的** `createHttpKmsSigner` 成功签出 EIP-712 签名（65 字节，
      `verifyTypedData` 通过）。复现：`src/auth/kms.live.test.ts`（`KMS_LIVE=1`）。
      _关键发现：agent 凭据按派生路径限定（实测 `m/44'/60'/0'/1/0`），传 KMS 默认的
      `m/44'/60'/0'/0/0` 会被拒；故会话除 token 外还要带 `hdPath`，signer 已支持按请求传入。_
- [ ] **E-5（生产接线）**：cos72 在 SSO 交换结果里返回 agent JWT 及其 `hdPath`；MyVote
      侧已就绪（`KmsSignContext.token` + `hdPath`）。
- [ ] **cos72**：SSO 授权落地页（`/sso/authorize` 前的第一方页面）上线；`VITE_COS72_AUTHORIZE_URL` 指向它。
- [ ] cos72 refresh endpoint 就绪后，把 SSO token 从 `sessionStorage` 迁到内存 + HttpOnly 刷新 Cookie。
- [ ] E2E：Web2 登录 → 投票全链路。

> 上述两项均依赖外部团队，MyVote 侧已完成并可配置，属**等待型阻塞**。

### M5 — Snapshot X（EVM / OP）可选后端

**目标**：为有链上金库/资产的社区提供链上治理选项，复用官方基础设施。

- [x] **M5-1 后端模块**：新增 `@snapshot-labs/sx` 依赖 + `lib/sx/backend.ts`
      （封装 EVM `EvmEthereumSig`、官方 Mana / whitelist 默认值、动态 import 代码分割）
- [x] **M5-1 signer 适配**：`createEthersCompatSigner` 把 viem 形状的 `signTypedData`
      桥接为 ethers v5 的 `_signTypedData`；viem 保留在应用层
- [x] **M5-1 路由启发式**：`lib/voteRouting.ts` `protocolForSpaceId`（`0x…` → SX，ENS → 链下）
- [x] **M5-2 provider 适配**：`lib/sx/provider.ts` 把注入的 EIP-1193（`window.ethereum`）
      包装成 sx.js 需要的 ethers Provider 形状（`call/getNetwork/getBlockNumber/getCode/
      getStorageAt/getTransactionCount/getBalance/getLogs`），不引入 `@ethersproject/providers`；
      `createSxBackendFromEip1193` 组合 provider + 后端
- [x] **M5-3 SX 读路径**：`lib/sx/api.ts` 接 `api.snapshot.box`（space / proposals / proposal+space），
      含 `zipStrategies`、`toSxSpace`/`toSxProposal`、`buildSxVoteRequest` 与错误处理；
      **已在真实 Optimism space 上 live 验证**：
      `SX_LIVE=1 vitest run src/lib/sx/api.test.ts` → Ryu0x167 Space Command
      `0x03C7431e14F7b759Aa44398AD7901e6053c197Bf`（_indexer `oeth`）
- [x] **M5-4 页面接线**：`SpacePage` / `ProposalPage` 按 `protocolForSpaceId` 分流——
      SX space 走 `api.snapshot.box` 读、`ProposalPage` 显示「链上（Snapshot X）」标记，
      投票经 `createSxBackendFromEip1193` → Mana；链下路径完全不变
- [x] **代码分割验证**：`@snapshot-labs/sx` 现在是独立 lazy chunk（~851 KB + shutter wasm），
      仅在实际投 SX 票时加载；主 chunk 仅 +~9 KB
- [ ] 在真实 SX space 上完成一次真实投票（需要该 space 的投票权 + 钱包；Ryu0x167 可作为目标）
      _2026-09 复核：修复了 `castVote` **只签名不提交**的缺陷（#52）——sx.js `vote()`
      只产出签名信封，需再调 `send()` 才发给 Mana；中继无结果时报错。并加 opt-in 的
      中继连通性检查（`SX_LIVE=1 vitest run src/lib/sx/backend.test.ts`，验 `eth_rpc/10`
      的 JSON-RPC 端点契约，不需要投票权）。真实投票本身仍待有投票权的钱包。
      _另：SX 提案页会按索引器识别当前账户是否已投票——命中则禁用提交并给出
      交易链接（#57）；该查询格式（`proposal` 用数字 id、`voter` 用校验和地址）
      由 opt-in live 用例固定（`SX_LIVE=1 vitest run src/lib/sx/api.test.ts`）。_

### M5.5 — 测试网链下 Space 全流程 live 验证（本轮完成）

**目标**：在真实 Snapshot testnet hub 上验证「建社区 → 建提案 → 真实投票」全链路，而不是只靠单测。

- [x] 在 Sepolia 注册 ENSv2 名 `myvote-demo.eth`。Sepolia 的 **ENSv1 registrar 已停用**
      （`BaseRegistrar.controllers` 对已知 controller 全为 `false`），新注册只能走 ENSv2，
      费用用 **USDC** 计价，仍是 commit–reveal（`MIN_COMMITMENT_AGE = 60s`）。
      _关键坑：Sepolia 上有两套 ENSv2 部署，必须用 Universal Resolver 看到的那套
      （registrar `0xabe76f6c…94ca` → `eth` registry `0x657eA849…E09E`）；
      另一套（`0x8c2e866b…ffca`）链上注册成功但 Snapshot 解析不到，建 space 报 `not allowed`。_
- [x] 建 space `myvote-demo.eth`（`network = "11155111"`，`whitelist` 策略），
      sequencer 回执 `0x74754aef…8017`。
- [x] 建提案 `0xda42312a…b6b3`，并用 Jason / Anni 两个账户**经 MyVote 自己的
      `castVote()`** 真实投票；计票 `scores [1,1,0]` / `scores_total 2` / `votes 2`。
- 可复现步骤、自检方法与踩坑清单：[`docs/testnet-space-e2e.md`](./testnet-space-e2e.md)。

### M6 — 自助注册安全加固与多租户运维

- [x] 按 IP 限流：`register` 5/时、`check` 120/分（KV 固定窗口，尽力而为，见 `lib/rateLimit.ts`）。
- [x] 校验 `spaceId` 格式（ENS / Snapshot X hex），拒绝空白与分隔符。
- [x] `_middleware.ts` 注入 `__TENANT__` 前经 `escapeForScript` 转义 `<` 与 U+2028/2029。
- [x] 缩小 TOCTOU 竞态：写入随机 reservation 后读回确认，败者返回 409。
      _彻底修复需 Durable Objects（KV 无 CAS）——记为残余风险。_
- [x] **邮箱验证码（M6-3）**：`POST /api/email-code` 经 Resend 发 6 位码（10 分钟、5 次尝试、
      按 IP + 邮箱双限流），KV 只存加盐 SHA-256；`/api/register` 在 `RESEND_API_KEY` 存在时
      **强制校验**验证码。**2026-09-24 本地全链路 live 验证**：真实从 `hello@idoris.ai` 发出、
      一次性邮箱收到码、错误码 400 `email_code_mismatch`、正确码 200。
      _注意：`wrangler pages secret put` 只能写 **production** 作用域，无法只给 preview 配 key；
      preview/生产的开启需要在 CF 控制台按环境设置，故本次用 `wrangler pages dev` + `-b` 本地验证。
      复现见 [`docs/deployment.md`](./deployment.md) §4。_
- [ ] **更强身份（可选）**：钱包对注册请求签名已支持（见下条 `adminSignature`）；
      cos72 登录态作为身份来源待外部就绪。
- [x] **Snapshot 空间所有权校验**（非破坏式）：可选 `adminSignature`/`adminAddress`/`adminTimestamp`；
      `viem.verifyMessage` 验签 + 向 Hub 查 `space.admins`。**提供签名则必须通过**（否则 400），
      不提供则记为 `unverified`（现有邮箱注册流程不变）。见 `lib/ownership.ts`。
      _后续可按策略收紧（例如要求 `verified` 才实际发放域名/证书）。_
- [x] **预览/生产 KV 隔离**：新增 `wrangler.preview.toml` + `scripts/deploy-preview.sh`，
      修复 `wrangler pages deploy` 把预览绑定覆盖成生产命名空间的问题（见 `docs/deployment.md` §2）。
- [x] **多租户运维文档**：`docs/deployment.md`（环境、KV、密钥、部署命令、健康检查、排障）。
- [x] **注册失败处理**：CF Pages 域名注册失败时**回滚 KV 并返回 502**（不再静默成功）；
      未配置 CF 密钥（预览）记 `domainStatus: 'unmanaged'`，成功记 `'active'`，`/api/status` 暴露该状态。
      本批首次为 `functions/` 建立单测（`functions/api/register.test.ts`，Node 环境）。

### M7 — 稳健性与测试补强（自主迭代）

**目标**：在等待外部依赖（E-5 KMS / M6-3 注册鉴权 / 真机投票）期间，
把测试覆盖与读取路径健壮性补齐，并修复过程中暴露的真实缺陷。

- [x] 补齐此前零测试的模块：`tenant.ts`、`router.ts`、`pages/RegisterPage.vue`、
      `auth/useAuth.ts`、`auth/{walletProvider,airAccountProvider,kms}.ts`、
      `App.vue`、`main.ts`（#36–#40、#44）。
- [x] 读取路径接入 **AbortController**：`requestGuard` 持有取消信号，
      `next()` 中止上一个请求，`abort()` 用于卸载且同步失效令牌；
      `lib/graphql.ts` / `lib/sx/api.ts` 透传 `signal`（且不进入 GraphQL variables），
      三个页面接线（#41、#42）。
- [x] 读取失败可重试：`SpacePage` / `ProposalPage` 增加重试按钮；
      `ExplorePage` 链上列表失败不再静默清空（#43）。
- [x] 修复 Ref 未解包导致的模板缺陷（#44、#45）：`App.vue` 的全局错误条常显与
      登录态误判、`SsoCallbackPage` 的空错误块。根因相同——`<script setup>` 只
      自动解包**顶层**绑定，而模板里访问了 `useAuth()` 返回对象上的 ref；
      现统一解构为顶层 ref。
- [x] 补上分页 lookahead：`lib/pageCursor.ts` 每页多取一条，`hasMore` 不再在
      页大小整数倍时给出空翻页（#48）。
- [x] 补上 CI：`.github/workflows/ci.yml` 在 PR / push 到 main、dev 时跑
      typecheck + test + build（只校验不部署，见 `docs/development-loop.md`）。
- [x] 预览部署自检：`scripts/deploy-preview.sh` 部署后对分支别名做冒烟检查
      （HTTP 200 + `id="app"`），见 `docs/deployment.md` §2。
- [x] 修复 SX 链上投票只签名不提交（#52）：`castVote` 走 `vote()` → `send()` 两步，
      中继无结果时报错；并补 opt-in 的 `SX_LIVE=1` 中继连通性检查。
- [x] 提案列表状态筛选（全部 / 进行中 / 已结束）：链下 `$state: String`、链上
      `$state: ProposalState` 枚举，变量省略即不加谓词（#55）。
- [x] 链下投票成功后重读提案，新票数在回执下方显示（#56）。
- [x] 两端「已投票」识别：链上禁用重复投票 + 交易链接 + 权重（#57、#58），
      链下提示 + 预选可改（#59）。
- [x] Explore 链上空间列表分页（`SX_PAGE_SIZE=6` + lookahead）（#54）。
- [x] SX 不可投即禁用并说明原因：`sxBlockReason`（closed / not-started /
      no-authenticator）接进 `canVote`，并显示对应翻译（#63）。
- [x] SX 已投票提示显示所投选项（`choice` → `choices[choice-1]`）（#62）；
      投票窗口到点自动翻转提交按钮（`lib/sx/voteWindow.ts` 定时器）（#65）。
- [x] Explore 链上空间列表 5 分钟缓存（与链下一致，refresh/retry 强制绕过）（#64）。
- [x] i18n catalog 键集完全一致校验 + 筛选空结果专门文案（#66）。
- [x] SpacePage 切筛选只重载列表，卡片与筛选按钮不闪没（#67）。
- [ ] 真实 SX 投票 E2E 与注册鉴权仍按 M5 / M6 的阻塞项处理。

---

## 5. 技术选型原则

1. **协议互通优先**：能在官方前端看到的数据，才是可信数据。
2. **免 Gas 优先**：链下签名是默认路径；链上仅在社区确有链上资产时启用。
3. **基座跟随官方新版**：`sx.js` / `lock` / `tune` 优先于自研等价物。
4. **白标与登录是差异化**：不为通用治理功能重造轮子，把精力放在多租户、AirAccount、中文体验。
5. **不为未验证的未来重写现在**：用抽象层预留，不提前实现 SX。

---

## 6. 参考

- 选型决策：[`docs/snapshot-version-decision.md`](./snapshot-version-decision.md)
- 历史调研（含过时结论）：[`docs/SnapshotX.md`](./SnapshotX.md)
- 测试网 Space 全流程：[`docs/testnet-space-e2e.md`](./testnet-space-e2e.md)
- 多租户实现：[`docs/M2-multi-tenant.md`](./M2-multi-tenant.md)
- 仓库架构评审：[`docs/architecture-review.md`](./architecture-review.md)
- 开发循环与 pre-PR：[`docs/development-loop.md`](./development-loop.md)
- Snapshot 官方文档：https://docs.snapshot.box
