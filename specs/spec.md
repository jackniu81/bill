# 账单疑似问题跟进系统 — 设计规格与任务分解

> 依据 `specs/requirement.md`（发现账单问题后继续跟进 V0.2）整理。纯模拟、无第三方运行时依赖；交付形态为 CLI 命令式 + 每个验收场景一个可重放脚本；持久化为单一 `data/db.json`（MySQL 式关系表，按 `user_id` 外键实现隔离）。

## 概述
构建一个**纯模拟**的账单问题跟进系统：检测「疑似重复扣款」与「退款逾期」，管理提醒调度、用户标记、暂停/关闭/恢复与中断恢复，不连接银行、不真实付款。金额人民币、时间北京时间。本 spec 覆盖需求全部规则、10 个验收场景与交付 1–6。

## 技术选型与关键决策
- **运行时**：Node.js >= 20，ESM（`"type":"module"`），JavaScript。
- **持久化**：JSON 文件存储，**所有用户共用单一 `data/db.json`**；存储采用**结构化（MySQL 式）关系表**——顶层 `{ version, tables: { <表名>: [ 行… ] } }`，每行以 `user_id` 外键归属用户，多对多用关联表（`issue_txs`/`issue_links`）。领域/仓储/引擎仍按「每用户视图」工作，由 `src/store/jsonStore.js` 负责 **表 ↔ 视图** 装配/回写并按 `user_id` 过滤实现隔离；写入用临时文件 + rename 原子落盘，进程重启即从 `db.json` 读回（满足中断恢复）；**旧文档式结构（`version:1` 的 `users` 嵌套）自动迁移**。提供 `scripts/init-db.js`（npm 脚本 `init`/`reset`）建立/重建空库，便于重复测试。**无第三方运行时依赖**。
- **测试**：Node 内置 `node:test` + `node:assert`（`npm test` → `node --test`，自动发现 `*.test.js`），聚焦主路径 + 关键边界，不臃肿。
- **金额**：一律用**整数分**存储与计算，避免浮点误差；展示格式化为 RMB 两位小数。
- **时间**：内部存 epoch 毫秒；展示用 `Asia/Shanghai`。业务判定基于**每用户 SimClock**（可 `advance`），而非真实墙钟。
- **"自主检查"实现**：模拟环境下不跑后台守护进程；引擎 `tick()` 在任何改状态的 CLI 命令（ingest/mark/control）后、以及 `advance` 推进时间后自动触发，等价于"新数据或约定时间到达后自行检查、无需用户再发消息"。
- **诚实性**：缺失/失败/未知一律如实呈现，绝不伪装成 0/成功/完成（如无匹配申请的到账→保留并标注"申请未到"；发送结果未知→标 UNKNOWN 并提示核实，不盲目重试）。

## 领域模型与数据结构（单一 `data/db.json`，MySQL 式关系表）
`db.json` 顶层为 `{ version: 2, tables: { … } }`，每张表是行数组；数据表每行都带 `user_id` 外键，多对多用关联表。运行时领域/仓储/引擎以「每用户视图」（数组字段）工作，由 `src/store/jsonStore.js` 在读取时按 `user_id` 过滤装配、写入时整组回写对应表的该用户行；跨用户隔离由「按 `user_id` 过滤」保证。

**表结构（rows）**
- `users`：`{user_id}` — 用户主表（隔离根）。
- `transactions`：`{tx_id, user_id, merchant, amount_cents, occurred_at, ingested_at}`，主键 `tx_id`（(user_id,tx_id) 复合唯一，重放按编号幂等）。
- `refund_applications`：`{refund_id, user_id, expected_amount_cents, confirmed_at, ingested_at}`，主键 `refund_id`（`confirmed_at`=72h 逾期起算点）。
- `refund_receipts`：`{receipt_id, user_id, refund_id, amount_cents, received_at, ingested_at}`，主键 `receipt_id`（到账可先于申请保留；重放不累计）。
- `issues`：`{issue_id, user_id, kind[duplicate|refund], status, closure_basis, refund_id?, expected_cents?, received_cents?, created_at, updated_at}`；**交易对与关联不再内嵌数组**，规范化到下列关联表。
- `issue_txs`（关联表 M:N）：`{issue_id, tx_id, user_id}` — 一条疑似重复问题 ↔ 两笔交易。
- `issue_links`（关联表 M:N）：`{issue_id, link_issue_id, user_id}` — 三笔两两成对时三条问题互相「明确关联」。
- `issue_events`：`{event_id, user_id, issue_id, seq, at, type, payload(JSON 列)}` — append-only 处理历史/审计（事实导入、提醒发送、用户标记、状态变更、关闭后补事实等）。
- `reminders`：`{reminder_id, user_id, issue_id, kind[first|followup], seq, due_at, sent_at, status[scheduled|sent|unknown|cancelled]}`。
- `controls`（每用户一行）：`{user_id, control_state[running|paused|closed], settings(JSON 列)}`。
- `clocks`（每用户一行）：`{user_id, now_at}` — 该用户 SimClock。

