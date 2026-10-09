# MyVote 项目交接文档 (Handover Document for Orca)

**编写日期**: 2026-10-08  
**当前状态**: `dev` 分支所有测试全绿 (48 测试套件 / 440 测试)，预览环境持续正常运行。  
**在线预览**: [https://dev.myvote-1jx.pages.dev](https://dev.myvote-1jx.pages.dev)  
**代码仓库**: `MushroomDAO/MyVote` (分支: `dev`)

---

## 一、 项目背景与架构概览

MyVote 是独立的开源治理客户端：默认使用经典链下 Snapshot Hub，Snapshot X 是可选链上后端；前端共用界面和路由，不代表两个协议被合并。依据：[README](../README.md)、[技术选型决策](./snapshot-version-decision.md)、[Snapshot X 集成说明](./snapshot-x-integration.md)。

### 1. 双治理引擎自动路由
- **Snapshot (链下模式)**: 直连官方 Snapshot Hub (`hub.snapshot.org` / `testnet.hub.snapshot.org`)，读取上游索引的提案与投票记录；经典协议采用签名和 IPFS 数据，不应据此承诺永久存储或推断 Pinning 付费方，用户免 Gas 签名投票。
- **Snapshot X (可选链上模式)**: 从 GraphQL 索引器 (`api.snapshot.box` / `testnet-api.snapshot.box`) 读取链上空间，投票写入协议合约。这些 API 地址不是合约地址；执行能力取决于空间配置，本客户端没有实现提案创建或执行管理 UI。审计结论必须针对具体上游合约版本与审计报告核验，不能作为整个 MyVote 或合并引擎的安全背书。参见[官方概览](https://docs.snapshot.box/snapshot-x/overview)。

### 2. 核心架构与多租户
- **多租户 (Multi-tenant) / 独立空间模式**: 支持根域名访问 Explore 多组织浏览，或通过子域/环境变量绑定专属单个 Space（例如 `aastar.eth`）。
- **多语言适配**: 已实际发布中文 (`zh-CN`, 默认)、英文 (`en`, 回退)、泰文 (`th`) 三套消息与语言选择器（`src/i18n.ts` / `src/App.vue`）。

---

## 二、 核心技术栈与开发规约 (MUST FOLLOW)

请接手时严格遵守以下团队规约：

1. **包管理**: 必须且仅使用 `pnpm`，严禁使用 `npm` / `yarn`。
2. **Web3 客户端**: 严格使用 `viem` 与 `abitype`，严禁引入 `ethers`。
3. **合约与测试**: 使用 `foundry` (`forge`)，严禁使用 `hardhat`。
4. **安全红线**: 任何私钥只能从 `.env` 读取，**绝对禁止**记录、硬编码在任何代码、测试用例或文档中。提交前必须确保安全钩子通过。
5. **文档规约**: 除了根目录 `README.md` 外，所有新建与修改的 Markdown 文档必须存放在 `docs/` 目录下。禁止未经用户允许主动新建随意文档。
6. **质量门禁**: 任何改动推送到远程前，必须确保本地类型检查与单元测试全部通过：
   ```bash
   pnpm -C apps/web typecheck && pnpm -C apps/web test
   ```

---

## 三、 本地开发与部署流程

### 1. 本地启动
```bash
pnpm -C apps/web install
pnpm -C apps/web dev
```

> 仓库根目录没有 `package.json`，命令必须以 `apps/web` 为包目录。

### 2. 验证与测试
```bash
# 类型检查
pnpm -C apps/web typecheck

# 单元测试 (Vitest)
pnpm -C apps/web test
```

### 3. 构建与部署预览环境
部署采用 Cloudflare Pages 机制：
```bash
# 构建并部署到 dev 预览环境 (对应 dev.myvote-1jx.pages.dev)
apps/web/scripts/deploy-preview.sh dev
```

---

## 四、 最近已完成的关键工作与改动记录

1. **多网络过滤与双 Hub 容错回退**:
   - 解决了 Explore 页面多链切换（Arbitrum、Base、Optimism、Sepolia 等）过滤失效问题。
   - 增加了主网与测试网 Hub 之间的自动 Fallback 兜底机制，保证测试网 Space 即使在主 Hub 缺失时也能从测试 Hub 加载成功。
2. **默认语言与三套语言消息**:
   - 默认语言设置为中文 (`zh-CN`)。当前 Explore 副标包含 Snapshot/IPFS、Snapshot X 与泛化审计宣传文案；准确协议定位仍应以 README 首段和技术选型文档的「经典默认、SX 可选」为准，宣传文案不能作为安全证据。
3. **样式与视觉细节修复**:
   - 修复了标题文字渐变在容器宽度变化时被裁切成单色的问题（通过 `display: inline-block` 收紧渐变范围）。
4. **邮箱白屏 Bug 根因修复**:
   - 修复了 `i18n.ts` 中 `emailPlaceholder` 包含 `@` 误触 `vue-i18n` linked message 编译导致页面致命抛错白屏的问题。
   - 实现了邮箱登录态刷新后的正确恢复。
5. **全局页脚 (Universal Footer)**:
   - 全局页脚统一展示：标语「记录共识之地 (三语自适应)」· `Powered by AAStar` (含 Logo 图片) · `GitHub` 仓库直达 · `Apache 2.0` (含官方矢量羽毛 Logo 与协议链接)。
6. **AAStar Demo 社区固定置顶**:
   - 在 Explore 页面将演示社区 `aastar.eth` 固定锁定在列表首位，附带高亮与「置顶」徽章。
   - [SpacePage.vue](file:///Users/jason/Dev/mycelium/MyVote/apps/web/src/pages/SpacePage.vue) 增加了对该演示社区元数据的优雅降级回退，保证详情页始终可用。
7. **技术底座信任文档**:
   - 在 `README.md` 中补充了《Trust & Technical Foundations / 信任与技术底座》，包含 IPFS 与合约安全说明；其中存储保证、费用承担与泛化审计陈述应以具体官方文档/报告为准，交接文档不应复述为已核验事实。

---

## 五、 身份认证体系现状 (Auth Overview)

系统目前具备三种登录方式（在页头可选）：
1. **Wallet (注入式钱包)**:
   - 支持 MetaMask / 任意 EIP-1193 钱包；
   - 具备完整私钥签名能力，可直接发起 Snapshot 链下 EIP-712 签名投票或 Snapshot X 链上交互。
2. **AirAccount (cos72 SSO)**:
   - ERC-4337 抽象账户体系，支持 Web2 式单点登录与无感交互体验。
3. **Email (轻量身份)**:
   - 现阶段建立轻量身份会话（保存在 localStorage）；
   - **注意**: 纯邮箱用户无本地私钥，目前不可直接签署 EIP-712 投票选票（UI 会给予友好提示）。

---

## 六、 推荐接手人 (Orca) 后续推进事项

1. **Email 账户无感签名对接**:
   - 对接 aastar TEE KMS (`KMS_ENDPOINT` / E-5) 或 cos72 AirAccount 远程代签，让纯邮箱登录用户也能无感知参与 EIP-712 提案投票。
2. **真实的 Sepolia 测试组织创建与上链**:
   - 配合用户的 Sepolia 测试 ENS（如 `aastar.eth`），在测试网完成真实 Snapshot 空间签名注册，上架演示提案。
3. **Snapshot X 链上投票交互增强**:
   - 进一步丰富链上 Space 的提案执行详情展示（Execution Strategy 参数、Timelock 状态等）。
