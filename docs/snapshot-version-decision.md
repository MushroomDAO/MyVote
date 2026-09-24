# Snapshot 二次开发技术选型决策：经典 Snapshot vs 新版

> **状态**：已决策（Accepted）
> **复核日期**：2026-09-24
> **适用范围**：MyVote 前端、SDK 基座、协议后端选型
> **关联文档**：[`docs/Plan.md`](./Plan.md)（路线图）、[`docs/SnapshotX.md`](./SnapshotX.md)（历史调研，部分结论已被本文取代）

---

## 0. 结论（TL;DR）

**分层决策，不要二选一：**

| 层 | 选择 | 一句话理由 |
|---|---|---|
| **协议层** | **近期继续经典链下 Snapshot**，Snapshot X 作为**可选升级后端** | 社区现状、免 Gas、与 snapshot.box 数据互通、迁移成本为零 |
| **基座层** | **押注新版 `sx-monorepo` 的包**（`@snapshot-labs/sx` / `lock` / `tune`） | 官方全部研发投入都在这里；`snapshot-v1` 前端已进维护模式 |

**最关键的一条澄清：选「新版」≠ 放弃链下。** 新版的 `sx-monorepo` 里**同时装着经典链下协议**（`apps/hub` + `apps/sequencer`）和链上 Snapshot X（`apps/api` + `apps/mana` + `contracts/`）。因此「用新版 SDK/UI 基座」和「继续跑链下协议」可以同时成立。

---

## 1. 问题背景

MyVote 需要决定二次开发（自研白标治理门户）应该基于：

- **经典 Snapshot**：链下投票（EIP-712 签名 + IPFS + Hub GraphQL），即 `snapshot-v1` 前端 + `snapshot.js` SDK；还是
- **新版**：Snapshot 官方新一代 monorepo / SDK / UI。

仓库当前的 `docs/Plan.md` 与 `docs/SnapshotX.md` 基于 2026 年初的信息，结论已明显过时（详见 §4），本文档予以取代。

---

## 2. 先拆成两个独立的轴

「经典 vs 新版」其实是两个互相独立的决策，混在一起讨论必然失真：

| 轴 | 经典 | 新版 | 本项目选择 |
|---|---|---|---|
| **A. 协议** | 链下 Hub（签名 + IPFS + GraphQL，免 Gas） | Snapshot X（全链上，EVM + Starknet，链上计票与执行） | **A = 经典为主，SX 可选** |
| **B. 前端 / SDK 基座** | `snapshot-v1` 前端 + `snapshot.js` | `sx-monorepo`：`apps/ui` + `@snapshot-labs/sx` + `tune` + `lock` | **B = 新版** |

> 注意：轴 B 选新版，**不会**强迫轴 A 切到链上。新版 `apps/ui` 同时服务链下空间与链上空间。

---

## 3. 事实与证据（2026-09 实测）

### 3.1 仓库活跃度

