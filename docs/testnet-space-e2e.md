# 测试网 Space 全流程验证（Sepolia · 链下 Snapshot）

> **最后更新**：2026-09-24
> **结论**：MyVote 在 **Snapshot testnet hub** 上跑通了「注册 ENS 名 → 建 space → 建提案 →
> 真实投票」的完整链路，投票走的就是 MyVote 自己的写路径 `castVote()`。
> 本文记录可复现步骤、真实凭据与踩坑，供后续 onboarding / 回归使用。

---

## 1. 验证结果

| 项目 | 值 |
|---|---|
| Space | `myvote-demo.eth`（Hub 里 `network = "11155111"`） |
| ENS 名（Sepolia ENSv2） | `myvote-demo.eth`，owner `0xb5600060e6de5E11D3636731964218E53caadf0E`（Jason） |
| 建 space 回执 | `0x74754aef021d7276b2f327ef5592d9891436c10de1a5e8a3745653265cd78017` |
| 提案 | `0xda42312abf71d15ea41cb67e917926488ba7e75e1e56395ef4522e908e53b6b3` |
| 投票（Jason → Yes） | `0x022ccebe86758c3353f916a9039b51788bdacc03c975ff1de7b335161054277e` |
| 投票（Anni → No） | `0x3abae7220b2376c506f2b117c369241e9cab77038bcc7a7f62a3e61508e5a3fd` |
| 计票 | `scores = [1, 1, 0]`、`scores_total = 2`、`votes = 2` |

计票查询：

```graphql
{ proposal(id: "0xda42…b6b3") { choices scores scores_total votes } }
```

---

## 2. 前置条件

- Sepolia 测试 ETH：Jason `0xb560…df0E`、Anni `0xEcAA…33c9`（私钥在
  `SuperPaymaster/.env.sepolia` 的 `PRIVATE_KEY_JASON` / `PRIVATE_KEY_ANNI`，**不要入库**）。
- **USDC**（ENSv2 注册费以稳定币计价，约 8 USDC/年）：
  - Circle Sepolia USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`（Jason 已有）；
  - 或可自由 mint 的测试 USDC `0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e`。
- 依赖：`viem`（`apps/web/node_modules` 里已有）。
- 写入端点：`https://testnet.seq.snapshot.org`（读 `https://testnet.hub.snapshot.org/graphql`）。

---

## 3. 步骤

### 3.1 在 Sepolia 注册一个 `.eth` 名（ENSv2）

Sepolia 的 **ENSv1 registrar 已停用**（`BaseRegistrar(0x57f1887a…eA85).controllers(...)`
对所有已知 controller 都返回 `false`），新注册**只能走 ENSv2**，费用用 USDC 支付，
仍是 commit–reveal（`MIN_COMMITMENT_AGE = 60s`、`MAX_COMMITMENT_AGE = 86400s`）。

> ⚠️ **Sepolia 上同时存在两套 ENSv2 部署，必须用 Universal Resolver 能看到的那一套。**
>
> | | Snapshot/UR 可见（✅ 用这个） | 另一套（❌ 建 space 会 `not allowed`） |
> |---|---|---|
> | ETH Registrar | `0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca` | `0x8c2e866b439358c41ae05de9cbe8a00bfefaffca` |
> | 根 registry | `0x9703DBD26dAB89504490994138cF2c575251a9cE` | `0xc960F7217d3643B525Ef36Bec8Adf86953CD9aB8` |
> | `eth` registry | `0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E` | `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67` |
>
> Snapshot `snapshot.js` 的 `getEnsOwner` 走 UniversalHelper
> `0x33f571aa8A160a21b877cF6E0Fb8806692b97DF5` → 根 `0x9703DBD2…a9cE`；
> 写在另一套里的名字它**查不到**，最终表现为 sequencer 回 `{"error":"client_error",
> "error_description":"not allowed"}`。

**自检（注册后立刻验）**：名字必须出现在 UR 可见的那棵树里，owner 必须等于签名地址。

