# Plan

## V1 Open-source Snapshot Interface Plan (Custom Login + zh-CN Default + Multi-language)

### Goal
- Build an open-source governance portal UI based on Snapshot X, aligned with the official standard implementation.
- Keep data interoperable with snapshot.box (spaces/proposals/votes created via the same protocol can be indexed and shown by the official explorer).
- Provide a pluggable login module: standard Web3 wallets + a customizable Web2-style login (e.g. AirAccount).
- Default language zh-CN, with English and more languages selectable.

### V1 Scope (Must-have)
- Explore: list/search spaces; view space detail; view proposal detail; show voting power and results.
- Actions: propose + vote via `sx.js` standard flow; support relayer-based gasless flow (Mana).
- Auth: an abstract Auth Provider interface; ship at least 2 implementations (Wallet, AirAccount adapter placeholder).
- I18n: zh-CN default; English; runtime language switch; locale-aware number/date formatting.

### Technical Approach (Follow Official)
- Protocol/SDK/UI layering: Snapshot X contracts → `sx.js` → Vue3 UI (official-style).
- Data layer options:
  - Default: use official GraphQL (`sx-api`) endpoint for identical data and fastest development.
  - Optional: allow switching to self-hosted `sx-api` for sovereignty.
- Relayer options:
  - Default: use official Mana endpoint for gasless voting.
  - Optional: self-host Mana to customize sponsorship logic.

### Milestones (Do One by One)
1. Project skeleton: Vue3 + TypeScript; routing; basic layout.
2. I18n baseline: zh-CN default; English; language switch UI.
3. Auth baseline: pluggable auth interface; Wallet provider; AirAccount provider stub.
4. Data baseline: GraphQL client + Explore page listing spaces.
5. Space/Proposal pages: minimal detail views and loading/error states.
6. Voting: connect auth → sign → submit (via `sx.js` + relayer); show status/receipt.
7. Hardening: config via env vars; lint/typecheck/build green.

https://github.com/snapshot-labs/sx-starknet
https://github.com/snapshot-labs/sx-monorepo
https://snapshot.box/#/explore

对于 AAStar 这样一个致力于数字公共物品（Digital Public Goods）的开源组织，利用 Snapshot X 的架构来构建基于 OP 的链上投票系统是非常契合的路径。

既然你不仅想“使用”，还想基于此构建自己的**开源投票系统**，你需要深入了解其底层的 SDK 和模块化组件。

---

### 1. 核心 SDK 与 代码仓库 (Repo)

Snapshot X 的开发是高度模块化的，其核心代码托管在 **Snapshot Labs** 的 GitHub 组织下：