**每用户视图**（领域/仓储/引擎所见，由 store 装配/回写，保持业务逻辑与存储格式解耦）：`{ user_id, transactions[], refund_applications[], refund_receipts[], issues[](含 tx_ids[]/link_issue_ids[]), issue_events[], reminders[], control{control_state,settings}, clock{now_at} }`。

### 问题状态与结案依据
- 状态：`SUSPECT`(疑似/待处理)、`PENDING_RESOLUTION`(确有问题但未解决=待解决)、`RESOLVED`、`NORMAL`(正常两次购买)、`SELF_RESOLVED`(已自行解决)、`CLOSED`(关闭)。
- 结案依据 `closure_basis`：`VERIFIED_BY_REFUND`(退款全额到账，仅退款类)、`USER_CONFIRMED`(疑似重复须用户明确确认解决，标"用户确认"而非"验证退款")、`USER_MARKED_NORMAL`、`USER_SELF_RESOLVED`、`USER_CLOSED`。**发过提醒不算解决**。

## 核心业务规则（从需求提炼，需可核对）
1. **疑似重复检测**：同用户+同商户+同金额+发生时间差 ≤ 10 分钟+不同编号 → 每个**无序交易对**建**且仅建一条** `SUSPECT` 问题；三笔两两满足 → 三条问题并用 `link_issue_ids` 明确关联；措辞为"疑似"，**不得**表述为"三笔已证实错误扣款"。重放同一批交易不新增问题、不重开已判"正常"的对。
2. **退款逾期**：按 `refund_id` 关联申请与到账，先到账也保留、齐全再判断；`received = Σ 去重到账`，`remaining = expected - received`（部分到账显示差额）；当 `now ≥ confirmed_at + 72h` 且 `received < expected` → 触发逾期提醒；`received ≥ expected`（全额到账）才判 `RESOLVED/VERIFIED_BY_REFUND`。**全额先于申请到账**时：齐全即显示到账并结案，**不发过期逾期消息**。
3. **提醒调度**：首次提醒不计追加；无回复时自上次 ≥ 24h 追加，**最多两次**（≈ first+24h、first+48h，之后不催）；**新数据不重置计数**；用户"确有问题"后停无回复催办，只等事实或下一明确约定；"明天再提醒"默认 +24h，且 `next_due = max(既有最早到期, now+24h)`，**次数不清零**；若给明确日期无时点→澄清时点（默认沿用当前时钟时点并标注为澄清项）。
4. **用户标记**：正常两次购买→`NORMAL` 不重开；确有问题→`PENDING_RESOLUTION`（待解决，≠解决）；已自行解决→`SELF_RESOLVED`；关闭→`CLOSED`，关闭后新事实**只补记录不重开、不催**（场景9），但**新独立交易对仍可形成新问题**。
5. **持续工作与用户控制**：暂停=停主动提醒与新操作、可查已有记录；恢复=按最新数据设置检查、**不补发暂停期间每条过期提醒**、不清空次数与处理记录；关闭=停自动推进，重开需用户明确要求；中断恢复（进程重启）=从 JSON 读回计数与处理状态，不遗失已确认结果、不重复处理同一事实（场景10）。
6. **消息语义**：发送前已接受关闭→不能继续发；发送后关闭→不声称撤回；已提交但结果未知→标 UNKNOWN、说明未知并核实、不盲目重试、不把关闭视为已撤销。
7. **隔离与授权**：所有访问按 `userId` 作用域（单 `db.json` 关系表按 `user_id` 外键过滤）；CLI 强制 `--user`；外部说明不能代替用户授权、不得访问他人数据。

