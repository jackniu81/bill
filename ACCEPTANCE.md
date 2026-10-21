# 验收记录（交付3）

> 复现命令：`npm run scenarios`（即 `node scenarios/run-all.js`）。每场景使用**独立 userId + 独立临时库**、运行前重建干净节点，可重放；输出打印「输入/预期/证据(实际)/PASS-FAIL」并汇总。
> 单元测试：`npm test`（`node --test`）。演示：`npm run demo`。

## 总体结果
- **验收场景：10/10 通过；断言：42/42 通过**（`run-all.js` 退出码 0）。
- **单元测试：25/25 通过**（配对/边界/退款聚合/提醒调度/幂等/引擎/中断恢复）。
- 全部为纯模拟，数据虚构，无真实付款/银行/消息通道。

## 逐场景记录

| # | 场景 | 输入 | 预期 | 实际（证据摘要） | 结果 | 证据位置 |
|---|------|------|------|------------------|------|----------|
| 1 | 疑似重复建一条 | 09:00/09:05 各¥30 TX1/TX2 | 一条 SUSPECT；不删交易 | `dup_issue_ids=["DUP:TX1\|TX2"]`, `transactions=["TX1","TX2"]` | PASS | `scenarios/scenario1.js` |
| 2 | 标正常并重放 | 同上标"正常两次购买"后重放 | NORMAL；重放不重开/不新增 | `status=NORMAL, closure_basis=USER_MARKED_NORMAL, dup_count=1` | PASS | `scenarios/scenario2.js` |
| 3 | 三笔两两成对 | 09:00/09:05/09:09 各¥30 | 三条且互相关联；不称"已证实" | `dup_count=3`，各条 `link_issue_ids` 长度=2，均 SUSPECT | PASS | `scenarios/scenario3.js` |
| 4 | 逾期→部分→全额 | 应退¥100；72h未到；再到60、40；重放 | 逾期提醒；差额40；全额解决；不累计 | `after_overdue=1`, `mid={received:6000,remaining:4000}`, `end={RESOLVED,VERIFIED_BY_REFUND,10000}` | PASS | `scenarios/scenario4.js` |
| 5 | 全额先于申请 | 先到账¥100，随后申请到达 | 齐全即解决；不发逾期 | `orphanGaps=["R2"]`→齐全后 `status=RESOLVED, reminders=0, gapsAfter=0` | PASS | `scenarios/scenario5.js` |
| 6 | 持续不回复 | ¥100 满72h逾期后不回复 | ≥24/48h 各追加，最多两次后不催 | `atOverdue=1, atPlus24=2, atPlus48=3, after=3`；kinds=[first,followup1,followup2] | PASS | `scenarios/scenario6.js` |
| 7 | 明天再提醒 | 首次提醒后回复"明天再提醒" | 至少延后24h；次数不清零 | `rightAfterMark=1, before24h=1, at24h=2`；followup seq=1（不清零） | PASS | `scenarios/scenario7.js` |
| 8 | 确认未解决 | 疑似重复"确有问题"但无解决事实 | PENDING_RESOLUTION（≠解决） | `status=PENDING_RESOLUTION, closure_basis=null` | PASS | `scenarios/scenario8.js` |
| 9 | 关闭后到账 | 逾期后关闭，之后到账 | 只补事实；不重开不催 | `closedStatus=CLOSED`，到账后仍 CLOSED、提醒数不变(=1)、`arrivalFacts=1` | PASS | `scenarios/scenario9.js` |
| 10 | 中断恢复 | 首次提醒后进程重启再推进 | 保留计数与状态，不重复处理 | `afterRestart=1`（不重发），追加后 `afterFu1=2`，二次重启仍 `=2`，最终 `=3` | PASS | `scenarios/scenario10.js` |

## 单元测试覆盖（`test/`）
- `domain.test.js`：money 取整/格式化；simClock 北京时间解析/格式化/时长；重复配对(≤10min 边界含 10min、>10min 排除、异商户/异额排除)、三笔并查集全关联、issue_id 顺序无关；退款部分/全额/逾期边界、孤儿到账诚实标注。
- `scheduler.test.js`：逾期发 first 不计追加；<24h 不追加、≥24h/≥48h 各追加、达上限停止；确有问题停催；明天再提醒取 max 且不清零；暂停/关闭不发；恢复不补发；终结态不发。
- `engine.test.js`：重复建一条+首次提醒+重放不新增/不重发；三笔三条关联；退款逾期提醒→全额解决→重放不累计；全额先于申请不发逾期；标 NORMAL 重放不重开；closed 逾期不发；落盘重读计数与状态保留、不重复处理。

## 诚实性/边界核对（对照需求）
- 疑似不称已证实：措辞含"疑似""尚未证实"（`messaging.buildReminderText`），场景3断言通过。✅
- 发过提醒不算解决：仅 `received ≥ expected` → `RESOLVED/VERIFIED_BY_REFUND`；部分到账保持 SUSPECT。✅
- 缺失/未知如实呈现：孤儿到账进 `report.gaps` 且标注，场景5断言通过。✅
- 用户控制与不重开：场景2/9 断言"重放不重开""关闭后不重开不催"。✅
- 中断恢复不重复处理：场景10 断言重启后不重发、继续按规则追加。✅

## 已知限制（如实标注，不影响上述验收）
- 纯模拟：无真实发送通道，`reminders.status` 的 `unknown` 分支已就位但当前不自然产生（详见 `DESIGN.md`）。
- 演示为可重放脚本等价物（交付5）；真实录屏由用户按需录制。
- 交付6 AI 协作记录由 Qoder 会话历史导出满足，未单独维护文件。