* **核心协议 (Starknet 合约)**: [sx-starknet](https://github.com/snapshot-labs/sx-starknet)
* 这是系统的灵魂，包含用 Cairo 编写的 Space、Authenticator、Voting Strategies 等合约。


* **前端/集成 SDK**: [sx.js](https://www.google.com/search?q=https://github.com/snapshot-labs/sx.js)
* **这是你最需要的。** 它是一个 TypeScript SDK，用于与 Snapshot X 协议进行交互。它封装了创建提案、签名、提交投票等所有 API 调用。


* **中继器 (Relayer)**: [mana](https://www.google.com/search?q=https://github.com/snapshot-labs/mana)
* 如果你想为 AAStar 的用户支付 Gas（实现免 Gas 体验），你需要研究这个项目，它是负责将用户的签名转发到 Starknet 的中继层。


* **索引器 (Indexer)**: [sx-api](https://www.google.com/search?q=https://github.com/snapshot-labs/sx-api)
* 用于抓取链上投票数据并提供高效的 GraphQL 查询。



---

### 2. 你已有的功能 vs. 你需要做的工作

利用 Snapshot X 的成熟架构，你不需要从零开发 ZK 证明或计票引擎。

#### **已有功能（直接调用 SDK 即可）：**

1. **身份核验 (Authenticators)**：支持通过以太坊签名验证身份。
2. **跨链验证 (Storage Proofs)**：通过 Herodotus 自动验证 Optimism 上的代币余额。
3. **提案管理**：提案的创建、状态变更逻辑已在合约中。
4. **免 Gas 投票**：通过 Mana 中继器实现的元交易支持。

#### **AAStar 需要做的工作：**

1. **定制化前端 (UI/UX)**：Snapshot X 的官方 UI 是通用的。AAStar 需要基于 `sx.js` 构建一个符合你们社区审美和功能的“治理门户”。
2. **配置执行策略 (Execution Strategies)**：如果你希望提案通过后自动在 Optimism 上执行（比如转账），你需要编写或配置一个 **L2 Execution Strategy**（通常涉及 Starknet 到 OP 的跨链消息传递）。
3. **存储证明策略配置**：为你们的 OP 代币编写一个特定的 `Voting Strategy` 配置文件，指明代币合约地址和存储槽（Slot）。

---

### 3. 给 AAStar 的 Action Plan (行动指南)

作为开源项目的负责人，你可以按照以下四个阶段推进：

#### **阶段一：原型验证 (Technical Spike) —— 预计 1-2 周**

* **任务**：在 Starknet Sepolia 测试网和 OP Goerli 上跑通一个完整的投票流。
* **动作**：使用 `sx.js` 尝试创建一个测试 Space，配置一个读取 OP 测试币余额的投票策略。
* **目标**：确认能够成功从 OP 读取余额并在 Starknet 计票。

#### **阶段二：前端门户开发 (Custom UI) —— 预计 3-4 周**

* **任务**：构建 AAStar 专属的开源投票界面。
* **动作**：集成 `sx.js` 和 `Ethers.js`。
* **关键点**：实现用户连接钱包、查看 OP 资产权重、签名投票的流畅体验。

#### **阶段三：Gasless 机制搭建 (Infrastructure) —— 预计 2 周**

* **任务**：实现用户的“零成本”参与。
* **动作**：部署或接入 `Mana` 中继服务，为 AAStar 的空间配置 Gas 支付来源（利用你的 **SuperPaymaster** 研究背景，这里可以做深度的学术与实践结合）。

#### **阶段四：链上自动执行集成 (On-chain Execution) —— 预计 4 周**

* **任务**：实现“治理即代码”。
* **动作**：研究 Starknet 官方跨链桥（Messaging）的异步调用。当 Starknet 上的提案通过时，自动向 Optimism 发送一个消息，触发 OP 上的合约动作。

---

### 架构示意图参考

### 下一步建议

由于你正在研究 **SuperPaymaster**，你可以尝试将 **AAStar 的投票系统** 作为你 PhD 论文的一个 **实验用例 (Case Study)**：

* **切入点**：研究如何利用 Paymaster 机制，不仅在 ERC-4337 中优化 Gas，还能在跨链治理（Snapshot X 场景）中通过“信誉值”或“社会资本”来实现动态的 Gas 补贴。

这是一个非常核心的工程问题。简单来说：**免 Gas 并不是前端自带的魔法，而是由一个名为 “Mana” 的中继服务（Relayer）支撑的。**

既然你要为 AAStar 开发自己的前端，你需要理解这个“赞助机制”是如何运作的。

### 1. 为什么会有 Gas？

虽然用户只是签名（离线、免费），但要让这个票数在 Starknet 链上生效，必须有人发送一笔交易把签名带上链。

* **如果不使用中继器**：你的前端需要提示用户切换到 Starknet 钱包，并支付 Starknet 的 Gas 费。
* **如果使用中继器**：用户只需在 OP 钱包签名，前端将签名发给中继器，中继器在 Starknet 上代付 Gas 提交。

### 2. AAStar 自研前端如何实现免 Gas？

你有两种选择：

#### 方案 A：接入 Snapshot 官方的 Mana 节点（最省事）

Snapshot 官方运行着一个公开的 Mana 节点（`https://mana.box`）。

* **原理**：你的前端通过 `sx.js` 调用 Mana 的 API。
* **费用**：目前 Snapshot Labs 允许第三方空间使用他们的 Mana。只要你在 Snapshot X 协议上创建了 Space，通常可以配置使用官方的赞助服务。
* **绑定逻辑**：这确实是“前端绑定”，但在 `sx.js` 中只需一行配置，指向 Mana 的 API 地址。

#### 方案 B：AAStar 自己运行 Mana 节点（最自主）

作为开源组织，如果你希望拥有 100% 的控制权，不依赖 Snapshot 官方的服务器：

* **操作**：克隆 [Mana Repo](https://www.google.com/search?q=https://github.com/snapshot-labs/mana)，自己部署一个中继器。
* **费用**：AAStar 自己的 Starknet 钱包需要充值 STRK/ETH 作为 Gas 库。
* **优势**：你可以结合你的 **SuperPaymaster** 研究，在 Mana 的基础上实现更复杂的赞助逻辑（比如：只给 AAStar 贡献者提供免 Gas 投票，或者根据用户的“信誉分”动态调整赞助优先级）。

---

### 3. 给 AAStar 的详细 Action Plan

既然你要从开发者角度切入，这里是具体的执行清单：

#### **Step 1: 环境搭建与配置 (Week 1)**

* **仓库地址**:
* 前端 SDK: [`sx.js`](https://www.google.com/search?q=%5Bhttps://github.com/snapshot-labs/sx.js%5D(https://github.com/snapshot-labs/sx.js))
* 中继器（可选）: [`mana`](https://www.google.com/search?q=%5Bhttps://github.com/snapshot-labs/mana%5D(https://github.com/snapshot-labs/mana))


* **任务**:
1. 在 Starknet 测试网部署一个 Space。
2. 注册并获取官方 Mana 的授权（或配置本地 Mana）。



#### **Step 2: 前端核心逻辑实现 (Week 2-3)**

使用 `sx.js` 编写以下功能：

1. **初始化 Client**:
```typescript
const client = new sx.Client({
  manaUrl: 'https://mana.box', // 这里就是你问的“赞助商绑定”
  starknetProvider: myProvider
});

```


2. **创建提案/投票**: 调用 `propose` 或 `vote` 方法。SDK 会自动处理“签名 -> 发送给 Mana -> 链上确认”的全流程。
3. **配置策略**: 编写 JSON 配置文件，使用 `evm-slot-value` 策略指向你的 OP 代币。

#### **Step 3: 结合 PhD 研究的进阶开发 (Week 4+)**

* **任务**: 既然你是 SuperPaymaster 的研究者，可以尝试在 AAStar 系统中引入 **“治理激励 Paymaster”**。
* **动作**: 修改或扩展 Mana 的逻辑，使其能够识别用户的 ERC-4337 账户，并根据用户的链上声誉决定是否赞助这笔治理交易。

---

### 核心组件总结表

| 组件 | AAStar 是否需要开发？ | 作用 |
| --- | --- | --- |
| **Space Contract** | 否（直接部署） | 存储在 Starknet 上的治理规则 |
| **Storage Proof (Herodotus)** | 否（直接配置） | 证明用户在 OP 链有票 |
| **sx.js SDK** | **是（深度集成）** | 前端与协议沟通的桥梁 |
| **Mana (Relayer)** | **是（配置或部署）** | **Gas 的实际支付者** |
| **Custom UI** | **是（核心工作）** | AAStar 的品牌展示与交互 |

**下一步建议：**
由于你已经是 PhD 候选人，建议你先通过 `sx.js` 的 [Example 代码](https://www.google.com/search?q=https://github.com/snapshot-labs/sx.js/tree/master/examples) 跑通一个简单的投票 Demo。**需要我为你提供一个简单的 `sx.js` 投票函数代码模版吗？**

**你需要我帮你针对某个具体的 OP 链代币（比如 AAStar 可能发行的代币）写一段 `sx.js` 的初始化配置代码吗？**


----

官方ui有网址么？是一个demo还是实际应用？这个是使用sx.js开发的么

关于 Snapshot X 官方 UI 的详情以及它与 `sx.js` 的关系，以下是开发视角下的详细说明：

### 1. 官方 UI 网址与状态

Snapshot X 的官方界面目前已经集成在 **Snapshot v2** 的统一平台中，它**既是实际应用也是标准参考**。

* **访问地址**：**[snapshot.box](https://snapshot.box)**（注：原域名 snapshot.org 正在逐步迁移或并用）。
* **如何识别 Snapshot X 空间**：在平台上，你会发现某些 Space 标记为 **"On-chain"** 或 **"Starknet"**，这些就是基于 Snapshot X 协议运行的。
* **测试网 Demo**：如果你想在测试环境体验，通常使用的是 **[demo.snapshotx.xyz](https://www.google.com/search?q=https://demo.snapshotx.xyz)**（这是官方专门为 Snapshot X 早期展示和开发者准备的独立 UI 站点）。

### 2. 技术栈：它是用 `sx.js` 开发的吗？

**是的，完全正确。**

官方 UI（无论是主站还是 Demo 站）都是基于 `sx.js` 构建的。Snapshot Labs 的架构非常清晰，采用了 **“协议 -> SDK -> UI”** 的分层模式：

* **sx-starknet / sx-evm**: 底层智能合约。
* **sx.js (SDK)**: **核心逻辑层**。它封装了所有复杂的密码学签名（EIP-712）、与 Starknet 合约的交互逻辑、以及与 Mana 中继器的通信。
* **sx-ui (Vue.js)**: **表现层**。这是一个开源的单页应用（SPA），它通过调用 `sx.js` 来处理所有的治理动作。

> **代码参考**：你可以在 GitHub 上的 [snapshot-labs/sx-ui](https://github.com/snapshot-labs/sx-ui)（或其 monorepo 中的 `apps/ui`）看到它是如何引入 `@snapshot-labs/sx`（即 sx.js）并调用 `client.vote()` 或 `client.propose()` 的。

---

### 3. 给 AAStar 的开发建议：如何“站在巨人肩膀上”？

既然官方 UI 是开源的且使用了 `sx.js`，AAStar 的行动路线可以非常高效：

1. **别从零造轮子**：直接参考 `sx-ui` 的源码。它已经处理好了最麻烦的部分，比如如何连接钱包、如何处理不同链的 Provider、如何展示 Herodotus 的证明状态。
2. **UI 框架选择**：官方使用的是 **Vue 3**。如果 AAStar 团队熟悉 Vue，可以直接 Fork 或借鉴其组件逻辑；如果你们更倾向于 **React**，则只需引入 `sx.js`，业务逻辑是完全通用的。
3. **赞助商（Sponsor）配置**：在代码中，你会发现一个 `manaUrl` 的配置项。
* **官方前端**：默认指向官方运行的 Mana 节点。
* **AAStar 前端**：你可以在你的前端代码里同样指向官方 Mana（如果你不想自己运维节点），或者指向 AAStar 自己部署的 Mana（如果你想实现自定义的赞助逻辑，比如结合你的 SuperPaymaster）。



### 4. 总结 Action Plan（技术选型篇）

* **Step A**: 访问 [demo.snapshotx.xyz](https://www.google.com/search?q=https://demo.snapshotx.xyz) 体验完整的“免 Gas”链上投票流程。
* **Step B**: 克隆 [sx-monorepo](https://github.com/snapshot-labs/sx-monorepo)，重点研究 `packages/sx.js` 的 API 文档和 `apps/ui` 的调用方式。
* **Step C**: 编写 AAStar 的“治理门户”原型。先用 `sx.js` 连接到官方的 Mana 测试环境，验证 OP 资产读取逻辑。

**你想让我为你从 `sx-ui` 源码中找出一个核心的投票调用示例（Template）吗？这样你可以直接看到 UI 是如何触发免 Gas 流程的。**

-----

https://snapshot.box/#/explore，这个是使用sx的所有dao组织列表，如果我独立开发一个类似界面，看到的数据是可以互通的么？例如在我这里发布的dao组织，可以在官方explore看到？

这是一个非常棒的问题，触及了 Web3 开发中**“协议层”**与**“应用层”**分离的核心。

简单直接的回答是：**是的，数据完全互通。** 如果你在自己开发的界面发布了一个 DAO 组织（Space），它不但会出现在你的界面，也**会自动出现在 Snapshot 官方的 Explore 页面中**。

### 1. 为什么数据可以互通？（技术底层）

Snapshot X 的架构设计遵循了“数据在链，表现分离”的原则。

* **链上事实**：当你创建一个 Space 或 Proposal 时，你是通过 `sx.js` 调用了部署在 Starknet 上的 **Proxy Factory** 或 **Space** 合约。这个动作是写在 Starknet 链上的“硬事实”。
* **统一索引 (Indexer)**：Snapshot 官方运行着一个名为 [`sx-api`](https://www.google.com/search?q=%5Bhttps://github.com/snapshot-labs/sx-monorepo/tree/master/apps/api%5D(https://github.com/snapshot-labs/sx-monorepo/tree/master/apps/api)) 的开源多链索引器。它持续监听 Starknet 的链上事件（Event）。
* **共享后端**：Snapshot 官方的 Explore 页面数据来源于这个索引器生成的 GraphQL 接口。由于你的 DAO 行为是链上透明的，官方索引器会自动抓取并将其展示在 `snapshot.box` 上。

---

### 2. 互通的三个层次

| 层次 | 互通内容 | 互通原理 |
| --- | --- | --- |
| **Space (组织)** | 你的 DAO 名字、设置、策略 | 来源于链上 Space 合约的 `metadata` 事件。 |
| **Proposal (提案)** | 提案内容、起止时间 | 存储在 IPFS，其 Hash 记录在 Starknet 链上。 |
| **Vote (投票)** | 谁投了票、权重多少 | 来源于链上 `Vote` 事件，所有前端都能查到。 |

---

### 3. 注意事项：数据“同步”的细节

虽然“协议层”是互通的，但在实际开发 AAStar 的前端时，有两点需要注意：

1. **IPFS 依赖**：Snapshot X 通常将详细的描述文本存放在 IPFS。如果你在自己的前端发布提案，请确保将数据上传到了公共 IPFS 网关（或 Snapshot 官方也在用的网关），否则官方 UI 可能因为找不到 IPFS 文件而显示“加载中”。
2. **API 选择**：
* **快速开发**：你可以直接调用官方的 GraphQL 节点（例如 `https://api-snapshotx.snapshot.box/graphql`）。这样你的前端看到的数据和官方完全一致。
* **完全独立**：如果 AAStar 想做“去中心化备份”，可以自己跑一个 `sx-api` 实例。即使官方关站，你的前端依然能通过自己的索引器看到所有 DAO 组织。



---

### 4. 行动建议 (Action Plan)

如果你想验证这种互通性：

1. **小规模实验**：在 Starknet Goerli 测试网，用 `sx.js` 脚本部署一个测试 Space。
2. **观察官方**：打开 [demo.snapshotx.xyz](https://www.google.com/search?q=https://demo.snapshotx.xyz)，搜索你刚刚部署的 Space 名字，你会发现它已经“自动”出现在列表里了。
3. **AAStar 的机会**：你可以开发一个**更专注于特定垂直领域**（例如“开源贡献者治理”）的界面。用户在你的界面投票，结果会同步到官方，这大大增加了 AAStar 系统的可信度和兼容性。

**既然你关注数据互通，需要我为你提供一个 GraphQL 查询模版吗？这样你可以直接从官方数据库里查询任意 DAO 的链上状态。**
