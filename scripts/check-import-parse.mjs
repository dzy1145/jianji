// 导入解析校验
//
//   node scripts/check-import-parse.mjs      应输出「✓ 全部 N 项通过」并以 exit 0 结束
//
// 覆盖 2026-10-03 那轮全量审查挖出来的导入缺陷（严重 1「汇总行被当账单」、
// 中等 7-12）。这些直接写库、写错就是数据污染，所以单独立一个脚本盯着。
//
// ledger.js 只在运行时函数里用到 uni，模块求值不需要，可以直接当模块跑。

import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/services/ledger.js', import.meta.url), 'utf8')
const { parseMiniProgramBillText, buildExportText, importBills } = await import(
  `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
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

/* ---------- 严重 1：没有「── 明细 ──」就不解析 ---------- */

const summaryOnly = `【简记】2026-09 账单
我的总支出：51.07 元，共 3 笔

── 分类占比 ──
🛍️ 购物：29.09 元（57%）
🍜 餐饮：12.37 元（24.2%）
🧋 奶茶饮品：9.61 元（18.8%）`
const noDetail = parseMiniProgramBillText(summaryOnly)
check('无明细标记 → 0 条', noDetail.bills.length, 0)
check('无明细标记 → noDetail', noDetail.noDetail, true)

// 汇总块排在明细之后也不能被当成账单（位置防线之外再加语义防线）
const reordered = `── 明细 ──
2026-09-01 🍜餐饮 51.07元 我的
我的总支出：51.07 元，共 3 笔

── 分类占比 ──
🍜 餐饮：12.37 元（24.2%）`
check('汇总块在明细后 → 只留 1 条', parseMiniProgramBillText(reordered).bills.length, 1)

/* ---------- 正常文本 ---------- */

const normal = `【简记】2026-09 账单
我的总支出：51.07 元，共 2 笔

── 分类占比 ──
🍜 餐饮：12.37 元（24.2%）

── 明细 ──
2026-09-01 12:30 🍜餐饮 39.90元 饼干
2026-09-02 18:00 🧋奶茶饮品 12.37元 奶茶`
const parsedNormal = parseMiniProgramBillText(normal)
check('正常 2 条', parsedNormal.bills.length, 2)
check('正常金额', parsedNormal.bills.map((item) => item.amount).sort((a, b) => a - b), [12.37, 39.9])
check('正常分类', parsedNormal.bills.map((item) => item.category).sort(), ['drink', 'food'])
check('正常备注', parsedNormal.bills.find((item) => item.amount === 39.9).note, '饼干')
check('正常 noDetail=false', parsedNormal.noDetail, false)

/* ---------- 中等 7：备注里含「明细」 ---------- */

const noteDetail = parseMiniProgramBillText('── 明细 ──\n2026-08-06 10:00 📦其他 88.00元 公司报销明细')
check('备注含「明细」仍解析', noteDetail.bills.length, 1)
check('备注保留完整', noteDetail.bills[0].note, '公司报销明细')

/* ---------- 中等 8：分类判定只在前半段找 ---------- */

const catInNote = parseMiniProgramBillText('── 明细 ──\n2026-09-04 14:00 🧻日用 6.00元 备注里写了 餐饮 骗解析')
check('备注里的分类名不改判', catInNote.bills[0].category, 'daily')
const catInNote2 = parseMiniProgramBillText('── 明细 ──\n🍜餐饮 6.00元 奶茶饮品两杯')
check('备注里的饮品名不改判', catInNote2.bills[0].category, 'food')

/* ---------- 中等 9：三位小数不静默错 1000 倍 ---------- */

const longDecimal = parseMiniProgramBillText('── 明细 ──\n2026-09-01 10:00 🍜餐饮 12.3456元 测试')
check('三位小数不产生错误金额', longDecimal.bills.length, 0)
check('三位小数记入 invalid', longDecimal.invalid.length, 1)

/* ---------- 中等 10：半角括号的已退款 ---------- */

const halfWidth = parseMiniProgramBillText('── 明细 ──\n2026-09-01 10:00 🍜餐饮 12.00元 (已退款) 退货')
check('半角 (已退款) 也识别', halfWidth.bills[0].refunded, true)

/* ---------- 小程序真实格式（含 creator、全角已退款、总支出行） ---------- */

const miniProgram = `【呆笛小铺】2026-09 账单
总支出：27.37 元（呆呆 15 / 笛笛 12.37）

── 分类占比 ──
🍜餐饮：15 元（54.8%）

── 明细 ──
2026-09-01 12:30 呆呆 🍜餐饮 15元 午饭
2026-09-02 18:00 笛笛 🧋奶茶饮品 12.37元（已退款） 奶茶`
const parsedMini = parseMiniProgramBillText(miniProgram)
check('小程序格式 2 条', parsedMini.bills.length, 2)
check('小程序总支出行未被当账单', parsedMini.bills.some((item) => item.amount === 27.37), false)
check('小程序全角已退款', parsedMini.bills.find((item) => item.category === 'drink').refunded, true)
check('小程序 creator 不进备注', parsedMini.bills.find((item) => item.category === 'food').note, '午饭')

/* ---------- 中等 12：导出日期取账单 date，不取 timestamp ---------- */

const exportList = [
  {
    id: 1,
    amount: 39.9,
    category: 'food',
    categoryName: '餐饮',
    categoryEmoji: '🍜',
    note: '饼干',
    date: '2026-09-01',
    month: '2026-09',
    timestamp: new Date(2026, 8, 26, 12, 57).getTime(),
    refunded: false
  }
]
const exportText = buildExportText('2026-09', exportList, [], {
  time: true,
  timeMode: 'full',
  category: false,
  amount: true,
  note: true,
  summary: false,
  categoryStats: false,
  emoji: false
})
check('导出行用账单 date', exportText.includes('2026-09-01 12:57'), true)
check('导出行不含录入时刻的日期', exportText.includes('2026-09-26'), false)

/* ---------- 按分钟认账：同一笔改了内容要覆盖，不是新增 ---------- */

// importBills 走 H5 分支（plus 未定义、platform 非 android/ios），能在 Node 里直接跑
const store = {}
globalThis.uni = {
  getStorageSync: (key) => store[key],
  setStorageSync: (key, value) => {
    store[key] = value
  },
  getSystemInfoSync: () => ({ platform: 'web' })
}
const H5_KEY = 'jianji_bills_v1'
const makeBill = (overrides) => ({
  amount: 15,
  category: 'food',
  note: '午饭',
  date: '2026-09-01',
  month: '2026-09',
  timestamp: new Date(2026, 8, 1, 12, 30).getTime(),
  refunded: false,
  ...overrides
})

store[H5_KEY] = []
const firstImport = await importBills([makeBill({})])
check('首次导入 → 新增 1 条', [firstImport.added, firstImport.updated, firstImport.skipped], [1, 0, 0])

// 同一分钟、只改分类：应覆盖成新分类，而不是多出一条
const recategorized = await importBills([makeBill({ category: 'date' })])
check('改分类重导 → 覆盖 1 条', [recategorized.added, recategorized.updated, recategorized.skipped], [0, 1, 0])
check('改分类重导 → 仍是 1 条', store[H5_KEY].length, 1)
check('改分类重导 → 分类生效', store[H5_KEY][0].category, 'date')
check('改分类重导 → 备注保留', store[H5_KEY][0].note, '午饭')

// 内容一字不差再导一次：跳过
const identical = await importBills([makeBill({ category: 'date' })])
check('原样重导 → 跳过', [identical.added, identical.updated, identical.skipped], [0, 0, 1])

// 源文本同一分钟本来就有两笔（金额不同）：不能并成一条，各导各的
store[H5_KEY] = []
const sameMinute = new Date(2026, 8, 2, 9, 0).getTime()
const twoInMinute = await importBills([
  makeBill({ amount: 10, category: 'food', note: '', date: '2026-09-02', timestamp: sameMinute }),
  makeBill({ amount: 20, category: 'drink', note: '', date: '2026-09-02', timestamp: sameMinute })
])
check('源同分钟两笔 → 新增 2 条', [twoInMinute.added, twoInMinute.updated, store[H5_KEY].length], [2, 0, 2])

// 库里同一分钟已有多条（历史遗留）：不硬并，退回按字段判重后新增
store[H5_KEY] = [
  makeBill({ id: 1, amount: 10, note: '', timestamp: new Date(2026, 8, 3, 9, 0, 10).getTime() }),
  makeBill({ id: 2, amount: 20, category: 'drink', note: '', timestamp: new Date(2026, 8, 3, 9, 0, 50).getTime() })
]
const ambiguous = await importBills([
  makeBill({ amount: 30, category: 'play', note: '', date: '2026-09-03', timestamp: new Date(2026, 8, 3, 9, 0, 30).getTime() })
])
check('库里同分钟多条 → 不硬并', [ambiguous.added, ambiguous.updated, store[H5_KEY].length], [1, 0, 3])

// 导出往返会丢秒/毫秒：内容一字未改的重导必须是「跳过」，不能算成「更新」。
// 旧写法把「按分钟覆盖」放在「近似判重」之前，会把这笔当成改过内容而覆盖（updated=1）
store[H5_KEY] = []
await importBills([makeBill({ timestamp: new Date(2026, 8, 1, 12, 30, 45).getTime() })])
const roundTrip = await importBills([
  // 同一分钟、可见内容一字不差，只有秒被抹掉（模拟导出再导入）
  makeBill({ timestamp: new Date(2026, 8, 1, 12, 30, 0).getTime() })
])
check('往返未改动 → 跳过不算更新', [roundTrip.added, roundTrip.updated, roundTrip.skipped], [0, 0, 1])
check('往返未改动 → 仍是 1 条', store[H5_KEY].length, 1)

/* ---------- 结果 ---------- */

if (failures.length) {
  console.error(`✗ ${failures.length} 项不通过（共 ${passed + failures.length} 项）\n`)
  failures.forEach((text) => console.error(`  ✗ ${text}\n`))
  process.exit(1)
}

console.log(`✓ 全部 ${passed} 项通过`)
