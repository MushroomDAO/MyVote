# Pi Development Loop 与 Pre-PR 流程

> 本文档记录开发循环与提 PR 前的机械规则，作为整体工作上下文。
> **每次提 PR 前必须执行 pre-pr-check。**

## 开发循环（Pi Development Loop）

```
        Pi Development Loop
                    │
                    │ owns
                    ▼
             ┌─────────────┐
             │ Development │
             │   worktree  │
             └──────┬──────┘
                    │
             implement/test
                    │
              internal check
                    │
                    ▼
               Open PR
                    │
════════════════════╪════════════════════
      development boundary / review boundary
                    │
                    ▼
           External PR Reviewer
                    │
              challenge review
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
      PASS                    FAIL
        │                       │
        │                       ▼
        │                 Pi Fix Worker
        │                       │
        │                       ▼
        │                    push
        │                       │
        │                       ▼
        │                External Review
        │                       │
        └───────────────┬───────┘
                        ▼
                     MERGE
```

- **development boundary / review boundary 之上**（由 Pi Development Loop 拥有）：implement/test → internal check → Open PR。
- **边界之下**：External PR Reviewer 做 challenge review；PASS 或 FAIL；FAIL 则由 Pi Fix Worker 修复并 push，再次进入 External Review，直到 PASS。
- 最终 MERGE。

## Pre-PR Check（提 PR 前必做）

- **唯一入口**：`/Users/jason/Dev/tools/PR-Daemon/scripts/pre-pr-check.sh`
  - `--version` 查看规则版本
  - `--selftest` 跑自证
- **规则说明**：`/Users/jason/Dev/tools/PR-Daemon/.claude/skills/pre-pr-rules/SKILL.md`
- **变更记录**：`/Users/jason/Dev/tools/PR-Daemon/docs/PRE-PR-RULES-CHANGELOG.md`
- **当前版本**：1.3.0
- **用法**：

  ```bash
  bash ~/Dev/tools/PR-daemon/scripts/pre-pr-check.sh --base <base>
  ```

- 所有与 PR-Daemon 通信的仓库，提 PR 之前都要跑它自检并修掉 block（全仓库共享的机械规则，不是某个业务仓库自己的脚本）。
- **改规则的流程**：判定变了就升版本号 → 写 CHANGELOG → 补自证格 → 跑 `scripts/pre_pr_replay.py` 回放看命中/误报。

## CI（GitHub Actions）

`.github/workflows/ci.yml` 在 **PR / push 到 `main` 或 `dev`** 时运行与本地一致的 gate
（工作目录 `apps/web`）：

```bash
pnpm install --frozen-lockfile
pnpm run typecheck   # vue-tsc -b
pnpm run test        # vitest（含 functions/ 的 Node 环境用例）
pnpm run build       # vite build
```

CI **只校验、不部署**；预览发布仍是显式步骤
（`apps/web/scripts/deploy-preview.sh`，见 `docs/deployment.md`）。
本地用 pnpm 脚本跑通即可，命令与 CI 完全一致。

