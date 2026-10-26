// 展示账本（镜像账本）的计算与存储层。
//
// 设计要点：展示账本的「行」不存储，每次进页面从真实账本实时派生，
// 所以「真实账本一改，展示账本立刻同步」是天然成立的。这里只存用户加的那层调整：
// 类别比例、想攒的钱、单笔 raw、虚拟账单。
//
// 本模块刻意保持零依赖（round2 就地重写了一份）。scripts/check-display-ledger.mjs
// 要在 Node 里直接跑这些函数做回归，而项目 package.json 没有 "type": "module"——
// 一旦这里 import 了 './ledger.js'，Node 会按 CJS 解析那个文件、直接抛语法错。
// 代价是 round2 有两个实现，改动时记得一起改。

const STORAGE_KEY = 'jianji_display_ledger'

export const RATIO_MIN = 0
export const RATIO_MAX = 3
export const RATIO_STEP = 0.1

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function isExpenseBill(item) {
  return Boolean(item) && item.type !== 'income'
}

// 行上「手动敲定的展示金额」。有它就直接用，绕开保留尾数——否则用户输 20、
// 保留尾数会把它算成 20.99（整数部分取输入、小数部分沿用真实金额），看起来很坏。
// 滑块拖一下就清掉它（拖拽重新走比例 / 尾数那套）
function normalizeExact(value) {
  if (value === null || value === undefined || value === '') return null
  const number = round2(value)
  return number >= 0 ? number : null
}

export function clampRatio(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.round(Math.min(Math.max(number, RATIO_MIN), RATIO_MAX) * 100) / 100
}

export function decimalPlaces(amount) {
  const text = Math.abs(Number(amount) || 0).toFixed(2)
  if (text.endsWith('00')) return 0
  if (text.endsWith('0')) return 1
  return 2
}

function roundTo(value, digits) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

// 保留尾数：整数部分取计算结果的，小数部分沿用真实金额的。
//   12.99 × 1.2 = 15.588 → 15.99    15.5 × 1.2 = 18.6 → 18.5    15 × 1.1 = 16.5 → 16
// 关掉时退化成「四舍五入到真实金额原有的小数位数」：15 × 1.1 → 17。
// raw 是滑块位置或「真实金额 × 比例」，display 由它推出来——这样拨动「保留尾数」开关时，
// 已经拖过滑块的那些行也会跟着重算，不需要额外迁移。
export function finalizeAmount(raw, realAmount, keepTail) {
  const rawValue = Number(raw) || 0
  // 0（比例设成 0，或滑块拖到底）就直接是 0，不套尾数规则，否则会得出 0.99 这种鬼数
  if (!(rawValue > 0)) return 0
  const real = round2(realAmount)
  const digits = decimalPlaces(real)
  if (!keepTail) return roundTo(rawValue, digits)
  const scale = 10 ** digits
  const fraction = Math.round(real * scale) % scale
  // +1e-9 抵消浮点表示误差：26 × 0.5 这类本该落在整数上的结果可能算出 12.999999999999998
  return round2(Math.floor(rawValue + 1e-9) + fraction / scale)
}

export function applyRatio(realAmount, ratio, keepTail) {
  return finalizeAmount(round2(realAmount) * clampRatio(ratio), realAmount, keepTail)
}

export function ratioOf(monthState, category) {
  const stored = monthState && monthState.ratios ? monthState.ratios[category] : undefined
  return stored === undefined ? 1 : clampRatio(stored)
}

export function emptyMonthState() {
  return { ratios: {}, target: 0, overrides: {}, virtual: [] }
}

export function monthOrEmpty(state, month) {
  const found = state && state.months ? state.months[month] : null
  return found || emptyMonthState()
}

// 缺月时建一个空条目再返回。只在 loadData 这种显式时机调用，不在 computed 里——
// 在 computed 求值过程中写 state 会让它自己失效、多跑一轮，还容易踩到意外循环。
export function ensureMonthState(state, month) {
  if (!state.months) state.months = {}
  if (!state.months[month]) {
    state.months[month] = emptyMonthState()
    return true
  }
  return false
}

