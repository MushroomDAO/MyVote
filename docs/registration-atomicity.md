# 注册唯一性的原子性方案（Durable Objects）

> **最后更新**：2026-09-24
> **状态**：方案（待实施）。实施批次见 PR 说明；本文先定契约，再改代码。
> **背景**：`docs/architecture-review.md` 把「注册 TOCTOU 竞态」列为残余风险——KV 没有 CAS，
> 现在的做法只能**缩小**而不能**关闭**竞态。本方案用 Durable Object 把它关掉。

---

## 1. 问题

`POST /api/register`（`apps/web/functions/api/register.ts`）现在的流程：

1. `TENANTS_KV.get(domain)` 判重；
2. 生成随机 `_reservation` 写回 KV；
3. 读回确认「还是我的 token」，不是就 409；
4. 调 Cloudflare API 给 Pages 项目加自定义域名（签证书）；
5. 重新写一次 KV（补 `domainStatus`）。

第 1→3 步之间不是原子的：两个并发请求可以**都**通过判重、**都**写 KV。第 3 步读回只能让
「最后写入者」胜出，但**输掉的那个请求可能已经把域名注册到 Pages 项目上了**，而且它的
`tenants` 记录被覆盖后没人清理。极端情况下同一个子域会留下两个注册者的证书/记录。

`GET /api/check` 也读同一份 KV，所以并发下它给出的 `available: true` 同样只是**建议**。

**目标**：让「一个名字只能被成功认领一次」成为**硬保证**，并且失败时能干净回滚。

---

## 2. 设计

### 2.1 一个名字一个 Durable Object

Durable Object 是单线程的：同一个对象上的请求会被串行处理。我们用**域名**派生对象 id，
于是**同一个名字**的所有认领请求天然排队，不同名字互不影响。

```
id = env.TENANT_REGISTRY.idFromName(domain)   // 每个 domain 一个 DO 实例
stub = env.TENANT_REGISTRY.get(id)
```

选**每名字一个 DO**而不是**全局单例**：全局单例会把所有社区的注册串成一条队列，
单点抖动影响所有人；每名字一个 DO 只在同名竞争时才排队（这正是我们需要串行的地方）。

### 2.2 接口（fetch 风格，不用 RPC）

用 `stub.fetch(Request)` + JSON，而不是 `extends DurableObject` 的 RPC，原因是
兼容性更稳（RPC 需要较新的 compatibility date 与 class 继承约定），调试也简单。

| 方法 | 路径 | Body | 成功响应 | 语义 |
|---|---|---|---|---|
| `POST` | `/claim` | `{ domain, token }` | `{ ok: true }` | 原子认领；已被别人认领 → `{ ok: false, taken: true }` |
| `POST` | `/release` | `{ domain, token }` | `{ ok: true }` | 只有 `token` 匹配才删除（回滚用；别人的 token 不会被误删） |
| `GET` | `/status?domain=…` | — | `{ token: string \| null }` | 只读，用于排查/前端预检 |

存储：`ctx.storage.get(domain)` / `put(domain, token)` / `delete(domain)`。
三个 handler 都在**同一个对象实例**里，`await` 之间不会被打断，所以先读后写在语义上是原子的。

### 2.3 接线到 `register`

把现在的「写 KV → 读回 token」换成：

```
claim = await registry.claim(domain, token)
if (!claim.ok) return 409 'This name is already taken'
try {
  await TENANTS_KV.put(domain, tenantConfig)          // 发布租户配置
  outcome = await registerPagesDomain(domain)         // CF API
  if (outcome.kind === 'rollback') {
    await TENANTS_KV.delete(domain)
    await registry.release(domain, token)             // 让用户可以重试这个名字
    return 502
  }
  await TENANTS_KV.put(domain, { ...tenantConfig, domainStatus: outcome.kind })
} catch (e) {
  await registry.release(domain, token)               // 异常也要放锁，否则名字被永久占住
  throw e
}
```

`GET /api/check` **保持读 KV**：它是「建议性」接口，而且真正被抢注时 `/api/register`
会由 DO 挡住。这样 check 的延迟和成本不变。

### 2.4 绑定与迁移

⚠️ **关键约束（核对官方文档后修正）**：Cloudflare 明确写着 *"You must create a Durable Object Worker
and bind it to your Pages project"*、*"You cannot create and deploy a Durable Object within a Pages
project"*（[Pages › Bindings › Durable Objects](https://developers.cloudflare.com/pages/functions/bindings/)）。
所以 **DO class 不能放在 `apps/web/functions/` 里**——必须先有**独立 Worker**，再由 Pages 通过
`script_name` 绑定过去。

结构：

```
apps/tenant-registry/            # 新的小 Worker（无第三方依赖）
  wrangler.toml                  # [[durable_objects.bindings]] + [[migrations]]
  src/index.ts                   # export class TenantRegistry + 一个 404 fetch
```

Worker 的 `wrangler.toml`：

