# 账单疑似问题跟进系统（纯模拟）
> 说明
> - AI IDE： Qoder IDE CN; LLM: Qwen3.8-max, Qwen3.8-flash
> - 时间： 12:00 ~ 14:00

发现账单问题后**持续跟进**的模拟系统：检测「疑似重复扣款」与「退款逾期」，管理提醒调度、用户标记、暂停/恢复/关闭与中断恢复。

> ⚠️ **纯模拟**：不连接任何银行/支付接口，不做真实付款或真实消息发送。所有数据为虚构样例，金额单位为人民币（整数分），时间为北京时间（Asia/Shanghai）。



## 交付物对照
| 交付 | 位置 |
|------|------|
| 交付1 源码 + 修改说明 + 依赖/配置 + 测试数据 | `src/`、`tests/`、`fixtures/`、`CHANGELOG.md`、`package.json` |
| 交付2 运行说明 | 本 `README.md` |
| 交付3 验收记录 | `ACCEPTANCE.md`（由 `tests/integration-test/run-all.js` 与 `tests/e2e-test/e2e-cli.js` 输出佐证） |
| 交付4 设计说明 | `DESIGN.md`（+ `specs/spec.md` 规格定稿） |
| 交付5 演示 | `npm run demo`（`scripts/demo.js`）+ `npm run scenarios` |
| 交付6 AI 协作记录 | 由 Qoder 会话历史导出（不单独维护文件） |

## 环境要求
- **Node.js >= 20**（开发验证于 v24）。ESM 工程（`"type":"module"`）。
- **零第三方运行时依赖**：仅使用 Node 内置模块（`node:fs`、`node:path`、`node:os`、`node:test`、`node:assert`）。无需 `npm install`。

## 快速开始
```bash
# 1) 初始化 / 重建数据库（单一 data/db.json，MySQL 式关系表，按 user_id 隔离）
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
npm run scenarios     # node tests/integration-test/run-all.js：进程内直调服务层，10 个场景，打印 预期/实际/PASS-FAIL
npm run e2e           # node tests/e2e-test/e2e-cli.js：真·端到端，逐条 spawn CLI 子进程跑完 10 场景
npm test              # node --test tests/unit-test：单元测试（配对/退款/提醒/幂等/引擎，24 项）

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

## 测试分层
| 层 | 命令 | 特点 |
|----|------|------|
| 单元测试 | `npm test` | 纯函数/领域逻辑，不落盘 |
| 集成/验收（**进程内**） | `npm run scenarios` | 直调服务层 + 真实文件持久化；`restart()` 以 flush+重读模拟中断 |
| 端到端（**真·进程**） | `npm run e2e` | 每命令一个独立 `node src/cli.js` 子进程，读写独立临时库；天然覆盖跨进程持久化/重启恢复 |

> `tests/e2e-test/e2e-cli.js` **零依赖 `src/`**（仅 `import` Node 内置 `node:child_process/os/path/fs/url`，断言助手内联）：只要 CLI 输入/输出契约不变，业务模块重构不会牵连它。

## CLI 运行 10 个验收场景

下面用 CLI **逐一**复现 10 个验收场景（与 `tests/integration-test/scenario*.js` 断言等价）。要点：
- **每条 `node src/cli.js` 都是独立进程**，自动从 `data/db.json` 读写——因此命令序列本身就演示了「中断恢复 / 持久化」。
- **每个场景前先 `reset`**：清空库、归零时钟，保证可重放（`advance` 会推进持久化的时钟）。导入按业务编号幂等、问题按确定性 `issue_id` 去重，故重复执行同批命令不会新增/重发。
- 含 `|` 的问题号（如 `DUP:TX1|TX2`）在多数 shell 需加**引号**。
- 用 `list`（看 `status`/`reminders_sent`）、`show`（看详情+`timeline`）、`report`（看 `gaps`/计数）观察结果。
- `mark` 动作别名：`normal`(正常两次购买) / `confirm`(确有问题) / `tomorrow`(明天再提醒) / `resolved`(已自行解决) / `close`(关闭)。
- 一键批量（**进程内**直调服务层）：`npm run scenarios`；一键批量（**真·端到端**：逐条 `spawn` 独立 `node src/cli.js` 进程跑完下述全部命令序列，额外真实覆盖跨进程持久化/重启恢复）：`npm run e2e`（`tests/e2e-test/e2e-cli.js`）。

### 场景 1 — 疑似重复建一条问题
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:05" --user u1
node src/cli.js ingest-tx --id TX1 --merchant 某商户 --amount 30 --at "2026-10-01 09:00" --user u1
node src/cli.js ingest-tx --id TX2 --merchant 某商户 --amount 30 --at "2026-10-01 09:05" --user u1
node src/cli.js list --user u1
```
**预期**：`list` 只有一条 `"DUP:TX1|TX2"`，`status=SUSPECT`、`reminders_sent=1`；`report` 显示两笔交易仍保留（引擎不删除交易）。