function normalizeVirtual(item, fallbackId) {
  if (!item || typeof item !== 'object') return null
  const amount = round2(item.amount)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? String(item.date) : ''
  if (!(amount > 0) || !date) return null
  return {
    vid: Number(item.vid) || fallbackId,
    amount,
    category: String(item.category || 'other'),
    note: String(item.note || '').slice(0, 30),
    date,
    timestamp: Number(item.timestamp) || 0,
    // raw 为 null = 跟随类别比例；有数字 = 已被单笔调整过
    raw: item.raw === null || item.raw === undefined ? null : round2(item.raw),
    exact: normalizeExact(item.exact)
  }
}

function normalizeMonthState(value) {
  const source = value && typeof value === 'object' ? value : {}

  const ratios = {}
  const rawRatios = source.ratios && typeof source.ratios === 'object' ? source.ratios : {}
  Object.keys(rawRatios).forEach((key) => {
    const ratio = clampRatio(rawRatios[key])
    // 1 就是「没设过」，不占存储，读取时缺省即 1
    if (ratio !== 1) ratios[key] = ratio
  })

  const overrides = {}
  const rawOverrides = source.overrides && typeof source.overrides === 'object' ? source.overrides : {}
  Object.keys(rawOverrides).forEach((id) => {
    const item = rawOverrides[id]
    if (!item || typeof item !== 'object') return
    const base = round2(item.base)
    if (!(base > 0) || !Number.isFinite(Number(item.raw))) return
    overrides[id] = { raw: round2(item.raw), exact: normalizeExact(item.exact), base, cat: String(item.cat || 'other') }
  })

  const virtual = (Array.isArray(source.virtual) ? source.virtual : [])
    .map((item, index) => normalizeVirtual(item, index + 1))
    .filter(Boolean)

  const target = round2(source.target)
  return { ratios, target: target > 0 ? target : 0, overrides, virtual }
}

export function loadDisplayState() {
  const raw = uni.getStorageSync(STORAGE_KEY)
  const source = raw && typeof raw === 'object' ? raw : {}
  const months = {}
  const rawMonths = source.months && typeof source.months === 'object' ? source.months : {}
  Object.keys(rawMonths).forEach((month) => {
    months[month] = normalizeMonthState(rawMonths[month])
  })
  return {
    // 默认开：需求里「12.99 → 15.99」这种样子就是开着保留尾数的效果
    keepTail: source.keepTail === undefined ? true : Boolean(source.keepTail),
    months
  }
}

export function saveDisplayState(state) {
  uni.setStorageSync(STORAGE_KEY, {
    keepTail: Boolean(state.keepTail),
    months: state.months || {}
  })
}

// 丢掉已经不成立的单笔调整：账单被删、被标私人、改成收入，或金额/类别改了
// （需求：改金额或类别要丢弃旧调整）。返回是否有改动，避免每次都写存储。
export function pruneDisplayState(state, bills) {
  const byId = new Map((bills || []).map((item) => [String(item.id), item]))
  let changed = false
  Object.keys(state.months || {}).forEach((month) => {
    const overrides = state.months[month].overrides || {}
    Object.keys(overrides).forEach((id) => {
      const bill = byId.get(id)
      const item = overrides[id]
      const alive =
        bill &&
        !bill.is_private &&
        isExpenseBill(bill) &&
        // 账单被改到别的月份后，这一条属于本月的调整就不再成立（否则挪回来会「复活」旧调整）
        bill.month === month &&
        round2(bill.amount) === item.base &&
        bill.category === item.cat
      if (!alive) {
        delete overrides[id]
        changed = true
      }
    })
  })
  return changed
}

export function getPrivateExpenseTotal(bills, month) {
  return round2(
    (bills || [])
      .filter(
        (item) =>
          item.month === month && item.is_private && isExpenseBill(item) && !item.refunded
      )
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
  )
}

