# 修改说明 / CHANGELOG

本文件记录实现过程的里程碑与关键改动（交付1 的"修改说明"）。组件均为自研，**无第三方运行时依赖**（仅 Node 内置模块）。

## v0.1.0 — 首个完整可运行版本（T1–T13）

### T1 脚手架与持久化
- `package.json`（ESM、`engines.node>=20`、scripts: test/cli/init/reset/seed/scenarios/demo）。
- `src/config.js`：`ROOT/DATA_DIR/DEFAULT_DB_PATH/FIXTURES_DIR` 与 `resolveDbPath()`（支持 `BILL_DB_PATH` 覆盖，便于测试用独立临时库）。
- `src/store/jsonStore.js`：单一 `data/db.json`，顶层 `{version, users:{<userId>:<节点>}}`；`defaultUserNode`/`ensureUserNode`；`Store.load/flush`(临时文件+rename 原子写)/`userNode`。
- `scripts/init-db.js`：`init/reset/seed <fixture>`（seed 仅导入基础事实，问题由引擎生成）。
- `.gitignore`：忽略 `node_modules/` 与运行产物 `data/`。

### T2 基础领域件
- `domain/money.js`：整数分与 `yuanToCents/formatRMB`。
- `domain/rules.js`：10min / 72h / 24h / max2 / 明天默认24h 常量。
- `domain/simClock.js`：每用户 SimClock，`beijingMs/formatBeijing/setNow/advance/parseDuration`。

### T3 疑似重复检测
- `domain/duplicateDetector.js`：`findDuplicatePairs`（按时间升序、超窗 break、同商户同额不同号、无序对去重）、`duplicateIssueId`（确定性 id 实现幂等）、`buildLinkMap`（并查集，>1 组件才关联）。

### T4 退款跟踪
- `domain/refundTracker.js`：`refundIssueId`、`sumReceipts`(去重求和)、`computeRefundState`(expected/received/remaining/fully_received/overdue(72h)/note)、`orphanReceipts`。

### T5 提醒调度
- `domain/reminderScheduler.js`：`triggerFor` + `planReminders`（首次不计追加；≥24h 追加、最多2；确有问题停催；明天再提醒取 max 且不清零；暂停不发；恢复不补发；终结态停）。

### T6 状态机与处理历史
- `domain/issueStateMachine.js`：`STATUS/BASIS/MARKS`、`isTerminal`、`resolveByRefund`、`applyMark`（含 NORMAL 仅限疑似、SELF_RESOLVED 依据区分）、`validateMark`。
- `repo/eventRepo.js`：append-only `issue_events`。

### T7 仓储层与隔离
- `repo/{transactionRepo,refundRepo,issueRepo,reminderRepo,controlRepo,idgen}.js`：按业务唯一键幂等写入；仅作用于当前 userId 节点。

### T8 跟进引擎与控制态
- `app/followUpEngine.js`：`tick()` 三段（建疑似+关联 / 退款更新与全额解决 / 按调度发送），遵守控制态与终结态；`reminder_id` 去重防重发。
- `app/messaging.js`：`buildReminderText`（疑似措辞/退款差额）、`sendReminder`（关闭/终结→cancelled）。
- `app/userService.js`：`markIssue`（终结态回滚不重开、仅记事件）、`get/setControl`。

### T9 查询与诚实性
- `app/queryService.js`：`summarize/listIssues/showIssue(时间线)/report(计数+缺口)`。
- `app/ingestService.js`：幂等导入；关闭后到账补 `fact_ingested` 事件。

### T10 CLI
- `src/cli.js`：`init/reset`、`set-now/advance`、`ingest-tx/-refund/-receipt`、`mark`、`control`、`list/show/report`；全局 `--user`。

### T11 验收场景
- `scenarios/harness.js` + `scenario1..10.js` + `run-all.js`（独立 userId+临时库、可重放、打印预期/证据/PASS-FAIL，失败非零退出）。

### T12 测试
- `test/{helpers,domain.test,scheduler.test,engine.test}.js`：`node:test` 25 项，覆盖配对/边界/退款聚合/提醒调度/幂等/引擎/中断恢复。

### T13 文档与交付物
- `README.md`(交付2)、`DESIGN.md`(交付4)、`ACCEPTANCE.md`(交付3)、`CHANGELOG.md`(交付1)、`fixtures/sample.json`(虚构样例+范围声明)、`scripts/demo.js`(交付5)。

## 过程中的关键修正
- **持久化方案**：SQLite → JSON 文件 → **单一 `data/db.json`（按 userId 分组）**，并提供 `init/reset/seed` 脚本保证可重复测试。
- **交付6**：不再维护 `ai-history.txt`，改由 Qoder 会话历史导出满足。
- **场景可重复性**：`harness` 构造函数每次以 `defaultUserNode` 重建干净用户节点，避免临时库跨次累积导致重放误判。
- **场景4 断言取快照**：部分到账后的 `received_cents` 以原始值即时快照，避免同一对象引用被后续全额到账覆盖导致误判。
- **测试命令**：`node --test test/` 在 Node 24 下会把目录当模块解析，改用 `node --test`（自动发现 `*.test.js`）。

## 验证状态
- `node scenarios/run-all.js`：10/10 场景、42/42 断言通过（退出码 0）。
- `node --test`：25/25 通过。
- `node scripts/demo.js`：正常/核验/退款/控制/诚实/重启全流程按预期输出。
- `node src/cli.js`（init→seed→advance→list/report）冒烟通过。
