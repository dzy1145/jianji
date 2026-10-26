// 展示账本口径校验
//
//   node scripts/check-display-ledger.mjs     应输出「✓ 全部 N 项通过」并以 exit 0 结束
//
// 断言的是需求文档里写明的样例和口径（保留尾数 6 个例子、比例 0、私人过滤、
// 「已夸大 / 仍需假帐」公式、改金额或类别丢弃旧调整、比例设为 1 的重置）。
// 改 displayLedger.js 的算法后必须重新跑这里，不然真机上错了很难看出来。
//
// 为什么要绕一道 data: URL：src/services 下都是 ESM，而 package.json 没有
// "type": "module"，Node 会把 .js 当 CJS 解析、直接拒绝。displayLedger.js 因此
// 刻意零依赖，这样源码可以直接当模块求值。import 了别的文件的话这里会解析失败。

import { readFileSync } from 'node:fs'

const sourcePath = new URL('../src/services/displayLedger.js', import.meta.url)
const source = readFileSync(sourcePath, 'utf8')
const {
  addVirtualBill,
  applyRatio,
  buildDisplayLedger,
  decimalPlaces,
  emptyMonthState,
  finalizeAmount,
  clearRowRaw,
  loadDisplayState,
  pruneDisplayState,
  saveDisplayState,
  setCategoryRatio,
  setRowExact,
  setMonthTarget,
  setRowRaw,
  toExportBills
} = await import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`)

// ledger.js 同样零 import（uni 只在运行时函数里用到），可以直接求值。
// 把展示账本的导出产物真的喂给导出/统计函数渲染一遍，而不是只看 toExportBills 的形状
const ledgerSource = readFileSync(new URL('../src/services/ledger.js', import.meta.url), 'utf8')
const { buildExportText, getCategoryStats, getMonthStats } = await import(
  `data:text/javascript;base64,${Buffer.from(ledgerSource, 'utf8').toString('base64')}`
)

let passed = 0
const failures = []

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed += 1
    return
  }
  failures.push(`${label}\n    期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function bill(id, amount, extra = {}) {
  return {
    id,
    amount,
    category: 'food',
    note: '',
    date: '2026-09-10',
    month: '2026-09',
    timestamp: 1000 + id,
    refunded: false,
    is_private: false,
    type: 'expense',
    ...extra
  }
}

/* ---------- 保留尾数 ---------- */

check('小数位数 15 → 0', decimalPlaces(15), 0)
check('小数位数 15.5 → 1', decimalPlaces(15.5), 1)
check('小数位数 12.99 → 2', decimalPlaces(12.99), 2)

check('保留尾数 12.99×1.2', applyRatio(12.99, 1.2, true), 15.99)
check('保留尾数 15.5×1.2', applyRatio(15.5, 1.2, true), 18.5)
check('保留尾数 15×1.1', applyRatio(15, 1.1, true), 16)
check('关尾数 15×1.1 → 17', applyRatio(15, 1.1, false), 17)
check('关尾数 18.4×1.3 → 23.9', applyRatio(18.4, 1.3, false), 23.9)
check('关尾数 12.99×1.2 → 15.59', applyRatio(12.99, 1.2, false), 15.59)

// 边界：比例 0 时忽略保留尾数，不能算出 0.99 这种鬼数
check('比例 0（开尾数）', applyRatio(12.99, 0, true), 0)
check('比例 0（关尾数）', applyRatio(12.99, 0, false), 0)
check('滑块拖到 0', finalizeAmount(0, 12.99, true), 0)
check('滑块 18.24 + 尾数 → 18.99', finalizeAmount(18.24, 12.99, true), 18.99)
check('比例 1 就是真实金额', applyRatio(12.99, 1, true), 12.99)
check('比例 1（关尾数）也是真实金额', applyRatio(12.99, 1, false), 12.99)
check('比例溢出上限被夹到 3', applyRatio(10, 9, true), 30)

/* ---------- 行派生与合计 ---------- */

const bills = [
  bill(1, 12.99), // 非私人支出
  bill(2, 50, { is_private: true }), // 私人，只进目标、不进展示账本
  bill(3, 500, { type: 'income' }), // 收入，展示账本整个不管
  bill(4, 15, { category: 'transport', refunded: true }), // 已退款：显示 0.00，不进合计
  bill(5, 8, { month: '2026-08' }) // 别的月份
]

const monthState = emptyMonthState()
monthState.ratios.food = 1.2
monthState.target = 100

const ledger = buildDisplayLedger({ bills, month: '2026-09', monthState, keepTail: true })

