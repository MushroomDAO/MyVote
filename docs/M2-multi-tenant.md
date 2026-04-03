# M2: Multi-Tenant（多租户系统）

**目标**: 一次部署服务多个社区，每个社区通过自己的域名访问，看到独立的品牌和 Space。

---

## 架构

```
请求到达边缘节点
       ↓
Cloudflare Pages Functions (_middleware.ts)
       ↓
读取 hostname → 查找 tenants.json 中的租户配置
       ↓
将租户 JSON 注入到 HTML 的 <head> 中：
  window.__TENANT__ = { spaceId, name, colors, ... }
       ↓
Vue SPA 启动 → tenant.ts 读取 window.__TENANT__
       ↓
与默认 branding.ts 合并（租户配置覆盖默认值）
       ↓
应用品牌 CSS 变量 + 路由到租户的 Space
```

---

## 关键文件

| 文件 | 作用 |
|------|------|
| `apps/web/src/branding.ts` | 默认品牌配置（M1 已实现） |
| `apps/web/src/tenant.ts` | 读取 `window.__TENANT__`，与默认品牌合并 |
| `apps/web/functions/_middleware.ts` | CF Pages 边缘函数：tenant 注入 |
| `tenants.json` | 租户配置表（hostname → 配置） |
| `wrangler.toml` | Cloudflare 本地开发配置 |

---

## 租户配置格式

`tenants.json`（放在仓库根目录）:

```json
{
  "aastar.myvote.org": {
    "spaceId": "aastar.eth",
    "name": "AAStar Governance",
    "description": "Vote on AAStar community proposals",
    "logo": "https://cdn.aastar.io/logo.svg",
    "colors": {
      "primary": "#ff6b35",
      "primaryHover": "#e55a2b",
      "selectedBg": "rgba(255, 107, 53, 0.08)"
    }
  },
  "dao2.myvote.org": {
    "spaceId": "dao2.eth",
    "name": "DAO2 Governance",
    "colors": {
      "primary": "#2563eb"
    }
  }
}
```

当 `spaceId` 存在时，`/` 和 `/explore` 自动重定向到该 Space，app 变成单 Space 模式。

---

## Cloudflare Pages 部署步骤

### 1. 添加 tenant.ts 和边缘函数

```bash
# 新建文件（M2 实现时创建）
apps/web/src/tenant.ts
apps/web/functions/_middleware.ts
```

### 2. 本地开发（使用 wrangler）

```bash
# 安装 wrangler
npm install -g wrangler

# 构建 app
cd apps/web && pnpm run build

# 在 dist/ 目录运行本地边缘函数模拟
wrangler pages dev dist/
```

模拟不同租户：修改本机 `/etc/hosts`：
```
127.0.0.1  aastar.local
```
访问 http://aastar.local:8788 查看 aastar 租户效果。

### 3. 部署到 Cloudflare Pages

1. CF Pages 控制台导入仓库
2. 配置同 M1（`apps/web` 根目录，`pnpm run build`，输出 `dist`）
3. 添加自定义域名（主域名 + 所有租户子域名）
4. 配置通配符 DNS：`*.myvote.org → CF Pages`
5. 在 CF Pages 中添加通配符自定义域名

### 4. 添加新租户

编辑 `tenants.json` → 提交 → 自动触发 CF Pages 重新部署（约 30 秒生效）。

---

## 租户配置存储演进路线

| 阶段 | 方案 | 特点 |
|------|------|------|
| **M2 起步** | 静态 `tenants.json` 随代码部署 | 简单，改配置需重新部署（~30秒） |
| **M2 成长** | Cloudflare KV 存储租户配置 | 动态增删，无需重新部署 |
| **M3+** | Cloudflare D1 + 自助注册面板 | 社区自助申请，完全自动化 |

---

## 中国访问分析

### 标准 CF 方案（免费/Pro）

- 中国用户流量路由到香港/东京/新加坡节点，延迟增加 30-80ms
- 对治理工具（非实时流媒体）这个延迟可接受
- `*.pages.dev` 域名历史上有被屏蔽记录 → **必须使用自定义域名**
- Snapshot Hub API（hub.snapshot.org）本身在海外，中国用户已习惯此延迟

### 风险缓解

1. **必须用自定义域名**，不用 `*.pages.dev`
2. 在 CF Worker 中添加 `/api/graphql` 代理路由，转发到 Snapshot Hub
   - 如果用户直连 hub.snapshot.org 被干扰，可通过 CF Worker 中转
   - 配置：`VITE_SNAPSHOT_GRAPHQL_ENDPOINT=/api/graphql`
3. 如 CF 整体不可用，备选：Vercel（香港节点更稳定）或国内云（需 ICP 备案）

### CF Enterprise + JD Cloud（可选）

- 真正的中国大陆 PoP 节点
- 需要 ICP 备案 + 企业合同
- 成本高，适合有大量中国用户的正式产品

---

## API 代理路由（中国访问优化）

在 `_middleware.ts` 中添加：

```typescript
// /api/graphql 代理到 Snapshot Hub
if (url.pathname === '/api/graphql') {
  return fetch('https://hub.snapshot.org/graphql', {
    method: context.request.method,
    headers: { 'content-type': 'application/json' },
    body: context.request.body,
  })
}
```

前端配置：
```bash
# apps/web/.env.local
VITE_SNAPSHOT_GRAPHQL_ENDPOINT=/api/graphql
```

---

## M2 任务清单

- [ ] 创建 `apps/web/src/tenant.ts`
- [ ] 创建 `apps/web/functions/_middleware.ts`（tenant 注入 + 可选 API 代理）
- [ ] 创建 `tenants.json`（初始示例配置）
- [ ] 改造 `apps/web/src/main.ts` 使用 `resolvedBranding`（tenant 优先）
- [ ] 改造 `apps/web/src/router.ts` 添加 tenant 感知路由守卫
- [ ] 添加 `wrangler.toml`
- [ ] CF Pages 部署 + 自定义域名配置
- [ ] 测试：多 hostname 租户解析正确
- [ ] 文档：租户管理指南
