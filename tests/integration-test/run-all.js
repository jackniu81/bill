// 验收场景汇总：按序运行 scenario1–10，逐条打印 预期/证据/结果，末尾汇总 PASS/FAIL。
// 任一条 check 失败则进程以非零码退出（作为交付3验收证据）。
import * as s1 from './scenario1.js';
import * as s2 from './scenario2.js';
import * as s3 from './scenario3.js';
import * as s4 from './scenario4.js';
import * as s5 from './scenario5.js';
import * as s6 from './scenario6.js';
import * as s7 from './scenario7.js';
import * as s8 from './scenario8.js';
import * as s9 from './scenario9.js';
import * as s10 from './scenario10.js';

const modules = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10];

let totalChecks = 0;
let failedChecks = 0;
const scenarioResults = [];

for (const m of modules) {
  const { meta } = m;
  console.log('\n' + '='.repeat(72));
  console.log(`场景 ${meta.n}：${meta.name}`);
  console.log(`  输入：${meta.input}`);
  console.log(`  预期：${meta.expected}`);
  console.log('-'.repeat(72));

  let result;
  let runErr = null;
  try {
    result = m.run();
  } catch (e) {
    runErr = e;
  }

  if (runErr) {
    console.log(`  ✗ 运行异常：${runErr && runErr.message}`);
    if (runErr && runErr.stack) console.log(runErr.stack.split('\n').slice(1, 3).join('\n'));
    scenarioResults.push({ n: meta.n, name: meta.name, ok: false, passed: 0, failed: 1 });
    failedChecks += 1;
    totalChecks += 1;
    continue;
  }

  console.log(`  证据：${JSON.stringify(result.evidence)}`);
  let passed = 0;
  let failed = 0;
  for (const c of result.checks) {
    totalChecks += 1;
    if (c.ok) {
      passed += 1;
      console.log(`    ✓ ${c.desc}`);
    } else {
      failed += 1;
      failedChecks += 1;
      console.log(`    ✗ ${c.desc}${c.err ? '（异常：' + c.err + '）' : ''}`);
    }
  }
  scenarioResults.push({ n: meta.n, name: meta.name, ok: failed === 0, passed, failed });
}

console.log('\n' + '='.repeat(72));
console.log('验收汇总');
console.log('='.repeat(72));
for (const r of scenarioResults) {
  const flag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${flag}] 场景 ${String(r.n).padStart(2)}  ${r.name}  （通过 ${r.passed} / 失败 ${r.failed}）`);
}
const scenariosFailed = scenarioResults.filter((r) => !r.ok).length;
console.log('-'.repeat(72));
console.log(`  场景：${scenarioResults.length - scenariosFailed}/${scenarioResults.length} 通过；断言：${totalChecks - failedChecks}/${totalChecks} 通过`);

if (failedChecks > 0) {
  console.log('\n结果：FAIL（存在未通过项，如实呈现，不伪装为通过）');
  process.exit(1);
} else {
  console.log('\n结果：PASS（全部验收场景通过）');
}
