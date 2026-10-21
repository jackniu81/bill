# 账单疑似问题跟进系统（纯模拟）

发现账单问题后**持续跟进**的模拟系统：检测「疑似重复扣款」与「退款逾期」，管理提醒调度、用户标记、暂停/恢复/关闭与中断恢复。

> ⚠️ **纯模拟**：不连接任何银行/支付接口，不做真实付款或真实消息发送。所有数据为虚构样例，金额单位为人民币（整数分），时间为北京时间（Asia/Shanghai）。

> AI IDE： 

## 交付物对照
| 交付 | 位置 |
|------|------|
| 交付1 源码 + 修改说明 + 依赖/配置 + 测试数据 | `src/`、`scenarios/`、`test/`、`fixtures/`、`CHANGELOG.md`、`package.json` |
| 交付2 运行说明 | 本 `README.md` |
| 交付3 验收记录 | `ACCEPTANCE.md`（由 `scenarios/run-all.js` 输出佐证） |
| 交付4 设计说明 | `DESIGN.md`（+ `specs/spec.md` 规格定稿） |
| 交付5 演示 | `npm run demo`（`scripts/demo.js`）+ `npm run scenarios` |
| 交付6 AI 协作记录 | 由 Qoder 会话历史导出（不单独维护文件） |

## 环境要求
- **Node.js >= 20**（开发验证于 v24）。ESM 工程（`"type":"module"`）。
- **零第三方运行时依赖**：仅使用 Node 内置模块（`node:fs`、`node:path`、`node:os`、`node:test`、`node:assert`）。无需 `npm install`。

## 快速开始
```bash
# 1) 初始化 / 重建数据库（单一 data/db.json，按 userId 分组隔离）
npm run init          # 不存在则创建空库
npm run reset         # 清空重建（重复测试前先跑，保证互不串扰）
npm run seed -- fixtures/sample.json   # 用虚构样例事实重建库

# 2) 处理某个用户的数据（--user 强制，用于隔离与授权）
node src/cli.js set-now --at "2026-10-01 09:00" --user alice
node src/cli.js advance 0s --user alice        # 触发引擎自检，生成疑似问题
node src/cli.js list --user alice
node src/cli.js show DUP:ATX1\|ATX2 --user alice
node src/cli.js report --user alice

# 3) 运行验收与测试
npm run scenarios     # node scenarios/run-all.js：10 个场景，打印 预期/实际/PASS-FAIL
npm test              # node --test：单元测试（配对/退款/提醒/幂等/引擎）

# 4) 带旁白演示（正常/异常/核验/控制/诚实/重启）
npm run demo
```

## CLI 命令
全局参数：`--user <id>`（必填，用于用户隔离与授权边界）。可用环境变量 `BILL_DB_PATH` 覆盖数据库路径（便于测试使用独立临时库）。

| 命令 | 作用 |
|------|------|
| `init` / `reset` | 建立 / 清空重建单一 `data/db.json` |
| `seed <fixture.json>` | 由脚本 `scripts/init-db.js` 提供：`node scripts/init-db.js seed <file>` |
| `set-now --at "YYYY-MM-DD HH:mm"` | 设置该用户模拟时钟基准（北京时间） |
| `advance <时长>` | 推进模拟时长（`30m`/`24h`/`2d`/毫秒），推进后自动自检 |
| `ingest-tx --id --merchant --amount --at` | 导入一笔交易（按 `tx_id` 幂等） |
| `ingest-refund --refund-id --expected --confirmed-at` | 导入退款申请（按 `refund_id` 幂等） |
| `ingest-receipt --receipt-id --refund-id --amount --received-at` | 导入一笔到账（按 `receipt_id` 幂等；先到账也保留） |
| `mark <issueId> <action>` | 用户标记：`normal`/`confirm`/`tomorrow`/`resolved`/`close`（可 `--note`、`--remind-at`） |
| `control pause\|resume\|close\|reopen` | 控制持续工作：暂停/恢复/关闭/重开 |
| `list` / `show <issueId>` / `report` | 查看问题列表 / 详情+处理时间线 / 进展报告（含缺口） |