## 系统架构与模块（`src/`）
- `store/jsonStore.js`：加载/保存单一 `data/db.json`（MySQL 式关系表：顶层 `{version,tables}`，行带 `user_id`），负责 **关系表 ↔ 每用户视图** 装配/回写（`loadScoped`/`saveScoped`/`clearUser`）、`version:1` 旧文档结构自动迁移、原子写入（临时文件 + rename）、按 `user_id` 过滤实现隔离；配套 `scripts/init-db.js` 提供 `init/reset` 以便重复测试。
- `domain/`（纯逻辑，无 I/O，单测重点）：`money.js`、`simClock.js`、`rules.js`(10min/72h/24h/max2 常量)、`duplicateDetector.js`、`refundTracker.js`、`reminderScheduler.js`、`issueStateMachine.js`。
- `repo/`（基于 jsonStore，userId 作用域 + 幂等写入）：`transactionRepo`、`refundRepo`、`issueRepo`、`reminderRepo`、`eventRepo`、`controlRepo`。
- `app/`（编排）：`ingestService`（幂等导入→触发 tick）、`followUpEngine`（`tick()`：检测/更新/调度/发送，遵守控制态与幂等）、`userService`（标记与控制态）、`queryService`（列表/详情/进展报告，支持"离开再回来了解进展"）、`messaging`（模拟发送 + 关闭前/后语义 + 未知结果）。
- `cli.js`：`init|reset`、`ingest-tx|ingest-refund|ingest-receipt`、`advance <duration>`、`mark <issueId> <action>`、`control <pause|resume|close|reopen>`、`list|show <issueId>|report`，全局 `--user <id>`。

### 目录结构
```
bill/
├─ package.json  README.md(交付2)
├─ docs/{DESIGN.md(交付4), ACCEPTANCE.md(交付3), CHANGELOG.md(交付1修改说明)}
├─ .gitignore(data/, node_modules/)
├─ src/{cli.js,config.js,store/,domain/,repo/,app/}
├─ scripts/init-db.js(init/reset, 便于重复测试)
├─ tests/unit-test/*.test.js(helpers)      # 单元测试（node --test）
├─ tests/integration-test/scenario1..10.js, run-all.js, harness.js   # 进程内验收/集成
├─ tests/e2e-test/e2e-cli.js               # 真·端到端 CLI 验收
└─ data/db.json(单文件存所有用户)
```

## 验收场景覆盖映射（各场景独立用户、可重放）
| # | 场景 | 主要覆盖模块 | 预期要点 |
|---|------|-------------|---------|
| 1 | 09:00/09:05 各30元不同编号 | duplicateDetector | 一条 SUSPECT，不删交易 |
| 2 | 说买了两次并重放 | stateMachine+幂等 | 记 NORMAL，重放不重开 |
| 3 | 09:00/09:05/09:09 各30元 | duplicateDetector+link_issue_ids | 三对三条且关联，重放不新增 |
| 4 | 应退100，72h未到，再到60及40 | refundTracker | 先剩40→最终 RESOLVED，重放不累计 |
| 5 | 全额到账先于申请 | refundTracker | 齐全即显示到账，不发过期逾期消息 |
| 6 | 首次提醒后持续不回复 | reminderScheduler | ≥24h/≥48h 各追加一次，之后不催 |
| 7 | 明天再提醒 | reminderScheduler | 至少延后24h，次数不清零 |
| 8 | 确认重复但无解决结果 | stateMachine | PENDING_RESOLUTION(待解决) |
| 9 | 关闭后到账 | engine+stateMachine | 补事实，不重开不催 |
| 10 | 提醒后中断恢复 | 持久化+engine | 保留计数与处理状态 |

## 交付物映射（交付 1–6）
- **交付1**：完整源码 + `docs/CHANGELOG.md`(修改说明) + `README` 依赖/配置示例 + `tests/` 测试数据（三层测试均自建数据）；**无第三方运行时依赖（仅 Node 内置模块）**，注明自研组件与改动；不含真实密钥/私人数据。
- **交付2**：`README.md` — 干净环境启动、输入需求、推进模拟时间/事件、查看结果、运行验收的命令说明（不必等真实数天）。
- **交付3**：`docs/ACCEPTANCE.md` — 逐项验收记录（场景/输入/预期/实际/证据位置），可由 `tests/integration-test/run-all.js` 与 `tests/e2e-test/e2e-cli.js` 输出汇总；如实写未实现/失败/修复复测。
- **交付4**：`docs/DESIGN.md` — 简短设计（需求理解、进展保留、条件变化/未知结果处理、取舍，区分实现与设想）。
- **交付5**：`tests/integration-test/run-all.js` + 一个带旁白的 `demo` 脚本作为**等价可重放演示**（涵盖正常/异常/核验）；真实录屏由用户按需录制，不替代源码与运行说明。
- **交付6**：AI/Agent 协作记录直接由 **Qoder 会话历史导出**满足（用户可自行获取 Qoder 历史），**不再单独维护 ai-history.txt**；导出内容允许脱敏，缺失部分如实标注、不伪造、不以总结冒充。