```toml
name = "myvote-tenant-registry"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[[durable_objects.bindings]]
name = "TENANT_REGISTRY"
class_name = "TenantRegistry"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TenantRegistry"]
```

Pages 侧（`apps/web/wrangler.toml` 生产、`apps/web/wrangler.preview.toml` 预览）只加绑定，
不带 `[[migrations]]`（迁移属于 Worker）：

```toml
[[durable_objects.bindings]]
name = "TENANT_REGISTRY"
class_name = "TenantRegistry"
script_name = "myvote-tenant-registry"          # 预览：myvote-tenant-registry-preview
```

- 用 `new_sqlite_classes`（SQLite 后端）：新项目推荐、存储便宜；我们的用法只是
  `storage.get/put/delete`，两种后端都支持。
- **预览与生产用两个不同的 Worker**（各自独立命名空间）：否则预览里被测占用的名字
  会把生产也挡住。

### 2.5 兼容与降级

`TENANT_REGISTRY` 未绑定时（例如没跑 `wrangler.toml` 的最小本地环境、或单测），
handler **回退到原来的 KV reserve+read-back** 路径，行为不变、只是没有硬保证。
这样：

- 现有单测（只提供假 KV）继续通过；
- 迁移期间可以先发预览、确认 DO 正常，再发生产；
- 万一 DO 迁移出问题，代码不会 500，只是退回旧语义。

---

## 3. 验收

### 3.1 单测（`functions/api/register.test.ts`）

加一个假 DO（内存 Map + 串行 `fetch` 入口）并覆盖：

1. **同名并发只有 1 个成功**：两个 claim 只能一个 `ok`；失败方返回 409 且**不写 KV**；
2. **CF 域名注册失败会释放**：502 之后同一个 token 可以再次 claim（名字没被永久占住）；
3. **release 只删自己的 token**：别的 token 调 release 不会删掉持有者的认领；
4. **未绑定 DO 时回退**：不传 `TENANT_REGISTRY` 时行为与旧实现一致（现有用例即为回归）。

### 3.2 并发 e2e（真 DO，不是假件）

因为 DO 在独立 Worker 里，**部署后的预览**是最真实的验证环境（本地要同时起两个
`wrangler dev`，见下）。先部署 Worker + 预览，然后并发打同一个名字：

```bash
for i in $(seq 1 8); do curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://dev.myvote-1jx.pages.dev/api/register -H 'content-type: application/json' \
  --data '{"name":"raceprobe","spaceId":"ens.eth","email":"race@example.com"}' & done; wait
# 期望：恰好一个 200，其余 409
```

这是这一步的**关键证据**——旧实现在同样的并发下会多次 200。预览没有 `CF_API_TOKEN`，
所以 200 的那个 `domainStatus` 是 `unmanaged`（不会真开证书）；跑完删掉预览 KV 里的探针记录。

本地也可以验（官方要求的两个进程）：

```bash
cd apps/tenant-registry && npx -y wrangler@4 dev --port 8800        # DO Worker
cd apps/web && npx -y wrangler@4 pages dev dist --port 8799 \
  --do TENANT_REGISTRY=TenantRegistry@myvote-tenant-registry
```

---

## 4. 迁移与回滚

1. **先部署 Worker**：`cd apps/tenant-registry && npx -y wrangler@4 deploy`（预览/生产各一个：
   `...-preview` 与正式名）。迁移 `v1` 在这一步创建 DO 命名空间。
2. 再合 Pages 侧代码 + 绑定到 `dev`，`deploy-preview.sh dev` 部署预览；在预览上跑 §3.2 并发验证。
3. 生产部署 Pages（`wrangler.toml` 里的绑定指向正式 Worker）。**现有 KV 记录不受影响**
   （DO 只管新的认领，`check` 仍读 KV）；生产目前是测试阶段、没有真实租户数据，**不需要回填**。
4. 回滚 = 去掉 Pages 绑定或回退代码；未绑定时走旧 KV 路径，Worker/命名空间留着不碍事。

---

## 5. 明确不做（以及为什么）

- **全局单例 DO**：把所有注册串行化，单点抖动放大，没必要。
- **D1（`domain` 主键 + `INSERT … ON CONFLICT DO NOTHING`）**：Pages 原生支持、也能做到原子认领，
  但它是**单写者**数据库，所有注册争同一把写锁；DO 只在同名竞争时才排队，也更贴合原始结论。
  如果后续要更多关系型查询（审计、租户清单），可以再迁到 D1。
- **给 `check` 也走 DO**：收益小、延迟翻倍；`register` 已经兜底。
- **限流改成 DO**：固定窗口限流本来就是「尽力而为」，不是正确性要求；留作后续。

## 6. 残余风险（做完之后）

- DO 存储与 KV 是两份状态：极端情况下 DO 已 claim、KV 写入失败 → 用户拿到 5xx，
  claim 会被 finally 释放；只要不是进程被杀在两步之间（Cloudflare 会等待 Promise），就不会永久占名。
- 同名恶意抢注（先占位再放弃）依靠现有按 IP 限流缓解，未在本方案内解决。