### 场景 2 — 标“正常两次购买”并重放
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:05" --user u2
node src/cli.js ingest-tx --id TX1 --merchant 某商户 --amount 30 --at "2026-10-01 09:00" --user u2
node src/cli.js ingest-tx --id TX2 --merchant 某商户 --amount 30 --at "2026-10-01 09:05" --user u2
node src/cli.js mark "DUP:TX1|TX2" normal --user u2
# 重放同批交易（模拟再次导入）
node src/cli.js ingest-tx --id TX1 --merchant 某商户 --amount 30 --at "2026-10-01 09:00" --user u2
node src/cli.js ingest-tx --id TX2 --merchant 某商户 --amount 30 --at "2026-10-01 09:05" --user u2
node src/cli.js show "DUP:TX1|TX2" --user u2
```
**预期**：`status=NORMAL`、`closure_basis=USER_MARKED_NORMAL`；重放后 `list` 仍只有一条（不重开、不新增）。

### 场景 3 — 三笔两两成对 → 三条并关联
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:09" --user u3
node src/cli.js ingest-tx --id TX1 --merchant 某商户 --amount 30 --at "2026-10-01 09:00" --user u3
node src/cli.js ingest-tx --id TX2 --merchant 某商户 --amount 30 --at "2026-10-01 09:05" --user u3
node src/cli.js ingest-tx --id TX3 --merchant 某商户 --amount 30 --at "2026-10-01 09:09" --user u3
# 重放三笔
node src/cli.js ingest-tx --id TX1 --merchant 某商户 --amount 30 --at "2026-10-01 09:00" --user u3
node src/cli.js ingest-tx --id TX2 --merchant 某商户 --amount 30 --at "2026-10-01 09:05" --user u3
node src/cli.js ingest-tx --id TX3 --merchant 某商户 --amount 30 --at "2026-10-01 09:09" --user u3
node src/cli.js list --user u3
node src/cli.js show "DUP:TX1|TX2" --user u3   # 看 link_issue_ids 与措辞
```
**预期**：恰有三条 `DUP:TX1|TX2`、`DUP:TX1|TX3`、`DUP:TX2|TX3`；每条 `link_issue_ids` 长度为 2（互相关联）；均为 `SUSPECT`，描述为“疑似”、不称“已证实”。