// 展示账本的一条目。real 是真实金额（只读，显示在箭头左边），display 是给父母看的数字。
export function buildDisplayLedger({ bills, month, monthState, keepTail }) {
  const state = monthState || emptyMonthState()
  const source = (bills || []).filter(
    (item) =>
      item.month === month &&
      !item.is_private &&
      isExpenseBill(item) &&
      // 0 元账单（旧版导入能带进来）会拖出 min==max==0 的滑块、还不进饼图统计，展示账本里直接不收
      (item.refunded || round2(item.amount) > 0)
  )

  const rows = []
  let realTotal = 0
  let displayTotal = 0

  source.forEach((item) => {
    const real = round2(item.amount)
    const override = state.overrides ? state.overrides[String(item.id)] : null
    // 失效判定靠写入时记下的 base / cat：真实账本改了金额或类别，这条调整就不算数了
    const manual = Boolean(override && override.base === real && override.cat === item.category)
    const raw = manual ? override.raw : real * ratioOf(state, item.category)
    // 手动敲定的数字直接生效，不再过保留尾数那一套
    const exact = manual ? normalizeExact(override.exact) : null
    // 已退款照真实账本口径走：展示金额记 0.00、行上带「已退款」，不给滑块、不进任何合计。
    // 不放大已退款账目既是真实账本的口径，也避免导出里冒出一笔已经退回来的钱
    const display = item.refunded ? 0 : (exact === null ? finalizeAmount(raw, real, keepTail) : exact)

    realTotal = round2(realTotal + (item.refunded ? 0 : real))
    displayTotal = round2(displayTotal + display)

    rows.push({
      key: `r${item.id}`,
      source: 'real',
      id: item.id,
      amount: real,
      raw,
      exact,
      display,
      category: item.category,
      note: item.note,
      date: item.date,
      month: item.month,
      timestamp: item.timestamp,
      refunded: Boolean(item.refunded),
      manual,
      sliderMax: round2(real * RATIO_MAX),
      // 「点数字直接敲」的上限走展示口径（含保留尾数），不是 raw 口径：
      // 保留尾数时滑块顶端的显示值（如 38.99）会比 raw 上限（38.97）大，否则自己填不进去
      displayMax: finalizeAmount(round2(real * RATIO_MAX), real, keepTail)
    })
  })

  ;(state.virtual || []).forEach((item) => {
    const manual = item.raw !== null && item.raw !== undefined
    const raw = manual ? item.raw : item.amount * ratioOf(state, item.category)
    const exact = normalizeExact(item.exact)
    const display = exact === null ? finalizeAmount(raw, item.amount, keepTail) : exact
    displayTotal = round2(displayTotal + display)

    rows.push({
      key: `v${item.vid}`,
      source: 'virtual',
      vid: item.vid,
      amount: round2(item.amount),
      raw,
      exact,
      display,
      category: item.category,
      note: item.note,
      date: item.date,
      month,
      timestamp: item.timestamp,
      refunded: false,
      manual,
      sliderMax: round2(round2(item.amount) * RATIO_MAX),
      displayMax: finalizeAmount(round2(round2(item.amount) * RATIO_MAX), item.amount, keepTail)
    })
  })

  rows.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))

  const privateTotal = getPrivateExpenseTotal(bills, month)
  const target = round2(privateTotal + (Number(state.target) || 0))
  // 已夸大 = 展示账本合计 − 真实账本里这些账目的真实合计。虚拟账单没有真实对照，
  // 全额算进「已夸大」，这正是「私人账目盖不住时用虚拟支出补足」的口子。
  const inflated = round2(displayTotal - realTotal)
  const remaining = round2(target - inflated)

  return {
    rows,
    displayTotal,
    realTotal,
    privateTotal,
    target,
    inflated,
    remaining,
    progress: target > 0 ? Math.min(1, Math.max(0, inflated / target)) : 0
  }
}

// 写操作用这个：monthOrEmpty 缺月时会返回一个用完就丢的新对象，写进去等于没写
function mutableMonth(state, month) {
  if (!state.months) state.months = {}
  if (!state.months[month]) state.months[month] = emptyMonthState()
  return state.months[month]
}

