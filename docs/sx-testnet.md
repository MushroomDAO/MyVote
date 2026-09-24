# Snapshot X 测试网（Sepolia）实测记录

> **最后更新**：2026-09-24
> **结论**：官方有 SX 测试网，而且我们已经在 **Sepolia 上自建 SX space + 提案 + Jason/Anni 两票真实链上投票**，签名走的是 MyVote 同款 `EvmEthereumSig` 信封。本文记录官方测试网地图、复现步骤、真实凭据与踩坑。

---

## 1. 官方 SX 测试网地图（来自官方仓库）

| 项 | 生产 | 测试网 |
|---|---|---|
| SX 索引器 GraphQL | `https://api.snapshot.box` | **`https://testnet-api.snapshot.box`** |
| SX 创建入口 | `snapshot.box/#/create/snapshot-x` | **`testnet.snapshot.box/#/create/snapshot-x`** |
| Mana 中继 | `https://mana.snapshot.box` | 同域名，按链路由 `/eth_rpc/<chainId>` |

`sx.js` 里配置的 SX 测试网（`packages/sx.js/src/evmNetworks.ts`、`starknetNetworks.ts`）：

| 网络 id | 链 | chainId | 备注 |
|---|---|---|---|
| `sep` | Ethereum Sepolia | 11155111 | 本文用的 |
| `basesep` | Base Sepolia | 84532 | 含 Inco 隐私投票部署 |
| `bnbt` | BNB Chain testnet | 97 | 索引器里有历史 space |
| `curtis` | ApeChain testnet | 33111 | 含 ApeGas |
| `sn-sep` | Starknet Sepolia | SN_SEPOLIA | Starknet 侧 |

官方 UI（`apps/ui/src/networks/evm/metadata.ts`）对这些网络走 `API_TESTNET_URL`，即 `https://testnet-api.snapshot.box`；主网网络才走 `api.snapshot.box`。所以**主网索引器里查不到测试网 SX space**，这不是数据问题。

```bash
# 主网索引器：sep 查不到
curl -s -X POST https://api.snapshot.box -H 'content-type: application/json' \
  --data '{"query":"{ spaces(first: 5, where: { _indexer: \"sep\" }) { id } }"}'
# => {"data":{"spaces":[]}}

# 测试网索引器：有真实 space / proposal
curl -s -X POST https://testnet-api.snapshot.box -H 'content-type: application/json' \
  --data '{"query":"{ spaces(first: 5, where: { _indexer: \"sep\" }) { id proposal_count } }"}'
```

---

## 2. 本次实测的真实凭据

| 项目 | 值 |
|---|---|
| SX space（Sepolia） | `0xab081eDC235ED3A2863B1dAd7410Aa6FAE80C1ab`（`_indexer: sep`） |
| space controller | Jason `0xb5600060e6de5E11D3636731964218E53caadf0E` |
| 部署 space tx | `0x229ff0873594552345b00d9ef4001580fd29e14fff3553cd48f914af3c051fc0` |
| 提案 | `0xab081eDC235ED3A2863B1dAd7410Aa6FAE80C1ab/1`（state `active`） |
| 建提案 tx | `0x3eff5e8fa0c093a51d4af2a86227dcf6506dbe354777f5053fe4a567ae44769b` |
| Jason 投票（choice 1） | `0x6273a4169a54368d04cd20bde5473c223a717157319f02928c223ffa4c395020` |
| Anni 投票（choice 2） | `0x542fc1af781c58eee57d6632c27ec2a60f922fe5d4d7231edc408363583dae45` |
| 计票 | `vote_count 2`、`scores_total_parsed 2` |

space 参数：`authenticators = [EthSig, EthTx]`、`votingStrategies = [Vanilla]`、`validationStrategy = VotingPower`、`votingDelay 0`、`minVotingDuration 60`、`maxVotingDuration 86400`（SX 的时长单位是**区块**）。

---

## 3. 复现步骤

### 3.1 部署自己的 space（1 笔交易）

用 `@snapshot-labs/sx` 的 `clients.EvmEthereumTx.deploySpace`，`networkConfig = sx.evmSepolia`：

```ts
const validationParams = new AbiCoder().encode(
  ['uint256', 'tuple(address addr, bytes params)[]'],
  [1, [{ addr: VANILLA, params: '0x00' }]]   // threshold 1；Vanilla = 人人 1 票
)

await client.deploySpace({
  signer,                                     // ethers v5 Signer（@ethersproject/wallet）
  params: {
    controller: me,
    votingDelay: 0,
    minVotingDuration: 60,
    maxVotingDuration: 86400,
    proposalValidationStrategy: { addr: VOTING_POWER, params: validationParams },
    proposalValidationStrategyMetadataUri: '',
    daoUri: '',
    metadataUri: '',
    authenticators: [ETH_SIG, ETH_TX],        // EthSig 让 MyVote 能投；EthTx 方便直接建提案
    votingStrategies: [{ addr: VANILLA, params: '0x' }],
    votingStrategiesMetadata: ['']
  }
})
```