## 任务分解（里程碑级，不过度细化）
- **T1 脚手架与持久化基础**：`package.json`、目录、`store/jsonStore.js`（单 `data/db.json` 加载/保存/原子写/初始结构）、`scripts/init-db.js`（`init/reset` 建立/重建空库，便于重复测试）、npm scripts、`.gitignore`、`config.js`。
- **T2 基础领域件**：`money`(分/RMB)、`simClock`(每用户 advance/now、北京时间格式化)、`rules` 常量。
- **T3 疑似重复检测**：配对(≤10min/同商户同额不同号)、每无序对去重、三笔→三条并关联、疑似措辞、重放不新增/不重开。
- **T4 退款跟踪**：申请/到账按 refund_id 关联、先到账保留、按 receipt_id 幂等聚合、差额、72h 逾期判定、全额到账=解决、场景5不发过期消息。
- **T5 提醒调度**：首次+≥24h最多2次追加、新数据不重置、确有问题停催、明天再提醒(max(既有最早, now+24h)、次数不清零、明确日期澄清时点)。
- **T6 状态机与处理历史**：状态/结案依据、append-only `issue_events`、关闭后补事实不重开、新独立对可成新问题。
- **T7 仓储层与用户隔离**：`repo/*` 基于 jsonStore 的「每用户视图」（store 按 `user_id` 过滤装配/整组回写）+ 幂等写入（按业务唯一键去重），无跨用户访问。
- **T8 跟进引擎与控制态**：`followUpEngine.tick()` 触发点；暂停/恢复(不补发过期、不清计数)/关闭(停自动推进)/重开(需明确)；发送前关闭不发、发后不撤回、未知结果标注核实不盲目重试；中断恢复保留计数与状态。
- **T9 消息与诚实性 + 查询报告**：`messaging`、`queryService`（list/show/report，进展摘要），缺失/失败/未知如实呈现。
- **T10 CLI**：`cli.js` 全命令 + `--user`。
- **T11 验收场景脚本 1–10**：`tests/integration-test/scenario1..10.js` + `run-all.js`，运行前 `reset` 重建 `db.json`、每场景独立 userId、可重放、打印预期/实际/PASS-FAIL。
- **T12 测试**：`node:test` 覆盖配对/退款聚合/提醒调度/幂等/引擎主路径 + 关键边界。
- **T13 文档与交付物**：README(交付2)、DESIGN(交付4)、ACCEPTANCE(交付3)、CHANGELOG(交付1)、三层测试数据(交付1，均自建)、demo 脚本(交付5)；交付6 由 Qoder 会话历史导出，无需单独文件。

## 测试计划
- 单元测试（`tests/unit-test/`）：`duplicateDetector`(2笔成对/3笔三对关联/边界10min/重放不新增)、`refundTracker`(部分到账差额/全额解决/先到账后申请不发逾期/receipt 幂等)、`reminderScheduler`(首次+两次追加后停/明天再提醒取较晚且不清零/确有问题停催/新数据不重置)、`idempotency`(交易/到账重放)、`engine`(暂停不补发、关闭后补事实不重开、重启恢复计数)。
- 场景测试（`tests/integration-test/`，**进程内**）：`run-all.js` 逐场景重建干净节点（每用户独立临时库）；10 个可重放脚本各用独立 userId 互不串扰、直调服务层并 assert 预期，汇总 PASS/FAIL，作为交付3证据与交付5演示。
- 端到端测试（`tests/e2e-test/e2e-cli.js`，**真·进程**）：逐条 `spawn` 独立 `node src/cli.js` 子进程复现同 10 场景（`npm run e2e`），读写独立临时库；因每命令为独立进程，额外真实覆盖跨进程持久化/中断恢复，与 `run-all.js` 互为补证。

## 已确认的关键假设与决策
- 采用 ESM + Node>=20 + `node:test`；**无第三方运行时依赖**；持久化为**单一 `data/db.json`（MySQL 式关系表，行以 `user_id` 外键归属用户实现隔离）**；提供 `scripts/init-db.js`（init/reset）便于重复测试；SimClock 每用户独立。
- 场景中 09:00/09:05 等按北京时间、固定模拟起始日解释。
- "明天再提醒"若只给日期无时点，默认沿用当前时钟时点并在输出中标注为默认假设。
- 交付5 以可重放脚本等价演示，真实录屏由用户录制。
- 交付6 由 Qoder 会话历史导出满足

