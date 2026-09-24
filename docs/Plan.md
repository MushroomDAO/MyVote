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
| **AirAccount** | cos72 SSO 会话 + 远程 KMS 签名适配层 | 🟡 管道已通，**KMS 后端（E-5）未交付** |

当前数据层默认指向 **testnet hub**（`https://testnet.hub.snapshot.org`），因为目标是 Sepolia 空间。

---

## 4. 后续里程碑

### M3 — 多后端写路径与前端稳健性（进行中）

**目标**：把「链下专用」的投票写路径抽象成可替换后端，并补齐读取路径的健壮性与测试。

- [ ] 抽出 `VoteBackend` 接口，`snapshotVote.ts` 作为链下默认实现（不改行为）。
- [ ] 读取路径加**过期响应守卫**（请求令牌），修 `SpacePage` / `ProposalPage` / `ExplorePage` 的乱序覆盖竞态（见 `docs/architecture-review.md` 建议 1）。
- [ ] 补读取路径测试：`lib/graphql.ts`、`lib/cache.ts`、三个页面组件的分页/缓存逻辑。
- [ ] 投票后失效相关缓存；Explore 缓存 key 按租户隔离。
- [ ] 错误信息接入 i18n（去掉硬编码中文）。

### M4 — AirAccount 生产可用（外部阻塞）

**目标**：Web2 登录 + 免助记词投票真正可用。

- [ ] **E-5**：KMS HTTP 签名端点（`signTypedData` / `signMessage`）落地，替换 `createPlaceholderKmsSigner()`。
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
- [ ] **M5-3 SX 读路径**：接 `apps/api`（`api.snapshot.box`）拿 SX space / proposal /
      authenticator / strategies（**新增**而非替换链下 Hub）——页面接线的前置条件
- [ ] **M5-3 页面接线**：ProposalPage 按 `protocolForSpaceId` 选择后端并渲染 SX 投票
- [ ] 在一个真实 SX space（优先 Optimism）上做端到端验证

### M6 — 自助注册安全加固与多租户运维

- [x] 按 IP 限流：`register` 5/时、`check` 120/分（KV 固定窗口，尽力而为，见 `lib/rateLimit.ts`）。
- [x] 校验 `spaceId` 格式（ENS / Snapshot X hex），拒绝空白与分隔符。
- [x] `_middleware.ts` 注入 `__TENANT__` 前经 `escapeForScript` 转义 `<` 与 U+2028/2029。
- [x] 缩小 TOCTOU 竞态：写入随机 reservation 后读回确认，败者返回 409。
      _彻底修复需 Durable Objects（KV 无 CAS）——记为残余风险。_
- [ ] **鉴权 / 验证码**：注册者身份目前仅前端声明的邮箱，服务端不可信。需产品决策
      （邮箱验证码 / cos72 登录态 / 钱包对注册请求签名）。
- [ ] **Snapshot 空间所有权校验**：防止抢注他人 spaceId。需产品决策（签名消息 / space 设置校验串）。
- [x] **预览/生产 KV 隔离**：新增 `wrangler.preview.toml` + `scripts/deploy-preview.sh`，
      修复 `wrangler pages deploy` 把预览绑定覆盖成生产命名空间的问题（见 `docs/deployment.md` §2）。
- [x] **多租户运维文档**：`docs/deployment.md`（环境、KV、密钥、部署命令、健康检查、排障）。
- [x] **注册失败处理**：CF Pages 域名注册失败时**回滚 KV 并返回 502**（不再静默成功）；
      未配置 CF 密钥（预览）记 `domainStatus: 'unmanaged'`，成功记 `'active'`，`/api/status` 暴露该状态。
      本批首次为 `functions/` 建立单测（`functions/api/register.test.ts`，Node 环境）。

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
- 多租户实现：[`docs/M2-multi-tenant.md`](./M2-multi-tenant.md)
- 仓库架构评审：[`docs/architecture-review.md`](./architecture-review.md)
- 开发循环与 pre-PR：[`docs/development-loop.md`](./development-loop.md)
- Snapshot 官方文档：https://docs.snapshot.box