```js
// findExactOwner(packetToBytes('myvote-demo.eth')) 必须等于你的地址，返回 0x0 就是进错树了
await publicClient.readContract({
  address: '0x33f571aa8A160a21b877cF6E0Fb8806692b97DF5',
  abi: parseAbi(['function findExactOwner(bytes) view returns (address)']),
  functionName: 'findExactOwner',
  args: [toHex(packetToBytes(label + '.eth'))]
})
```

注册流程（viem）：

1. `isAvailable(label)` / `getRegisterPrice(label, duration, usdc)`；
2. `makeCommitment(label, owner, secret, subregistry=0, resolver=0, duration, referrer=0x0…0)`；
3. `commit(commitment)`，等 ≥ 60s；
4. `erc20.approve(registrar, base + premium)`；
5. `register(label, owner, secret, 0, 0, duration, usdc, 0x0…0)`。

名字会作为 ERC1155（ENSv2 Permissioned Registry）记在 `0x657eA849…E09E` 下；
用 `subregistry = 0` / `resolver = 0` 即可——Snapshot 的 controller 校验读的是 owner，
不需要 `snapshot` 文本记录。

### 3.2 建 space

EIP-712，domain `{ name: 'snapshot', version: '0.1.4' }`，类型：

```js
{ Space: [
  { name: 'from', type: 'address' },
  { name: 'space', type: 'string' },
  { name: 'timestamp', type: 'uint64' },
  { name: 'settings', type: 'string' }   // JSON 字符串
] }
```

POST 到 `https://testnet.seq.snapshot.org`：

```json
{ "address": "0x…", "sig": "0x…",
  "data": { "domain": {…}, "types": {…}, "message": { "from", "space", "timestamp", "settings" } } }
```

`settings` 必填 `name` / `network` / `strategies`（space schema `required`）；
`network` 用 `"11155111"`。sequencer 只有在 `getSpaceController(space.id, network) == signer`
时才接受。

### 3.3 建提案

同 domain，类型 `Proposal`（15 个字段，见 `apps/web/src/lib/snapshotVote.ts` 同源定义），
POST 同一端点。`snapshot` 取 Sepolia 当前块高，`start/end` 用秒级时间戳。

### 3.4 用 MyVote 投票

```ts
import { castVote } from './src/lib/snapshotVote'
await castVote({
  hubUrl: 'https://testnet.hub.snapshot.org',
  vote: { from, space: 'myvote-demo.eth', proposal, type: 'single-choice', choice: 1, app: 'myvote' },
  signTypedData: (payload) => account.signTypedData(payload)
})
```

---

## 4. 踩坑清单

1. **`not allowed`**：sequencer 算出的 controller ≠ 签名人。99% 是 ENS 名进错了 ENSv2 树
   （见 3.1）；先跑 `findExactOwner` 自检。
2. **提案会冻结建案时的 strategies**：改 space settings 后**必须新建提案**，旧提案仍用旧
   strategies 算 VP（表现为一直 `failed to check voting power`）。
3. **`whitelist` 策略的 `params.addresses` 是数组**，不是对象：
   `{ "addresses": ["0x…", "0x…"] }`。写成对象会得到
   `whitelist.map is not a function`。
4. **VP 按提案的 `snapshot` 块高算**：要拿分就得在那块之前就有余额/在名单里。
5. **ENSv1 名仍在 mainnet hub 可用**，但 Sepolia 新注册只能 ENSv2——旧文档里的
   `0xFED6a969…5B72` 之类的 v1 controller 已无 controller 权限。
6. 注册费是 **USDC**（不是 ETH）；`register` 前要先 `approve`，否则 `SafeERC20FailedOperation`。

---

## 5. 复现脚本落点

本次验证的脚本是一次性的（跑完即删），步骤如上。若要固化成可复用工具，
建议放 `apps/web/scripts/` 并配单测（纯函数：commitment 计算、settings 组装、
`findExactOwner` 自检）——注意别把私钥带进仓库。