export function setMonthTarget(state, month, value) {
  const monthState = mutableMonth(state, month)
  const target = round2(value)
  monthState.target = target > 0 ? target : 0
  return monthState.target
}

export function setRowRaw(state, month, row, raw) {
  const monthState = mutableMonth(state, month)
  const next = round2(raw)
  if (row.source === 'virtual') {
    const found = (monthState.virtual || []).find((item) => item.vid === row.vid)
    if (found) {
      found.raw = next
      // 拖了滑块就不再是「敲定的数字」，回到比例 + 尾数那套
      found.exact = null
    }
    return
  }
  if (!monthState.overrides) monthState.overrides = {}
  // base / cat 记下写入时的真实值，真实账本一改这两样，这条调整就自动失效
  monthState.overrides[String(row.id)] = {
    raw: next,
    exact: null,
    base: round2(row.amount),
    cat: row.category
  }
}

// 直接敲一个展示金额：raw 也记成同一个数，滑块位置大致对得上（精确位置由 exact 决定，不影响展示值）
export function setRowExact(state, month, row, value) {
  const monthState = mutableMonth(state, month)
  const next = normalizeExact(value)
  if (next === null) return null
  if (row.source === 'virtual') {
    const found = (monthState.virtual || []).find((item) => item.vid === row.vid)
    if (found) {
      found.raw = next
      found.exact = next
    }
    return next
  }
  if (!monthState.overrides) monthState.overrides = {}
  monthState.overrides[String(row.id)] = {
    raw: next,
    exact: next,
    base: round2(row.amount),
    cat: row.category
  }
  return next
}

export function clearRowRaw(state, month, row) {
  setRowRaw(state, month, row, row.amount)
}

export function addVirtualBill(state, month, payload) {
  const monthState = mutableMonth(state, month)
  const list = monthState.virtual || (monthState.virtual = [])
  const vid = list.reduce((max, item) => Math.max(max, Number(item.vid) || 0), 0) + 1
  list.push({
    vid,
    amount: round2(payload.amount),
    category: payload.category,
    note: String(payload.note || '').slice(0, 30),
    date: payload.date,
    timestamp: Number(payload.timestamp) || Date.now(),
    raw: null,
    exact: null
  })
  return vid
}

export function removeVirtualBill(state, month, vid) {
  const monthState = mutableMonth(state, month)
  monthState.virtual = (monthState.virtual || []).filter((item) => item.vid !== vid)
}

// 需求：某个类别的比例设成 1 就是「全局重置」——该类别所有记录回真实金额、
// 清掉手动调整标记。真实账单的手动标记就是 override 本身，虚拟账单是 raw。
export function setCategoryRatio(state, month, category, ratio) {
  const monthState = mutableMonth(state, month)
  const next = clampRatio(ratio)

  if (Math.abs(next - 1) < 1e-9) {
    delete monthState.ratios[category]
    Object.keys(monthState.overrides || {}).forEach((id) => {
      if (monthState.overrides[id].cat === category) delete monthState.overrides[id]
    })
    ;(monthState.virtual || []).forEach((item) => {
      if (item.category === category) {
        item.raw = null
        item.exact = null
      }
    })
    return { ratio: 1, reset: true }
  }

  monthState.ratios[category] = next
  return { ratio: next, reset: false }
}

// 转成 buildExportText 认得的账单形状：金额换成展示金额，只留未退款、且金额大于 0 的
// （比例设成 0 的账目在导出的账单里会变成一行「0.00元」，看着假）。
// 行本身直接展开：建行时挂上去的 categoryName / categoryEmoji / categoryColor 要跟着走，
// buildExportText 靠这几个字段拼分类。
export function toExportBills(rows) {
  return (rows || [])
    .filter((row) => !row.refunded && row.display > 0)
    .map((row) => ({
      ...row,
      amount: row.display,
      category: row.category,
      note: row.note,
      date: row.date,
      month: row.month,
      timestamp: row.timestamp,
      refunded: false,
      is_private: false,
      type: 'expense'
    }))
}