check('展示行只含本月非私人支出', ledger.rows.map((row) => row.id).sort(), [1, 4])
check('12.99 按 1.2 放大', ledger.rows.find((row) => row.id === 1).display, 15.99)
check('private 行不出现', ledger.rows.some((row) => row.id === 2), false)
check('已退款行展示 0', ledger.rows.find((row) => row.id === 4).display, 0)
check('真实合计不含已退款和私人', ledger.realTotal, 12.99)
check('展示合计不含已退款', ledger.displayTotal, 15.99)
check('私人支出合计只算未退款支出', ledger.privateTotal, 50)
check('目标 = 私人 + 想攒', ledger.target, 150)
check('已夸大 = 展示 − 真实', ledger.inflated, 3)
check('仍需假帐 = 目标 − 已夸大', ledger.remaining, 147)
check('进度 = 已夸大 / 目标', ledger.progress, 0.02)

// 比例设成 0：该类别展示金额归零，已夸大变负（超出）
const zeroRatio = emptyMonthState()
zeroRatio.ratios.food = 0
const zeroLedger = buildDisplayLedger({ bills, month: '2026-09', monthState: zeroRatio, keepTail: true })
check('比例 0 的类别展示 0', zeroLedger.rows.find((row) => row.id === 1).display, 0)
check('已夸大可为负', zeroLedger.inflated, -12.99)
check('目标为 0 时进度为 0', buildDisplayLedger({ bills: [], month: '2026-09', monthState: emptyMonthState(), keepTail: true }).progress, 0)

/* ---------- 单笔调整与失效 ---------- */

// 写函数收的是整棵 state（{ keepTail, months }），buildDisplayLedger 收的是单月那层，
// 两个别搞混——monthOrEmpty 缺月时会返回一个用完就丢的对象，写进去等于没写
function root(month = '2026-09') {
  return { keepTail: true, months: { [month]: emptyMonthState() } }
}

function monthOf(state, month = '2026-09') {
  return state.months[month]
}

function rowDisplay(state, id, month = '2026-09') {
  return buildDisplayLedger({ bills, month, monthState: monthOf(state, month), keepTail: true })
    .rows.find((row) => row.id === id)
}

const adjusted = root()
adjusted.months['2026-09'].ratios.food = 1.2
setRowRaw(adjusted, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, 20)
check('单笔 raw 生效并保留尾数', rowDisplay(adjusted, 1).display, 20.99)
check('单笔调整标记 manual', rowDisplay(adjusted, 1).manual, true)

/* ---------- 手动敲定的展示金额（exact） ---------- */

