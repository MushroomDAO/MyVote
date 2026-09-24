# 部署与运行手册（Deployment Runbook）

> 适用于 Cloudflare Pages 项目 `myvote`。最后更新：2026-09-24。

---

## 1. 环境总览

| 环境 | 触发 | 域名 | TENANTS_KV 命名空间 |
|---|---|---|---|
| **production** | `--branch main` | `forest.mushroom.cv`、`aastar.forest.mushroom.cv`、`bread.forest.mushroom.cv` | `MYVOTE_TENANTS_KV` = `b48caba076cb477698121c95f9e69d9e` |
| **preview** | 任意非 `main` 分支（如 `dev`） | `dev.myvote-1jx.pages.dev`（别名自动生成） | `MYVOTE_TENANTS_KV_PREVIEW` = `34c1c5f2e50243d1992af2f547151140` |

> **预览与生产必须使用不同的 KV。** 否则预览环境注册的租户/限流计数会写进生产数据。

---

## 2. 为什么预览要用脚本部署（重要）

`wrangler pages deploy` 会把**运行目录下 `wrangler.toml` 里的 KV 绑定按 `id` 覆盖到 Pages 项目上**，它会覆盖 dashboard 里配置的 preview 绑定。

后果（2026-09-24 实测）：直接执行

```bash
cd apps/web && npx wrangler@4 pages deploy dist --project-name myvote --branch dev
```

会把项目的 **preview** 绑定改回 `wrangler.toml` 里声明的**生产**命名空间，于是 dev 预览的 `/api/register`、`/api/check` 直接读写生产 KV。

`wrangler pages deploy` **没有** `--config` / `--env`，且 `WRANGLER_CONFIG` 环境变量被忽略（实测）。可行做法是让 wrangler 从一个**临时目录**读取配置：

```bash
apps/web/scripts/deploy-preview.sh [branch]   # 默认 dev
```

脚本会：构建 → 把 `wrangler.preview.toml`（预览命名空间）复制到临时目录 → 软链 `functions` → 用 `--cwd <temp>` 部署 → 清理临时目录。

部署后还会做一次**冒烟检查**：从 wrangler 输出里取出分支别名 URL（可用 `CF_PREVIEW_URL` 覆盖），`curl` 首页并要求 HTTP 200 且包含 `id="app"`；任一不满足则脚本非零退出，避免"部署成功但别名指向空/过期项目"。

**验证隔离**：部署后调用一次 `GET /api/check?name=probe`，然后确认 `rl:check:*` 键出现在**预览**命名空间、生产命名空间为空。

---

## 3. KV 命名空间

| 绑定 | 用途 | 生产 id | 预览 id |
|---|---|---|---|
| `TENANTS_KV` | 租户配置（hostname → 配置）与限流计数（`rl:*`） | `b48caba0…` | `34c1c5f2…` |

- 键 `<hostname>` = 租户 JSON（`spaceId/name/description/contactEmail/colors/_reservation`）。
- 键 `rl:register:<ip>` / `rl:check:<ip>` = 限流计数，带 TTL 自动过期。
- `_middleware.ts` 只把**白名单字段**注入 `window.__TENANT__`，`contactEmail`/`_reservation` 不会进入页面源码。

---

## 4. 密钥与环境变量

**production**（Pages → Settings → Environment variables，加密项不在仓库）：
`CF_API_TOKEN`、`CF_ACCOUNT_ID`、`CF_PAGES_PROJECT`、`CF_ZONE_ID`、`CF_ROOT_DOMAIN`

**preview**：只有非敏感的 `CF_ROOT_DOMAIN`、`SNAPSHOT_HUB`。
> 预览环境**刻意不配置 CF 密钥**：这样预览里的注册请求不会真的去开通 Pages 自定义域名。

前端构建期变量（`VITE_*`）见 `apps/web/.env.example`。

---

## 5. 部署命令

```bash
# 预览（dev）
apps/web/scripts/deploy-preview.sh dev

# 生产（main）——用默认 wrangler.toml（生产命名空间）
cd apps/web
./node_modules/.bin/vite build
npx -y wrangler@4 pages deploy dist --project-name myvote --branch main --commit-dirty=true
```

> 生产部署前先确认 `wrangler.toml` 的 `[[kv_namespaces]].id` 仍是生产命名空间。

---

## 6. 自定义域名与 DNS

- 通配符 DNS：`*.forest.mushroom.cv` → Cloudflare Pages。
- 自助注册会为目标子域调用 CF API 增加 Pages 自定义域名（触发 SSL 签发）。
- 租户配置写入 KV 后，边缘中间件按 hostname 注入品牌配置。

---

## 7. 健康检查

```bash
BASE=https://dev.myvote-1jx.pages.dev   # 或 https://forest.mushroom.cv
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/"
curl -s "$BASE/api/check?name=healthprobe"
curl -s -X POST "$BASE/api/graphql" -H 'content-type: application/json' \
  -d '{"query":"{ spaces(first: 1) { id name } }"}'
```

---

## 8. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 预览注册写进了生产 KV | 用了裸 `wrangler pages deploy` | 改用 `scripts/deploy-preview.sh` |
| 预览站点没有租户品牌 | 预览 KV 里没有该 hostname 的记录 | 正常；预览在 `*.pages.dev` 上不解析租户 |
| `/api/graphql` 返回空数据 | `SNAPSHOT_HUB` 与前端 `VITE_SNAPSHOT_HUB` 不一致（Sepolia 空间只在 testnet hub） | 对齐两者 |
| 注册返回 429 | 触发了 5 次/小时限流 | 等 1 小时，或清理 `rl:register:<ip>` |
| `wrangler pages deploy` 覆盖了绑定 | 预期行为（见 §2） | 按环境用对应配置 |

---

## 9. 相关文档

- 多租户实现：[`docs/M2-multi-tenant.md`](./M2-multi-tenant.md)
- 路线图（M6 加固项）：[`docs/Plan.md`](./Plan.md)