## CLI 运行 10 个验收场景
10 个场景（`scenarios/scenario1.js … scenario10.js`）覆盖需求全部关键规则，每个用**独立 userId + 独立临时库**、运行前重建干净节点，**可重复、互不串扰**。它们直接驱动完整业务栈（导入事实 → 引擎自检 → 提醒调度 → 查询/时间线），逐条断言并打印「输入 / 预期 / 证据(实际) / PASS-FAIL」。

```bash
# 一次性运行全部 10 个场景并汇总（推荐，作为交付3验收证据）
npm run scenarios          # 等价：node scenarios/run-all.js

# 只运行单个场景（按需排查）——每个文件导出 { meta, run() }
node --input-type=module -e "const m=await import('./scenarios/scenario4.js');const r=m.run();console.log(m.meta);console.table(r.checks.map(c=>({断言:c.desc,通过:c.ok})));"
```

**输出与判定**
- 每个场景打印形如 `✓/✗ <断言>` 与 `证据：{...}`（实际状态/计数/差额等），末尾汇总为 `[PASS]/[FAIL] 场景 N（通过 x / 失败 y）`。
- 全部通过：最后一行 `结果：PASS（全部验收场景通过）`，进程**退出码 0**。
- 任一断言失败（或场景运行抛异常）：`结果：FAIL`，进程**退出码 1**（如实呈现，不伪装为通过）——便于 CI 用退出码拦截。

**场景 ↔ 规则 ↔ 预期**
| # | 场景 | 预期要点 |
|---|------|---------|
| 1 | 疑似重复建一条 | 一条 `SUSPECT`，两笔交易都保留（不删） |
| 2 | 标正常并重放 | 记 `NORMAL`；重放不重开、不新增 |
| 3 | 三笔两两成对 | 三条问题且互相 `link_issue_ids` 关联；不称"已证实" |
| 4 | 逾期→部分→全额 | 逾期提醒；显示差额 ¥40；全额才 `RESOLVED`；重放不累计 |
| 5 | 全额先于申请 | 先到账列为缺口并保留；齐全即解决、不发逾期 |
| 6 | 持续不回复 | ≥24h/≥48h 各追加一次，最多两次后不再催 |
| 7 | 明天再提醒 | 至少延后 24h；追加次数不清零 |
| 8 | 确认未解决 | `PENDING_RESOLUTION`（确有问题 ≠ 解决） |
| 9 | 关闭后到账 | 只补事实记录；不重开、不催办 |
| 10 | 中断恢复 | 重启读回计数与状态；不重发、继续按规则追加 |

> 场景为**进程内验收/集成测试**（贯穿服务层与真实文件持久化）；单元测试见下一节，二者互补。

## "自主检查"如何工作（无需等待真实数天）
模拟环境不跑后台守护进程。引擎 `tick()` 在 `advance`、`ingest-*`、`mark`、`control` 之后自动触发一次自检：检测疑似重复、更新退款到账与逾期、按调度规则发送提醒。业务判定用**每用户 SimClock**，用 `advance` 快进时间即可立即验证 72h 逾期、24h/48h 追加等效果，不必真的等待。

## 数据与持久化
- 单一 `data/db.json`，顶层 `{ version, users: { <userId>: <用户节点> } }`；仓储层只暴露当前 `userId` 节点，天然隔离。
- 写入用「临时文件 + rename」原子落盘；进程重启从 `db.json` 读回计数与处理状态（满足中断恢复）。
- `data/` 已在 `.gitignore` 忽略（属运行产物）。

## 诚实性说明
缺失/失败/未知一律如实呈现，绝不伪装为 0/成功/完成：
- 到账先到、申请未到 → 列为缺口（`report.gaps`），标注"申请未到、已保留、齐全后再判断"。
- 疑似重复仅表述为"疑似"，不断言"已证实错误扣款"。
- 发过提醒 ≠ 问题解决；只有退款全额到账（`VERIFIED_BY_REFUND`）或用户明确处理才算结案。


