# 修改说明 / CHANGELOG

本文件记录实现过程的里程碑与关键改动（交付1 的"修改说明"）。组件均为自研，**无第三方运行时依赖**（仅 Node 内置模块）。

## v0.2.2 — 测试目录重组：`test/` + `scenarios/` → `tests/`（三层子目录）
> 将全部测试按类型集中到 `tests/` 下三个子目录（`git mv` 保留历史）；业务代码（`src/`）零改动。
- `tests/unit-test/`：原 `test/` 的 `helpers.js` + `domain/scheduler/engine.test.js`（`../src` → `../../src`）。
- `tests/integration-test/`：原 `scenarios/` 的 `harness.js` + `scenario1..10.js` + `run-all.js`（仅 `harness.js` 的 `../src` → `../../src`；同目录内 `./harness.js`/`./scenarioN.js` 引用不变）。
- `tests/e2e-test/e2e-cli.js`：原 `scenarios/e2e-cli.js`；因下沉一层，`new URL('..')` → `new URL('../..')` 以正确定位仓库根。
- `package.json`：脚本改指新路径；新增与子目录同名的 `unit-test`/`integration-test`/`e2e-test`（保留 `scenarios`/`e2e` 别名）。
- 计数修正：单元用例真实为 **24**（旧 `node --test` 报 25 是因为 `test/` 目录名命中 `**/test/**` 规则、将无 `test()` 的 `helpers.js` 多计 1 项；迁入 `unit-test/` 后不再误计）。未丢失任何用例（与 HEAD 逐文件核对：domain 9 + scheduler 8 + engine 7 = 24）。
- 文档同步：`README.md`、`ACCEPTANCE.md`、`DESIGN.md`、`specs/spec.md` 中的 `test/`与`scenarios/` 路径均更新为 `tests/*`。
- **验证**：`node --test` 24/24、`node tests/integration-test/run-all.js` 10/10(42/42)、`node tests/e2e-test/e2e-cli.js` 10/10(37/37) 均退出码 0。

## v0.2.1 — 新增 CLI 端到端验收（`scenarios/e2e-cli.js`）
> 在既有三层测试（单测 / 进程内验收）基础上补齐**真·端到端**：逐条 `spawn` 独立 `node src/cli.js` 子进程复现 10 个验收场景。
- `scenarios/e2e-cli.js`：用 `child_process.execFileSync` 逐条驱动真实 CLI（每命令一个独立进程），写入独立临时库（`BILL_DB_PATH` 指向 `os.tmpdir()`），逐场景 `reset` + 独立 `u1…u10`；输出与 `run-all.js` 同款「输入/预期/证据/✓✗ + PASS-FAIL 汇总」，任一失败非零退出；`finally` 清理临时库。
- **零依赖 `src/`**：断言助手 `check()` 内联（不再 `import` `harness.js`），`e2e-cli.js` 仅 `import` Node 内置模块（`node:child_process/os/path/fs/url`）——只要 CLI 输入/输出契约不变，业务模块重构不牵连本 e2e 套件。
- `package.json`：新增脚本 `"e2e": "node scenarios/e2e-cli.js"`。
- 文档同步：`README.md`（新增“测试分层”表与 `npm run e2e`）、`ACCEPTANCE.md`（新增端到端证据层）。
- **验证**：`node scenarios/e2e-cli.js` → 10/10 场景、37/37 断言通过（退出码 0）。

## v0.2.0 — 存储改为 MySQL 式关系表（仍用单一 `db.json`）
> 将 `data/db.json` 由文档式（`{version, users:{<userId>:<节点>}}`）改为**结构化关系表**，业务逻辑（domain/repo/app/engine）保持不变。
- `src/store/jsonStore.js`：顶层改为 `{version:2, tables:{<表名>:[行…]}}`；新增表清单 `TABLES` 与 `emptyDb`；`loadScoped`/`saveScoped` 完成 **关系表 ↔ 每用户视图** 的双向装配/整组回写，多对多规范化到关联表 `issue_txs`/`issue_links`；`controls`/`clocks` 每用户一行；`clearUser` 供测试重建干净视图；`normalizeToTables` + `migrateV1toV2` 自动兼容旧 `version:1` 文档结构。
- `src/cli.js`：`init/reset` 改用 `emptyDb()`，不再依赖 `ensureUserNode`。
- `scripts/init-db.js`：`seed` 写入关系表（`ensureUser` + `saveScoped`）。
- `scenarios/harness.js`：改为 `store.clearUser(userId)` 重建干净视图，保证场景可重放、互不串扰。
- `specs/spec.md`、`README.md`、`DESIGN.md` 数据模型描述同步更新为关系表。
- **验证**：10/10 场景、42/42 断言、`node --test` 25/25、CLI 写盘与 junction 表（`issue_txs`/`issue_links`）回环均通过。

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
- **持久化方案**：SQLite → JSON 文件 → 单一 `data/db.json`（按 userId 分组）→ **MySQL 式关系表（行带 `user_id` 外键 + 关联表）**，仍以单一 `db.json` 存储；提供 `init/reset/seed` 脚本与旧文档结构自动迁移，保证可重复测试。
- **交付6**：不再维护 `ai-history.txt`，改由 Qoder 会话历史导出满足。
- **场景可重复性**：`harness` 构造函数每次以 `defaultUserNode` 重建干净用户节点，避免临时库跨次累积导致重放误判。
- **场景4 断言取快照**：部分到账后的 `received_cents` 以原始值即时快照，避免同一对象引用被后续全额到账覆盖导致误判。
- **测试命令**：`node --test test/` 在 Node 24 下会把目录当模块解析，改用 `node --test`（自动发现 `*.test.js`）。

## 验证状态
- `node scenarios/run-all.js`：10/10 场景、42/42 断言通过（退出码 0）。
- `node scenarios/e2e-cli.js`：10/10 场景、37/37 断言通过（真·CLI 子进程，退出码 0）。
- `node --test`：25/25 通过。
- `node scripts/demo.js`：正常/核验/退款/控制/诚实/重启全流程按预期输出。
- `node src/cli.js`（init→seed→advance→list/report）冒烟通过。
