# Snapshot X 集成说明（可选链上后端）

> 最后更新：2026-09。实现分散在 `apps/web/src/lib/sx/`；本文是唯一的整体说明。
> 选型背景见 [`docs/snapshot-version-decision.md`](./snapshot-version-decision.md)；旧调研笔记见 [`docs/SnapshotX.md`](./SnapshotX.md)（已标注过时）。

## 1. 定位

MyVote **默认走经典链下 Snapshot**（Hub GraphQL + EIP-712），**可选**升级到 [Snapshot X](https://docs.snapshot.box/snapshot-x/overview)（全链上，EVM 含 Optimism / Starknet 等）。二者**共存**，按 space 自动路由，互不替换。

| | 链下（默认） | 链上 Snapshot X（可选） |
|---|---|---|
| 标识 | ENS 名（`yam.eth`） | 合约地址（`0x…` 40 hex） |
| 读 | `VITE_SNAPSHOT_HUB`（Hub GraphQL） | `VITE_SX_API`（`api.snapshot.box`） |
| 写 | 手写 EIP-712 → Hub sequencer | sx.js `EvmEthereumSig` → Mana 中继 |
| Gas | 免（只签名） | 免（Mana 代付；空间需有余额） |

路由：`protocolForSpaceId()`（[`src/lib/voteRouting.ts`](../apps/web/src/lib/voteRouting.ts)）。

## 2. 代码地图

| 文件 | 职责 |
|---|---|
| `lib/sx/backend.ts` | 封装 sx.js EVM 签名客户端；**动态 `import('@snapshot-labs/sx')`**（代码分割）；官方 Mana/whitelist 默认值；`createEthersCompatSigner` 把 viem 形状签名桥接为 ethers v5 `_signTypedData`；`castVote` 走 `vote()` + `send()` 两步 |
| `lib/sx/provider.ts` | 把注入的 EIP-1193（`window.ethereum`）包装成 sx.js 需要的 ethers Provider 形状；`createSxBackendFromEip1193` 组合 |
| `lib/sx/api.ts` | 索引器读路径：space / proposals / proposal+space / spaces 列表；`zipStrategies`、`toSxSpace`、`toSxProposal`、`buildSxVoteRequest` |
| `lib/sx/eligibility.ts` | 投票前置校验（closed / not-started / no-authenticator） |
| `lib/sx/types.ts` | 共享类型 + `SX_API_DEFAULT` |
| `pages/SpacePage.vue` | `0x…` → 链上读；显示「链上（Snapshot X）」徽标 + 网络 + 提案数 |
| `pages/ProposalPage.vue` | `?space=0x…` → 链上读/投/结果；投票按钮按 state/窗口禁用 |
| `pages/ExplorePage.vue` | 「打开链上空间」按地址进入 + 「链上空间（Snapshot X）」最近列表 |

## 3. 关键实现细节

- **SDK 体积**：`@snapshot-labs/sx` 是独立 lazy chunk（约 **851 KB** + shutter wasm），**只在实际投 SX 票时加载**；主 chunk 仅 +~9 KB。原因是包的 `exports` 只暴露根入口，无法只取 EVM 客户端。
- **签名者桥接**：sx.js 调 `signer.getAddress()` 与 `signer._signTypedData(domain, types, message)`；我们提供 `createEthersCompatSigner`，底层仍走应用层 `viem`/KMS。
- **提交是两步**：sx.js `EvmEthereumSig.vote()` 返回签好名的 `Envelope`，提交动作在另一个方法 `send(envelope)` 上（内部 `POST {manaUrl}/eth_rpc/<chainId>`）。`castVote` 两步都做，且中继没有返回结果时直接报错——只调 `vote()` 会得到一个"看起来成功但没上链"的签名。
- **provider 的角色**：SX 的**签名（Mana）路径不读 provider**；适配器是为需要链上读取的策略预留的钩子（已读 sx.js 源码确认 `getStrategiesWithParams` 只用 `networkConfig`）。
- **提案标识**：链下提案 id 全局唯一（哈希）；SX 提案 id 只在 space 内唯一，故路由用 `/proposal/<proposal_id>?space=0x…`。
- **投票窗口**：SX 持续到 `max_end`（不是 `min_end`），已正确映射为 `maxEnd`。
- **结果**：索引器把分数拆成 `scores_1/2/3_parsed` + `scores_total_parsed`（最多 3 个选项），已映射为 `scores[]`。
- **部分数据**：索引器可能返回「部分 data + 行级 errors」（实测：某 space `metadata` 为 null）。`sxGraphqlRequest` 仅在**无可用 data** 时才抛错。

## 4. 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_SX_API` | `https://api.snapshot.box` | SX 多链索引器 |
| — | `https://mana.snapshot.box` | 免 Gas 中继（代码内默认，未 env 化） |
| — | `https://wls.snapshot.box` | 策略白名单服务（同上） |

支持的 EVM 网络（`SxEvmNetworkId`）：`ethereum / optimism / arbitrum / base / sepolia`，由索引器 `_indexer` 字段映射（`oeth → optimism` 等）。

## 5. 验证方式

```bash
# 常规套件（离线，live 用例跳过）
cd apps/web && ./node_modules/.bin/vitest run

# opt-in：打真实索引器
cd apps/web && SX_LIVE=1 ./node_modules/.bin/vitest run src/lib/sx/api.test.ts
```

用于验证的真实 **Optimism** space：**Ryu0x167 Space Command** `0x03C7431e14F7b759Aa44398AD7901e6053c197Bf`（`_indexer: oeth`，12 提案 / 36 票）。可在 dev 预览用 Explore 的「打开链上空间」进入。

CORS 已确认：`api.snapshot.box` 返回 `access-control-allow-origin: *`，浏览器可直连。

## 6. 已知限制 / 待办

- **真实投票尚未端到端验证**：需要一个持有投票权的 SX space——目前找到的都属他人（Ryu0x167 的提案均为 2024 年已关闭）。只读、结果、投票预检、payload 构造均已验证。
- **结果最多 3 个选项**：索引器只暴露 `scores_1/2/3`。
- **SDK chunk 较大**（~851 KB，含 starknet）；如官方后续提供按模块导出可优化。
- **未接 SX 提案创建**：只能投票，不能创建（与链下一致，均未实现创建 UI）。
- **Mana 免 Gas 依赖空间余额**：低于阈值会关闭（官方说明）。
