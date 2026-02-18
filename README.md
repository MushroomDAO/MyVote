# MyVote
Another simple voting system for any communities with free and full service.
Created with Snapshot frontend, integrat the AirAccount plugin to get login with any Web2 account and your finger print: Email, Google Account, Wechat, Twitter and more. 
这份关于 Snapshot 及其周边治理体系的深度调研报告旨在为您澄清概念、分析架构，并为您的开发方向（做皮肤 vs Fork vs 新造）提供决策依据。

以下是详细的研究报告：

---

# Snapshot 及去中心化治理（DAO）体系调研报告

## 1. 核心概念澄清：Snapshot 到底是什么？

首先需要纠正一个常见的误区：**Snapshot 本质上是一个“链下（Off-chain）”投票系统，而不是全链上系统。**

* **链下投票（Off-chain）：** 用户投票时不需要支付 Gas 费，不需要在区块链上发送交易。用户只是对一条消息进行“加密签名”（EIP-712 签名），这证明了“我同意这个提案”。
* **数据存储：** 签名后的数据被存储在 **IPFS**（去中心化文件系统）上，而不是直接存在以太坊区块里。
* **结果统计：** Snapshot 的服务器（或任何人运行的节点）通过读取链上的代币快照（Snapshot）来计算此时此刻用户有多少票权，然后统计 IPFS 上的签名来得出结果。

**为什么它能统治市场？**
因为它**免费**（无 Gas 费）。全链上投票（如 Compound 的 Governor 合约）每投一票都要几十美元 Gas，这会极大阻碍社区参与。

---

## 2. Snapshot 的核心业务流程

Snapshot 的运作流程分为三个阶段：**提案、投票、执行**。

### 流程图解

1. **快照（Snapshot）阶段：**
* 当提案创建时，系统会记录当前的“区块高度”。
* 用户的投票权重（Voting Power）是基于该特定区块高度时，用户钱包里持有的代币数量计算的。这防止了提案发布后有人临时买币刷票。


2. **投票（Voting）阶段：**
* 用户连接钱包。
* 用户选择选项，点击投票。
* 钱包弹出“签名请求”（Sign Message），用户确认。
* 签名数据上传至 IPFS。


3. **计票与验证（Calculation）：**
* Snapshot 的后端（Hub）拉取 IPFS 数据。
* 根据预设的**策略（Strategies）**（例如：1 Token = 1 票，或者 NFT 算票），调用链上数据计算权重。
* 前端展示最终结果。


4. **执行（Execution - 关键点）：**
* 由于投票是在链下进行的，它**不能自动触发**链上合约的转账或修改。
* **传统方式：** 多签钱包（Gnosis Safe）的管理员根据投票结果，手动去链上执行操作（依赖人的信用）。
* **进阶方式（SafeSnap/Zodiac）：** 引入预言机（如 Reality.eth）。如果投票通过，Reality.eth 会将结果传回链上，触发 Gnosis Safe 自动执行交易。这实现了“链下投票，链上执行”。



---

## 3. 技术架构与合约分析

您问到“主要的合约有哪些”，这里有一个重要的区分：

### A. 核心投票部分（几乎没有合约）

Snapshot 的核心逻辑不在合约里，而在 **JavaScript 库** 和 **IPFS** 中。

* **Snapshot.js:** 这是一个客户端 SDK，用于处理签名、上传 IPFS、获取提案等。
* **Snapshot Hub:** 服务器端代码，用于索引和存储数据。

### B. 策略合约（Strategies）

Snapshot 依赖“读取”链上合约来计算票数。它支持数百种策略，例如：

* **ERC-20 Balance:** 读取标准的代币合约。
* **ERC-721:** 读取 NFT 合约。
* **Staking Contracts:** 读取质押在挖矿池里的代币。
* *开发者可以编写自定义的 JavaScript 策略来适配任何复杂的合约逻辑。*

### C. 执行层合约（Reality.eth + Safe）

如果要做自动执行，会涉及以下合约：

* **Gnosis Safe (现为 Safe):** 多签资产管理合约。
* **Zodiac Module / Reality.eth:** 这是一个桥接合约，负责验证链下的 Snapshot 结果是否真实，并通知 Safe 执行交易。

---

## 4. 开发决策分析：做皮肤、Fork 还是自研？