### 场景 4 — 逾期 → 部分到账 → 全额解决（含重放）
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:00" --user u4
node src/cli.js ingest-refund --refund-id R1 --expected 100 --confirmed-at "2026-10-01 09:00" --user u4
node src/cli.js list --user u4                                   # 未到期：reminders_sent=0
node src/cli.js advance 72h --user u4                            # 满72h逾期
node src/cli.js ingest-receipt --receipt-id RC60 --refund-id R1 --amount 60 --received-at "2026-10-04 10:00" --user u4
node src/cli.js show "RFD:R1" --user u4                          # received_cents=6000, remaining_cents=4000
node src/cli.js ingest-receipt --receipt-id RC40 --refund-id R1 --amount 40 --received-at "2026-10-05 10:00" --user u4
node src/cli.js ingest-receipt --receipt-id RC60 --refund-id R1 --amount 60 --received-at "2026-10-04 10:00" --user u4  # 重放到账
node src/cli.js show "RFD:R1" --user u4
```
**预期**：72h 前不发提醒；到点逾期发一次；到账 ¥60 显示差额 ¥40（`status` 仍 SUSPECT）；补足 ¥40 后 `status=RESOLVED`、`closure_basis=VERIFIED_BY_REFUND`；重放 `RC60` 后 `received_cents` 仍 10000（不累计）。

### 场景 5 — 全额到账先于申请
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:00" --user u5
node src/cli.js ingest-receipt --receipt-id RC100 --refund-id R2 --amount 100 --received-at "2026-10-01 08:00" --user u5
node src/cli.js report --user u5                                 # gaps 含 R2（孤儿到账）
node src/cli.js ingest-refund --refund-id R2 --expected 100 --confirmed-at "2026-10-01 09:00" --user u5
node src/cli.js show "RFD:R2" --user u5
node src/cli.js report --user u5                                 # 齐全后 gaps 清空
```
**预期**：先到账被保留并列为缺口；申请到达后 `received>=expected` 直接 `RESOLVED/VERIFIED_BY_REFUND`、`reminders_sent=0`（不发过期逾期消息）。

### 场景 6 — 首次提醒后持续不回复
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:00" --user u6
node src/cli.js ingest-refund --refund-id R6 --expected 100 --confirmed-at "2026-10-01 09:00" --user u6
node src/cli.js advance 72h --user u6   # 逾期→首次提醒（reminders_sent=1）
node src/cli.js advance 24h --user u6   # 追加第一次（=2）
node src/cli.js advance 24h --user u6   # 追加第二次（=3）
node src/cli.js advance 72h --user u6   # 已达上限，不再催
node src/cli.js list --user u6
```
**预期**：逾期后 reminders_sent 依次为 1→2→3，继续 `advance` 仍为 3（最多两次追加，以后不催）。

### 场景 7 — 明天再提醒
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:00" --user u7
node src/cli.js ingest-refund --refund-id R7 --expected 100 --confirmed-at "2026-10-01 09:00" --user u7
node src/cli.js advance 72h --user u7                 # 逾期首次提醒（10-04 09:00）
node src/cli.js mark "RFD:R7" tomorrow --user u7      # 明天再提醒（默认+24h）
node src/cli.js advance 23h --user u7   # 尚未到点：reminders_sent 仍=1
node src/cli.js advance 1h  --user u7   # 10-05 09:00 到点：追加（=2）
node src/cli.js list --user u7
```
**预期**：标记“明天再提醒”不立即触发新提醒；不足 24h 时仍为 1，满 24h 才发第 2 条（追加计入次数、不清零）。若要指定时点：`mark "RFD:R7" tomorrow --remind-at "2026-10-05 20:00" --user u7`。

### 场景 8 — 确认重复但无解决结果
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:05" --user u8
node src/cli.js ingest-tx --id TX1 --merchant 某商户 --amount 30 --at "2026-10-01 09:00" --user u8
node src/cli.js ingest-tx --id TX2 --merchant 某商户 --amount 30 --at "2026-10-01 09:05" --user u8
node src/cli.js mark "DUP:TX1|TX2" confirm --user u8   # 确有问题 ≠ 解决
node src/cli.js show "DUP:TX1|TX2" --user u8
```
**预期**：`status=PENDING_RESOLUTION`、`closure_basis=null`（确有问题只进入待解决，不等于解决）。

### 场景 9 — 关闭后到账
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:00" --user u9
node src/cli.js ingest-refund --refund-id R9 --expected 100 --confirmed-at "2026-10-01 09:00" --user u9
node src/cli.js advance 72h --user u9                   # 逾期首次提醒
node src/cli.js mark "RFD:R9" close --user u9           # 关闭
node src/cli.js ingest-receipt --receipt-id RC9 --refund-id R9 --amount 50 --received-at "2026-10-06 10:00" --user u9  # 关闭后到账
node src/cli.js show "RFD:R9" --user u9
```
**预期**：`status` 仍 `CLOSED`（不重开）、`reminders_sent` 不变（不催）；`timeline` 追加一条“关闭后到账”的 `fact_ingested` 事件（只补记录）。