// 需求：展示金额可以直接点开来改。敲定的数字必须原样生效——保留尾数开着时
// 12.99 那行输 18.88，不能变成 18.99
const typed = root()
typed.months['2026-09'].ratios.food = 1.2
setRowExact(typed, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food', sliderMax: 38.97 }, 18.88)
check('敲定的金额原样生效（绕过保留尾数）', rowDisplay(typed, 1).display, 18.88)
check('敲定后仍是手动行', rowDisplay(typed, 1).manual, true)
check('敲定后滑块位置记为同一个数', rowDisplay(typed, 1).raw, 18.88)
check('切片合计用敲定的金额', buildDisplayLedger({
  bills,
  month: '2026-09',
  monthState: monthOf(typed),
  keepTail: true
}).displayTotal, 18.88)

// 拖滑块 = 重新走比例/尾数，敲定的数字作废
setRowRaw(typed, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, 20)
check('拖滑块后敲定的数字作废', rowDisplay(typed, 1).display, 20.99)

// 重置（↺）也要清掉敲定的数字
setRowExact(typed, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, 18.88)
clearRowRaw(typed, '2026-09', rowDisplay(typed, 1))
check('重置后回到真实金额', rowDisplay(typed, 1).display, 12.99)

// 敲 0 是合法的（导出时会被丢掉），负数/非数字不接受
setRowExact(typed, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, 0)
check('可以敲成 0', rowDisplay(typed, 1).display, 0)
check('负数不接受', setRowExact(typed, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, -1), null)

// 虚拟账单同样可以敲定
const typedVirtual = root()
addVirtualBill(typedVirtual, '2026-09', { amount: 10, category: 'food', note: '', date: '2026-09-11' })
setRowExact(typedVirtual, '2026-09', { source: 'virtual', vid: 1, amount: 10, category: 'food' }, 33.5)
const typedVirtualRow = buildDisplayLedger({
  bills: [],
  month: '2026-09',
  monthState: monthOf(typedVirtual),
  keepTail: true
}).rows[0]
check('虚拟账单可以敲定金额', typedVirtualRow.display, 33.5)
check('虚拟账单敲定后带 exact', typedVirtualRow.exact, 33.5)

// 真实账本把金额从 12.99 改成 13.99：旧调整必须失效，回到「新金额 × 比例」
const changed = [bill(1, 13.99)]
const stale = buildDisplayLedger({ bills: changed, month: '2026-09', monthState: monthOf(adjusted), keepTail: true })
check('改金额后旧调整失效', stale.rows[0].display, applyRatio(13.99, 1.2, true))
check('改金额后不再是手动', stale.rows[0].manual, false)
check('失效的调整被 prune 清掉', pruneDisplayState(adjusted, changed), true)
check('prune 后存储里没有残留', Object.keys(monthOf(adjusted).overrides), [])

// 类别也改了：同样失效
const adjusted2 = root()
setRowRaw(adjusted2, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, 20)
const recat = [bill(1, 12.99, { category: 'shopping' })]
const recatLedger = buildDisplayLedger({ bills: recat, month: '2026-09', monthState: monthOf(adjusted2), keepTail: true })
check('改类别后旧调整失效', recatLedger.rows[0].display, 12.99)
// 12.99 × 1.5 = 19.485 → 取整数 19 + 真实尾数 .99 = 19.99
check('改类别后按新类别比例算', buildDisplayLedger({
  bills: recat,
  month: '2026-09',
  monthState: (() => {
    const state = emptyMonthState()
    state.ratios.shopping = 1.5
    return state
  })(),
  keepTail: true
}).rows[0].display, 19.99)

// 标私人：行消失、调整作废；取消私人后回到真实金额
const privateBills = [bill(1, 12.99, { is_private: true })]
check('标私人后展示账本为空', buildDisplayLedger({ bills: privateBills, month: '2026-09', monthState: monthOf(adjusted2), keepTail: true }).rows.length, 0)
check('标私人后调整被 prune 清掉', pruneDisplayState(adjusted2, privateBills), true)
const backToPublic = buildDisplayLedger({ bills: [bill(1, 12.99)], month: '2026-09', monthState: monthOf(adjusted2), keepTail: true })
check('取消私人后回到真实金额', backToPublic.rows[0].display, 12.99)
check('取消私人后不跟随批量调整', backToPublic.rows[0].manual, false)

/* ---------- 比例设为 1 = 全局重置 ---------- */

const resetRoot = root()
const reset = monthOf(resetRoot)
reset.ratios.food = 1.2
reset.ratios.transport = 2
reset.overrides['1'] = { raw: 20, base: 12.99, cat: 'food' }
reset.overrides['4'] = { raw: 30, base: 15, cat: 'transport' }
addVirtualBill(resetRoot, '2026-09', { amount: 10, category: 'food', note: '', date: '2026-09-11' })
setRowRaw(resetRoot, '2026-09', { source: 'virtual', vid: 1, amount: 10, category: 'food' }, 25)
check('虚拟账单进了这个月', reset.virtual.length, 1)
check('虚拟账单可单笔调整', reset.virtual[0].raw, 25)

const resetResult = setCategoryRatio(resetRoot, '2026-09', 'food', 1)
check('比例 1 报告为重置', resetResult.reset, true)
check('比例 1 后该类别不再存比例', reset.ratios.food, undefined)
check('比例 1 清掉该类别的手动调整', Object.keys(reset.overrides), ['4'])
check('比例 1 清掉该类别虚拟账单的手动调整', reset.virtual[0].raw, null)
check('别的类别不受影响', reset.ratios.transport, 2)
check('虚拟账单回到跟随比例', buildDisplayLedger({
  bills: [],
  month: '2026-09',
  monthState: reset,
  keepTail: true
}).rows[0].display, 10)

const normal = setCategoryRatio(root(), '2026-09', 'food', 1.3)
check('设非 1 比例不算重置', normal.reset, false)

const written = root()
setCategoryRatio(written, '2026-09', 'food', 1.3)
check('比例写进了当月', monthOf(written).ratios.food, 1.3)

/* ---------- 想攒的钱 ---------- */

const targetState = root()
check('想攒的钱写入', setMonthTarget(targetState, '2026-09', 300), 300)
check('想攒的钱落进了当月', monthOf(targetState).target, 300)
check('负数归零', setMonthTarget(targetState, '2026-09', -5), 0)

/* ---------- 导出形状 ---------- */

const exportRows = [
  { source: 'real', display: 15.99, refunded: false, category: 'food', note: '午饭', date: '2026-09-10', month: '2026-09', timestamp: 1, amount: 12.99 },
  { source: 'real', display: 0, refunded: false, category: 'food', note: '比例 0', date: '2026-09-10', month: '2026-09', timestamp: 2, amount: 9 },
  { source: 'real', display: 0, refunded: true, category: 'transport', note: '退款', date: '2026-09-10', month: '2026-09', timestamp: 3, amount: 15 },
  { source: 'virtual', display: 26, refunded: false, category: 'food', note: '虚拟', date: '2026-09-11', month: '2026-09', timestamp: 4, amount: 20 }
]
const exportBills = toExportBills(exportRows)
check('导出丢掉退款和 0 元行', exportBills.length, 2)
check('导出金额用展示金额', exportBills.map((item) => item.amount), [15.99, 26])
check('导出形状是支出', exportBills.every((item) => item.type === 'expense' && item.refunded === false), true)

/* ---------- ↺ 重置：虚拟行分支（用户 2026-10-03 确认保持「回到基准金额」的现状） ---------- */

const resetVirtual = root()
addVirtualBill(resetVirtual, '2026-09', { amount: 10, category: 'food', note: '', date: '2026-09-11' })
setRowRaw(resetVirtual, '2026-09', { source: 'virtual', vid: 1, amount: 10, category: 'food' }, 25)
const virtualRows = () =>
  buildDisplayLedger({ bills: [], month: '2026-09', monthState: monthOf(resetVirtual), keepTail: true }).rows
check('虚拟行可单笔调整', virtualRows()[0].display, 25)
clearRowRaw(resetVirtual, '2026-09', virtualRows()[0])
check('虚拟行 ↺ 后回到基准金额', virtualRows()[0].display, 10)
check('虚拟行 ↺ 后仍算已手动调整', virtualRows()[0].manual, true)

/* ---------- 单笔输入上限走展示口径（displayMax） ---------- */

const capBills = [bill(1, 12.99), bill(2, 8.88)]
const capLedger = buildDisplayLedger({ bills: capBills, month: '2026-09', monthState: emptyMonthState(), keepTail: true })
check('12.99 的展示上限 38.99', capLedger.rows.find((row) => row.id === 1).displayMax, 38.99)
check('8.88 的展示上限 26.88', capLedger.rows.find((row) => row.id === 2).displayMax, 26.88)
check(
  '展示上限 ≥ raw 上限（否则滑块顶端填不进去）',
  capLedger.rows.find((row) => row.id === 1).displayMax >= capLedger.rows.find((row) => row.id === 1).sliderMax,
  true
)
const capOff = buildDisplayLedger({ bills: capBills, month: '2026-09', monthState: emptyMonthState(), keepTail: false })
check('关尾数时展示上限回到 raw 上限', capOff.rows.find((row) => row.id === 1).displayMax, 38.97)

/* ---------- 0 元账单不进展示账本 ---------- */

const zeroRowLedger = buildDisplayLedger({
  bills: [bill(1, 12.99), bill(2, 0)],
  month: '2026-09',
  monthState: emptyMonthState(),
  keepTail: true
})
check('0 元非退款账单不出现在展示账本', zeroRowLedger.rows.some((row) => row.id === 2), false)

/* ---------- prune：账单换月后旧调整要被回收 ---------- */

const movedState = root()
setRowRaw(movedState, '2026-09', { source: 'real', id: 1, amount: 12.99, category: 'food' }, 20)
check('搬月前调整还在', Object.keys(monthOf(movedState).overrides).length, 1)
check('账单换月 → 调整被 prune', pruneDisplayState(movedState, [bill(1, 12.99, { month: '2026-08' })]), true)
check('换月后该月调整已清空', Object.keys(monthOf(movedState).overrides).length, 0)

/* ---------- 导出产物真的过一遍导出/统计渲染 ---------- */

const rendered = buildExportText('2026-09', exportBills, getCategoryStats(exportBills), {})
check('导出文本用了展示金额', rendered.includes('15.99'), true)
check('导出文本标题带范围', rendered.includes('2026-09'), true)
check('导出汇总笔数 = 导出账单数', getMonthStats(exportBills, '2026-09').count, exportBills.length)

/* ---------- 存储层：脏数据容错与回写 ---------- */

const previousUni = globalThis.uni
const store = {}
globalThis.uni = {
  getStorageSync: (key) => store[key],
  setStorageSync: (key, value) => {
    store[key] = value
  }
}
;[undefined, '', 0, 'oops', [], { months: null }, { months: { '2026-09': null } }, { months: { '2026-09': { ratios: 'x', overrides: [], virtual: 'y' } } }].forEach(
  (value, index) => {
    store.jianji_display_ledger = value
    let threw = false
    try {
      loadDisplayState()
    } catch (error) {
      threw = true
    }
    check(`脏存储 #${index} 不抛异常`, threw, false)
  }
)
check('缺 keepTail 时默认开', loadDisplayState().keepTail, true)
saveDisplayState({ keepTail: false, months: loadDisplayState().months })
check('回写保留 keepTail', store.jianji_display_ledger.keepTail, false)
globalThis.uni = previousUni

/* ---------- 结果 ---------- */

if (failures.length) {
  console.error(`✗ ${failures.length} 项不通过（共 ${passed + failures.length} 项）\n`)
  failures.forEach((text) => console.error(`  ✗ ${text}\n`))
  process.exit(1)
}

console.log(`✓ 全部 ${passed} 项通过`)