根据您的需求（提供一个简单的提案投票表决完备流程），以下是三种路径的利弊分析：

### 路径一：基于 Snapshot 开发前端（做“皮肤”）—— **强烈推荐**

* **逻辑：** 利用 Snapshot 现有的后端基础设施（Hub）和数据，自己写一个前端 UI。
* **优点：**
* **开发快：** 直接使用 `Snapshot.js` 和 GraphQL API。
* **生态互通：** 您的用户在您的界面投的票，在 Snapshot 官网也能看到，数据是通的。
* **零 Gas：** 继承了 Snapshot 的免 Gas 特性。
* **无需维护节点：** 不用自己跑 IPFS 节点和数据库。


* **缺点：** 核心数据依赖 Snapshot 的服务器（虽然数据在 IPFS，但索引依赖他们）。

### 路径二：Fork Snapshot（私有化部署）

* **逻辑：** 复制 Snapshot 的整套 Hub 和前端代码，自己跑一套独立的投票系统。
* **优点：** 数据完全掌控，UI 可以魔改，品牌完全独立。
* **缺点：**
* **维护成本极高：** 您需要维护 IPFS 节点、数据库索引服务。
* **孤岛效应：** 您的投票系统与其他生态不互通。


* **适用场景：** 只有当您需要非常特殊的投票逻辑（Snapshot 不支持的），或者对数据隐私/主权有极高要求时才考虑。

### 路径三：全链上合约开发（Governor 体系）

* **逻辑：** 不用 Snapshot，直接 Fork **OpenZeppelin Governor** 或 **Compound Governor Bravo** 合约。
* **优点：**
* **最安全：** 代码即法律，去中心化程度最高。
* **自动执行：** 投票通过后，合约自动执行代码，无需人介入。


* **缺点：**
* **贵：** 用户每次投票都要付 Gas 费。
* **门槛高：** 部署和审计合约成本高。


* **注：** Snapshot 正在开发 **Snapshot X**（基于 StarkNet 的 L2 链上投票），试图解决这个问题，但目前尚未完全普及。

---

## 5. 行业调研：链上 vs 链下治理体系对比

为了帮您做彻底的调研，我们将目前的治理体系分为两派：

| 特性 | **Snapshot 模式 (链下信号)** | **Governor 模式 (全链上治理)** |
| --- | --- | --- |
| **代表项目** | Snapshot, Aragon (部分) | Compound, Uniswap, Tally |
| **成本 (Gas)** | **0 (免费)** | 高 (随 ETH 网络波动) |
| **门槛** | 极低，持币即可签各名 | 较高，需钱包有 ETH 余额 |
| **安全性** | 中等 (依赖多签持有人的诚信或预言机) | 高 (无需信任人，代码自动执行) |
| **数据存储** | IPFS (链下) | 区块链 (链上) |
| **开发难度** | 低 (Web2 开发体验) | 高 (Solidity 开发 + 审计) |
| **适用场景** | 95% 的 DAO，社区意见征集，参数调整 | 头部 DeFi 协议，资金库管理，协议升级 |

---

## 6. 最终建议与下一步

### 核心建议

如果您想为社区提供一套流畅、完备的治理流程，**不建议直接写新的 Solidity 投票合约**（除非您做的是像 Uniswap 那样几百亿美金的协议），也**不建议 Fork Snapshot 的后端**。

**最佳路径是：基于 Snapshot 的 SDK 构建定制化前端（Custom Frontend）。**

**具体实施方案：**

1. **前端框架：** 使用 React/Vue + Ethers.js。
2. **数据交互：** 使用 Snapshot 的 **GraphQL API** 获取提案列表、投票详情。
3. **投票动作：** 使用 **Snapshot.js** 库在前端唤起钱包签名，并推送到 Snapshot Hub。
4. **执行闭环：** 如果需要完备流程，集成 **Safe (Gnosis Safe)**。在您的前端界面里展示：“投票通过 -> 等待多签执行 -> 已执行”的状态流转。

### 我可以为您做的 Next Step

如果您决定采用“定制化前端”这个方案，我可以为您生成一份 **《基于 Snapshot.js 的投票 DApp 技术架构文档》**，包含：

* 如何调用 GraphQL 获取数据的示例代码。
* 如何实现 EIP-712 签名的核心代码片段。
* 前端路由结构设计。

您需要我为您出这份技术文档吗？