## 目录结构
```
bill/
├─ package.json                 # 工程配置（ESM）与脚本命令（init/reset/seed/demo/scenarios/test）
├─ README.md                    # 运行说明（交付2）
├─ DESIGN.md                    # 设计说明（交付4）
├─ ACCEPTANCE.md                # 验收记录（交付3，由 scenarios/run-all.js 输出佐证）
├─ CHANGELOG.md                 # 修改说明（交付1）
├─ AGENTS.md                    # AI 协作约定（回复语言/测试/git 规范）
├─ .gitignore                   # 忽略 data/ 等运行产物
├─ specs/                       # 需求与规格
│  ├─ requirement.md            # 原始需求
│  └─ spec.md                   # 规格定稿（判定规则、状态机、调度口径）
├─ src/                         # 源码（零第三方依赖）
│  ├─ cli.js                    # CLI 入口：解析命令与 --user，分发到应用层
│  ├─ config.js                 # 全局配置（DB 路径，可用 BILL_DB_PATH 覆盖）
│  ├─ store/
│  │  └─ jsonStore.js           # 单一 db.json 读写：临时文件 + rename 原子落盘
│  ├─ domain/                   # 纯业务逻辑（无 I/O，可单测）
│  │  ├─ money.js               # 金额工具（整数分，比较/汇总）
│  │  ├─ simClock.js            # 每用户模拟时钟（set-now/advance）
│  │  ├─ rules.js               # 判定规则常量（72h 逾期、24h/48h 追加等）
│  │  ├─ duplicateDetector.js   # 疑似重复扣款配对检测（仅表述"疑似"）
│  │  ├─ refundTracker.js       # 退款到账跟踪与逾期判定（含先到账缺口）
│  │  ├─ reminderScheduler.js   # 提醒调度计划（生成/顺延/取消）
│  │  └─ issueStateMachine.js   # 问题状态机（open/paused/resolved/closed 等）
│  ├─ repo/                     # 仓储层：只暴露当前 userId 节点，天然隔离
│  │  ├─ transactionRepo.js     # 交易（tx_id 幂等）
│  │  ├─ refundRepo.js          # 退款申请与到账（refund_id/receipt_id 幂等）
│  │  ├─ issueRepo.js           # 问题记录
│  │  ├─ reminderRepo.js        # 提醒记录
│  │  ├─ eventRepo.js           # 处理时间线事件
│  │  ├─ controlRepo.js         # 暂停/恢复/关闭/重开控制状态
│  │  └─ idgen.js               # 基于计数器的 ID 生成（重启读回，不重号）
│  └─ app/                      # 应用服务层（编排 domain + repo）
│     ├─ userService.js         # 用户节点管理与授权边界
│     ├─ ingestService.js       # ingest-tx/refund/receipt 导入
│     ├─ followUpEngine.js      # tick() 自检引擎（advance/ingest/mark/control 后触发）
│     ├─ messaging.js           # 模拟提醒发送（不做真实消息）
│     └─ queryService.js        # list/show/report 查询
├─ scripts/
│  ├─ init-db.js                # init / reset / seed 数据库脚本
│  └─ demo.js                   # 带旁白演示（正常/异常/核验/控制/诚实/重启）
├─ scenarios/                   # 验收场景（预期/实际/PASS-FAIL）
│  ├─ harness.js                # 场景运行工具（独立临时库、断言输出）
│  ├─ scenario1.js .. scenario10.js   # 10 个验收场景
│  └─ run-all.js                # 依次执行全部场景（npm run scenarios）
├─ test/                        # 单元测试（node --test）
│  ├─ helpers.js                # 测试辅助（临时库构造等）
│  ├─ domain.test.js            # 配对/退款/提醒/金额等域逻辑
│  ├─ scheduler.test.js         # 提醒调度规则
│  └─ engine.test.js            # 引擎 tick 与幂等/中断恢复
├─ fixtures/
│  └─ sample.json               # 虚构样例事实（seed 数据源）
└─ data/
   └─ db.json                   # 单一数据存储（gitignored，运行产物）
```