Sepolia 上的关键地址（`sx.evmSepolia`）：proxyFactory `0x4B4F7f64…631c`、masterSpace `0xC3031A7d…CE4D`、EthSig `0x5f9B7D78…e260`、EthTx `0xBA06E6cC…Aed1`、Vanilla `0xC1245C5D…c202`、VotingPower `0x6D9d6D08…f311`。

### 3.2 建提案

用 `EvmEthereumTx.propose`（EthTx 认证器，直接发交易）：

```ts
const envelope = {
  data: {
    space: SPACE,
    authenticator: ETH_TX,
    strategies: [{ index: 0, address: VANILLA, params: '0x' }],
    executionStrategy: { addr: '0x0000000000000000000000000000000000000000', params: '0x' },
    metadataUri: ''
  }
}
await client.propose({ signer, envelope })
```

> **提案 id 从 1 开始**（`nextProposalId` 初始为 1），不是 0；用 0 投票会 revert `InvalidProposal`。

### 3.3 投票

签名用 MyVote 同款 `clients.EvmEthereumSig.vote()`（`lib/sx/backend.ts` 也是它），得到 EIP-712 信封后提交：

* **主网**：`send(envelope)` → Mana 代付 gas。
* **测试网**：见 §4，公开 Mana 在 Sepolia 上的中继钱包没 gas，需要自己提交 `EthSigAuthenticator.authenticate(v, r, s, 0, space, selector, calldata)`。

---

## 4. 关键发现：公开 Mana 在 Sepolia 上没有 gas

```bash
curl -s -X POST https://mana.snapshot.box/eth_rpc/11155111 -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"send","params":{"envelope":{ ... }},"id":null}'
```

返回：

```json
{"jsonrpc":"2.0","error":{"code":500,"message":"unauthorized",
 "data":{"reason":"insufficient funds for intrinsic transaction cost",
 "error":{"body":"{\"error\":{\"code\":-32003,\"message\":\"insufficient funds for transfer\"}}"}}}}
```

即 Mana 的中继钱包 `0xc187dcd9f4a82ce4d9f57081104becc54a412eef` 在 Sepolia 上余额为 0，`eth_estimateGas` 就失败了。**结论：通过公开 Mana 在 SX 测试网做 gasless 投票目前不可行**（主网 Optimism 等链路正常，见 `SX_LIVE=1` 中继连通性检查）。

绕过方式（本次采用）：`EvmEthereumSig.vote()` 只负责签名，自己把信封提交上链——这正是 Mana 在做的两件事（编码 + 用有 gas 的账户发交易）。这样验证的是**签名信封本身**是否被 SX 合约接受。

---

## 5. 其它踩坑

1. **`testnet-api.snapshot.box`**（连字符）才是测试网索引器；`testnet.api.snapshot.box` 不存在。
2. **主网索引器查不到测试网 space**（`api.snapshot.box` 只索引主网链）；用测试网 space 时把 `VITE_SX_API` 指到测试网索引器。
3. **提案 id 从 1 起**；**投票时长单位是区块**（`minVotingDuration` / `maxVotingDuration`）。
4. **`Choice` 的值以链上事件为准**：本次 `VoteCast` 事件里 choice 就是 1 / 2，但索引器 `votes.choice` 把第二票写成 3、分数落到 `scores_3_parsed`。不要用索引器的 `choice` 判定「投给了哪个选项」，至少对 `type: basic` 的提案保持怀疑。
5. Sepolia 上已有的 `sep` space 提案**全是 closed**（2024 年建的，窗口只有几十秒），所以「在别人的 space 上投票」走不通，必须自建 space。
6. `executionStrategy = { addr: 0, params: '0x' }` 可以建提案（合约不校验非零），只是不能执行。

---

## 6. 对 MyVote 的意义

- `lib/sx/backend.ts` 的 `EvmEthereumSig` 信封**已被真实 SX 合约接受**（本次两票都是它签的）。
- 想在 MyVote 里读 / 投测试网 SX space：
  - `VITE_SX_API=https://testnet-api.snapshot.box`（`INDEXER_TO_NETWORK` 已有 `sep → sepolia`，`SX_EXPLORERS`、`SX_EVM_CHAIN_IDS` 也都有 sepolia）；
  - 投票仍会卡在 Mana（§4），要么自建中继，要么在测试网接受「手动提交」。
