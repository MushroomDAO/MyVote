# M4 对接诉求：cos72 / AirAccount（Web2 登录 + 远程签名）

> **最后更新**：2026-09-24
> **用途**：MyVote 侧已完成（`src/auth/kms.ts` 的 `createHttpKmsSigner`、SSO 回调页、EIP-712 信封），
> 差的是**凭据与落地页**。这份文档把接口要求写清楚，可直接转给 cos72 / AirAccount 团队。
> **现状**：M4 在 MyVote 侧全部就绪但**生产不可用**，因为 `KmsSigner` 拿不到可用凭据（见 §1/§2）。

---

## 0. 一句话诉求

> SSO 交换的返回值里，除了用户身份，请把**可直接用于 KMS 签名**的凭据一起给到：
> `agentJwt`、它的 `hdPath`、以及对应的 AA 地址；再给一个 refresh 接口和一个 authorize 落地页。

---

## 1. 我们已经验证过的事实（对照用）

| 观测 | 结论 |
|---|---|
| `POST https://kms.aastar.io/kms/SignTypedData` 只带 `x-api-key` | 400：`sign-typed-data requires authentication: provide Authorization: Bearer <agent-jwt> OR webAuthnAssertion` |
| 申请凭据的 `/kms/create-agent-key` | 同样是 WebAuthn 门控，不能纯服务端调用 |
| 用 KMS e2e key + `P256PasskeySigner` 走完 WebAuthn，铸出 **agent JWT** 后 | `SignTypedData` 成功，签出 65 字节 EIP-712 签名，`verifyTypedData` 通过 |
| agent 凭据**按路径限定**：默认 `m/44'/60'/0'/0/0` | 被拒：`Agent credential may only sign typed-data on path 'm/44'/60'/0'/1/0' (requested 'm/44'/60'/0'/0/0')`；改传 `m/44'/60'/0'/1/0` 后成功 |
| `kms1.aastar.io` | HTTP 530，已停用；生产用 `kms.aastar.io` |
| SSO 交换 | 目前返回的身份信息**不含** agent JWT / hdPath，所以签名拿不到凭据 |

复现我方的真机用例：`apps/web/src/auth/kms.live.test.ts`（`KMS_LIVE=1`，从 `KMS_LIVE_JWT_FILE` 读 JWT）。

---

## 2. 接口要求

### 2.1 SSO code 交换（必需）

`POST {COS72_API}/sso/token`（或你方现有端点）在成功响应里带上：

```jsonc
{
  "address": "0x…",            // AA（智能账户）地址；投票 envelope 的 from 用它
  "agentJwt": "<bearer>",      // 直接用于 Authorization: Bearer
  "hdPath": "m/44'/60'/0'/1/0", // 该凭据被限定的派生路径，必须回传
  "keyId": "…",                // 可选：KMS key 标识（有就带上）
  "expiresAt": 1799999999       // 建议：unix 秒；用于提前刷新
}
```

命名可以不同，但**语义必须齐**：token + path 是一对，缺任一都签不了（path 是我们踩过的坑）。

### 2.2 KMS 签名端点（我方已按此实现，确认即可）

```http
POST {KMS_ENDPOINT}/kms/SignTypedData
x-amz-target: TrentService.SignTypedData
Authorization: Bearer <agentJwt>
content-type: application/json

{ "keyId": "…", "hdPath": "m/44'/60'/0'/1/0",
  "typedData": [ /* KMS 的数组形式 payload（见我方 kms.ts 的 toKmsTypedData） */ ] }
```

响应：`{ "signature": "0x…65 字节" }`。

消息签名（`personal_sign`）走 `POST /kms/SignHash`，字段名 `DerivationPath`（注意大小写与我方实现一致）。

**错误语义**（希望保持稳定、可区分）：

| 情况 | 期望 |
|---|---|
| 凭据过期/无效 | 401，且报文可区分「过期」与「非法」 |
| 路径不匹配 | 400，报文里回显 allowed 与 requested（现在的行为就很好） |
| 限流 | 429 + `Retry-After` |

### 2.3 Refresh（影响安全，优先级高）

MyVote 现在把 SSO token 放在 `sessionStorage`（我们自己的注释也标注为临时妥协，等待你方 refresh 端点）。
给我们一个 refresh 接口后，我们会把 access token 只放内存，refresh 走 **HttpOnly + Secure + SameSite** Cookie。

### 2.4 authorize 落地页（必需）

`VITE_COS72_AUTHORIZE_URL` 需要指向一个真实存在的第一方页面：

- 入参：`redirect_uri`、`state`（原样回传）、可选 `scope`；
- 校验 `redirect_uri` 白名单，拒绝开放重定向；
- 未登录时先登录，登录后 302 回 `redirect_uri?code=…&state=…`。

MyVote 侧的回调固定在后端配置的 `VITE_SSO_CALLBACK_PATH`（默认 `/sso/callback`）。

### 2.5 CORS / 来源白名单

需要放行（或明确告知需经我方边缘代理）：

- `https://forest.mushroom.cv`（生产示例社区）
- `https://dev.myvote-1jx.pages.dev`（预览）
- `http://localhost:5173`（本地开发）

### 2.6 链与账户范围（想确认的问题）

1. agent 凭据能否对 **Sepolia (11155111)** 的 EIP-712 签名？（我们当前只用测试网）
2. AA 地址在不同链上是否一致？EOA/owner key 是否就是 KMS 里那把 P-256？
3. 一个 agent JWT 的有效期与可签名次数有没有限制？

---

## 3. 给我方一个可用的测试凭据（最小闭环）

只要下面三样，我们就能在**预览环境**把「Web2 登录 → 投票」跑通并录屏：

1. 一个测试账号对应的 `agentJwt` + `hdPath`；
2. 它的 AA 地址；
3. `kms.aastar.io` 上该地址可用的 `keyId`（如需要）。

> 注意：JWT 是敏感凭据。建议走你们的测试环境、设短有效期，我们只配在 Cloudflare 预览环境变量里，不入库。

---

## 4. MyVote 侧已完成的对照清单

| 能力 | 位置 |
|---|---|
| KMS signer（`SignTypedData` / `SignHash`，含 `hdPath` 透传） | `apps/web/src/auth/kms.ts` |
| 真机签名用例 | `apps/web/src/auth/kms.live.test.ts` |
| SSO 回调页 | `apps/web/src/pages/SsoCallbackPage.vue` |
| 会话编排 / provider 切换 | `apps/web/src/auth/useAuth.ts`、`airAccountBridge.ts` |
| 投票信封（链下 EIP-712） | `apps/web/src/lib/snapshotVote.ts` |
| 投票信封（Snapshot X） | `apps/web/src/lib/sx/backend.ts` |

凭据到位后我们**不需要改签名代码**，只需在 SSO 交换结果里填 `token` 与 `hdPath`（`KmsSignContext`）。

---

## 5. 参考

- 路线图 M4：`docs/Plan.md`
- KMS 真机核对记录：`docs/Plan.md` M4「E-5」条目、`docs/architecture-review.md`
- AirAccount KMS repo：`~/Dev/aastar/AirAccount/kms`（OpenAPI + `test/run-full-e2e.sh`）