| 仓库 | 角色 | 近 90 天提交 | Stars | 最近推送 | 备注 |
|---|---|---|---|---|---|
| [`snapshot-labs/sx-monorepo`](https://github.com/snapshot-labs/sx-monorepo) | **官方活跃主库** | **100** | 54 | 2026-09-23 | 含 UI / API / Hub / Sequencer / Mana |
| [`snapshot-labs/snapshot`](https://github.com/snapshot-labs/snapshot) | 已更名 **`snapshot-v1`** | **6**（维护） | 9085 | 2026-09-14 | 官方标注为 **"V1 interface"** |
| [`snapshot-labs/snapshot.js`](https://github.com/snapshot-labs/snapshot.js) | 链下 SDK | 30 | 242 | 2026-09-23（v0.17.5） | 仍活跃，`apps/ui` 仍在用 |
| `snapshot-labs/sx-starknet` / `sx-evm` / `mana` | 旧独立仓库 | — | — | — | **已归档**，代码并入 `sx-monorepo` |

### 3.2 新版 monorepo 的组成

```
apps/ui        官方前端（Vue 3, MIT）—— 同时服务链下 + 链上
apps/hub       链下协议 GraphQL API        ← 经典协议在此继续维护
apps/sequencer 链下协议 sequencer           ← 经典协议在此继续维护
apps/api       Snapshot X 多链索引器（api.snapshot.box）
apps/mana      Snapshot X 免 Gas 中继（mana.snapshot.box）
apps/mcp       MCP server
contracts/sx-evm, contracts/sx-starknet     链上协议合约（MIT/开源）
packages/sx.js TS SDK：offchain + SX-EVM + SX-Starknet + Governor(OZ/Bravo)
packages/tune  Vue 3 UI kit（Tailwind）
packages/lock  Web3 连接器库
```

### 3.3 `@snapshot-labs/sx`（sx.js）能力

`packages/sx.js/src/clients/index.ts` 导出：

- Starknet：`EthereumTx/Sig`、`StarknetTx/Sig`、`L1Executor`、`HerodotusController`
- EVM：`EthereumTx/Sig`
- Governor：`GovernorBravoEthereumTx/Sig`、`OpenZeppelinEthereumTx/Sig`
- 链下：`OffchainEthereumSig`、`OffchainStarknetSig`

版本 `@snapshot-labs/sx@0.1.11`，MIT。**注意：它内部仍依赖 `@ethersproject` v5。**

### 3.4 Snapshot X 支持的链（`packages/sx.js/src/evmNetworks.ts`）

`evmMainnet / evmSepolia / **evmOptimism (chainId 10)** / evmPolygon / evmArbitrum / evmBase / evmMantle / evmBnb / evmApe / evmCurtis / evmBaseSepolia`，另有 Starknet。

官方迁移文档亦写明：**Available networks: Ethereum, Base, Optimism, Arbitrum, and Starknet**（要求 ERC-20 Votes 或 Whitelist 策略）。

### 3.5 其它关键事实

- **官方白标（custom domain）自 2025-08-15 起为 Snapshot Pro 付费功能**：CNAME 到 `cname.snapshot.box`，需订阅。→ MyVote 自建多租户白标仍是真实差异化点，但对手从「官方没有」变成「官方收费提供」。
- **Mana** 支持提案创建/更新与投票，**不支持提案执行与 space controller 操作**；免 Gas 需要给空间的专用 authenticator 钱包充值，余额低于 **0.01 ETH** 自动关停。任何人可自建 relayer。
- **Hub GraphQL API 限流 100 req/min**，更高需申请 API Key。

---

## 4. 五个会改变决策的发现

1. **经典链下协议没有被淘汰**——它就在 `sx-monorepo` 的 `apps/hub` + `apps/sequencer` 里持续维护。选新版基座不等于切链上。

2. **`snapshot-v1` 前端已进维护模式**（90 天 6 次提交）。不要再基于它开发；要么复用新版 `apps/ui` 的包，要么自研（MyVote 属后者）。

3. **Snapshot X 已上 EVM 多链且包含 Optimism**。仓库旧文档「SX 以 Starknet 为中心 / 在 OP 原生部署属中长期规划 / 不建议自研」**已过时**。基于 OP 的链上治理**不需要等官方**。

4. **官方白标转为付费**（2025-08-15）。自建多租户门户的定位从「填补空白」变为「对标付费功能，做更贴合中文社区/AirAccount 的方案」。

5. **SDK 收敛到 `@snapshot-labs/sx`**，`snapshot.js` 进入并存的过渡期（`apps/ui` 两者都用）。

---

## 5. 决策与理由

### 决策 1：协议层——链下为主，Snapxt X 可选

**选择经典链下 Hub 作为默认后端。**

- 社区当前就是链下空间，迁移到 SX 需要资产在受支持链上 + 金库/策略改造，收益不确定。
- 免 Gas、与 snapshot.box 数据互通（用户在我们界面投的票官网可见），符合「一键部署 / 公共实例」定位。
- `apps/hub` + `apps/sequencer` 仍被官方维护，不存在断供风险。

**Snapshot X 作为可选升级后端**，触发条件：社区有链上金库 / ERC-20 Votes 资产，且愿意为 Mana Gas 充值。**EVM/OP 优先**（相对 Starknet 更贴合本项目预期用户）。

### 决策 2：基座层——押注新版

- 官方研发投入 100% 在 `sx-monorepo`；`snapshot-v1` 只做维护。
- 新版的 `sx.js` 用一套 API 覆盖链下 + SX-EVM + SX-Starknet + Governor，为「将来接 SX」预留了平滑路径。
- `lock`（连接器）与 `tune`（Vue UI kit）是可直接复用的生产级构件。

### 决策 3：不整体 fork `apps/ui`

`apps/ui` 是 MIT、Vue 3、功能最全，但依赖极重（Electron、tiptap、Apollo、Reown/WalletConnect、Tailwind、Pinia、Starknet），自带设计系统，与 MyVote 四个核心诉求冲突：

1. 白标多租户（hostname → tenant 配置）
2. AirAccount SSO + 远程 KMS 签名（Web2 登录，核心差异化）
3. 默认 zh-CN
4. 国内连通性优化

**做法：复用其包 + 借鉴其实现，保持自研精简 SPA。**

### 决策 4：写路径抽象，避免将来重写

当前 `lib/snapshotVote.ts` 是链下专用（手写 EIP-712，因 `snapshot.js` 的 `Client712` 硬编码 ethers v5）。**在其上再抽一层 `VoteBackend` 接口**，未来接 SX 时用 `sx.js` client 替换实现即可。

> **务实提醒**：`sx.js` 内部同样依赖 `@ethersproject` v5，引入它**不会**解决当初逃离 ethers v5 的动机。可行做法是给 `sx.js` 的 signature client 传一个最小 ethers 兼容 signer（底层仍走 AirAccount KMS 远程签名），viem 继续留给应用层。

---

## 6. MyVote 落地路线

| 阶段 | 内容 | 说明 |
|---|---|---|
| **现在** | 文档对齐（本 PR） | 决策固化为本文档；`Plan.md` / `SnapshotX.md` / `CLAUDE.md` / `M2` 文档去除漂移 |
| **近期** | 抽 `VoteBackend` 写路径接口；补读路径测试与请求竞态防护 | 见 `Plan.md` M3 |
| **中期** | AirAccount SSO + KMS 生产可用（依赖 E-5 与 cos72 落地页） | 见 `Plan.md` M4；外部阻塞 |
| **中长期** | Snapshot X（EVM/OP）可选后端 | 见 `Plan.md` M5；用 `sx.js` 接入，复用 Mana |
| **持续** | 自助注册安全加固（鉴权/限流/TOCTOU）、多租户运维 | 见 `Plan.md` M6 |

---

## 7. 待复核项（Review Triggers）

出现以下任一情况时重新评估本决策：

1. `snapshot-v1` 或 `snapshot.js` 被官方明确弃用/归档。
2. Snapshot X 在 OP 上出现与本项目用户画像匹配的头部案例，且 Mana 赞助机制成熟。
3. 官方重新开放免费白标，或 Snapshot Pro 定价/功能大幅变化。
4. `sx.js` 发布 1.0 且提供与 ethers 解耦的签名接口。

---

## 8. 参考来源

- [sx-monorepo](https://github.com/snapshot-labs/sx-monorepo) · [snapshot-v1](https://github.com/snapshot-labs/snapshot) · [snapshot.js](https://github.com/snapshot-labs/snapshot.js)
- [Snapshot X 架构](https://docs.snapshot.box/snapshot-x/services/architecture) · [SX.js](https://docs.snapshot.box/snapshot-x/services/sx-js) · [Mana](https://docs.snapshot.box/snapshot-x/services/mana) · [SX API](https://docs.snapshot.box/snapshot-x/services/api)
- [Hub GraphQL API](https://docs.snapshot.box/tools/api) · [Snapshot.js](https://docs.snapshot.box/tools/snapshot-js)
- [Migrations / 可用网络](https://docs.snapshot.box/faq/migrations) · [Add a custom domain](https://docs.snapshot.box/user-guides/spaces/add-custom-domain)