### 场景 10 — 中断恢复保留计数与状态
> CLI 每条命令即独立进程、每次都重新读盘，因此下面的 `list`/`show` 天然模拟了“进程重启后状态恢复”。
```bash
node scripts/init-db.js reset
node src/cli.js set-now  --at "2026-10-01 09:00" --user u10
node src/cli.js ingest-refund --refund-id R10 --expected 100 --confirmed-at "2026-10-01 09:00" --user u10
node src/cli.js advance 72h --user u10
node src/cli.js list --user u10         # 新进程读回：reminders_sent=1，未重发
node src/cli.js advance 24h --user u10  # 计数不清零，继续追加 → =2
node src/cli.js list --user u10
node src/cli.js advance 24h --user u10  # =3
node src/cli.js advance 72h --user u10  # 最多两次，仍 =3
node src/cli.js list --user u10
```
**预期**：重启后首次提醒不重复发送、计数与处理状态原样读回；继续按规则追加且最多两次。

## "自主检查"如何工作（无需等待真实数天）
模拟环境不跑后台守护进程。引擎 `tick()` 在 `advance`、`ingest-*`、`mark`、`control` 之后自动触发一次自检：检测疑似重复、更新退款到账与逾期、按调度规则发送提醒。业务判定用**每用户 SimClock**，用 `advance` 快进时间即可立即验证 72h 逾期、24h/48h 追加等效果，不必真的等待。

## 数据与持久化
- 单一 `data/db.json`，**结构化（MySQL 式）关系表**：顶层 `{ version: 2, tables: { <表名>: [ 行… ] } }`，每张表是行数组，数据行都带 `user_id` 外键归属用户；多对多用关联表（`issue_txs`/`issue_links`）。
- **表一览**：`users`、`transactions`、`refund_applications`、`refund_receipts`、`issues`、`issue_txs`、`issue_links`、`issue_events`、`reminders`、`controls`（每用户一行）、`clocks`（每用户一行）。
- **隔离与装配**：领域/仓储/引擎仍按「每用户视图」（数组字段）工作，`src/store/jsonStore.js` 读取时按 `user_id` 过滤装配、写入时整组回写该用户行，跨用户天然隔离；旧文档式结构（`version:1` 的 `users` 嵌套）自动迁移。
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
├─ package.json                 # 工程配置（ESM）与脚本命令（init/reset/seed/demo/scenarios/e2e/unit-test/integration-test/e2e-test/test）
├─ README.md                    # 运行说明（交付2）
├─ DESIGN.md                    # 设计说明（交付4）
├─ ACCEPTANCE.md                # 验收记录（交付3，由 tests/integration-test/run-all.js 与 tests/e2e-test/e2e-cli.js 输出佐证）
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
│  │  └─ jsonStore.js           # db.json：MySQL 式关系表 ↔ 每用户视图 装配/回写 + 原子落盘
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
├─ tests/                       # 全部测试（三层，按类型分子目录）
│  ├─ unit-test/                # 单元测试（npm test → node --test 自动发现 *.test.js）
│  │  ├─ helpers.js             # 测试辅助（内存节点构造等）
│  │  ├─ domain.test.js         # 配对/退款/提醒/金额等域逻辑
│  │  ├─ scheduler.test.js      # 提醒调度规则
│  │  └─ engine.test.js         # 引擎 tick 与幂等/中断恢复
│  ├─ integration-test/         # 进程内验收/集成（npm run scenarios）
│  │  ├─ harness.js             # 场景运行工具（独立临时库、断言输出）
│  │  ├─ scenario1.js .. scenario10.js   # 10 个验收场景
│  │  └─ run-all.js             # 依次执行全部场景
│  └─ e2e-test/                 # 真·端到端（npm run e2e）
│     └─ e2e-cli.js             # 逐条 spawn CLI 子进程复现 10 场景（零依赖 src/）
├─ fixtures/
│  └─ sample.json               # 虚构样例事实（seed 数据源）
└─ data/
   └─ db.json                   # 单一数据存储（gitignored，运行产物）
```
