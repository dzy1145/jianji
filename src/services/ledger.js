const DB_NAME = 'jianji_ledger'
const DB_PATH = '_doc/jianji_ledger.db'
const H5_STORAGE_KEY = 'jianji_bills_v1'

export const CATEGORIES = [
  { key: 'food', emoji: '🍜', name: '餐饮', color: '#FF7A9E' },
  { key: 'drink', emoji: '🧋', name: '奶茶饮品', color: '#FFB35C' },
  { key: 'transport', emoji: '🚇', name: '出行交通', color: '#4D96FF' },
  { key: 'shopping', emoji: '🛍️', name: '购物', color: '#9B72F7' },
  { key: 'study', emoji: '📚', name: '学习', color: '#6BCB77' },
  { key: 'date', emoji: '💕', name: '约会', color: '#F78FB3' },
  { key: 'play', emoji: '🎮', name: '娱乐', color: '#4ECDC4' },
  { key: 'daily', emoji: '🧻', name: '日用', color: '#FFD93D' },
  { key: 'medical', emoji: '🏥', name: '医疗', color: '#FF6B6B' },
  { key: 'other', emoji: '📦', name: '其他', color: '#A8B8D8' }
]

// 收入不是分类，只并进 CATEGORY_MAP 供 normalizeBill 解析出图标和颜色，
// 不进 CATEGORIES —— 分类格仍然是 10 格，不能多出一格。
// 换 emoji 不影响判重：createFingerprint 记的是类别 key（'income'），不是图标
export const INCOME_CATEGORY = { key: 'income', emoji: '💵', name: '收入', color: '#2AA36B' }

export const CATEGORY_MAP = CATEGORIES.concat([INCOME_CATEGORY]).reduce((map, category) => {
  map[category.key] = category
  return map
}, {})

export const DEFAULT_EXPORT_CONFIG = {
  scope: 'month',
  scopeMonth: '',
  scopeDate: '',
  time: true,
  timeMode: 'full',
  category: true,
  emoji: true,
  amount: true,
  note: true,
  sep: 'space',
  summary: true,
  categoryStats: true
}

const EXPORT_SEPARATORS = {
  space: ' ',
  comma: ', ',
  pipe: ' | '
}

let databaseReady

function isAppPlatform() {
  if (typeof uni === 'undefined') return false
  const platform = uni.getSystemInfoSync().platform
  return platform === 'android' || platform === 'ios'
}

function isAppRuntime() {
  return typeof plus !== 'undefined' && plus.sqlite
}

function waitForAppRuntime(attempt = 0) {
  if (isAppRuntime()) return Promise.resolve()
  if (attempt >= 30) return Promise.reject(new Error('App runtime did not become ready'))
  return new Promise((resolve) => setTimeout(resolve, 100)).then(() => waitForAppRuntime(attempt + 1))
}

function requireUni() {
  if (typeof uni === 'undefined') {
    throw new Error('uni runtime is unavailable')
  }
  return uni
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function toSql(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

function openSqlite() {
  if (typeof plus === 'undefined' || !plus.sqlite) {
    return Promise.reject(new Error('SQLite is only available in the App runtime'))
  }

  return new Promise((resolve, reject) => {
    const isOpen = plus.sqlite.isOpenDatabase({
      name: DB_NAME,
      path: DB_PATH
    })

    if (isOpen) {
      resolve()
      return
    }

    plus.sqlite.openDatabase({
      name: DB_NAME,
      path: DB_PATH,
      success: resolve,
      fail: reject
    })
  })
}

function executeSql(sql) {
  return new Promise((resolve, reject) => {
    plus.sqlite.executeSql({
      name: DB_NAME,
      sql,
      success: resolve,
      fail: reject
    })
  })
}

function selectSql(sql) {
  return new Promise((resolve, reject) => {
    plus.sqlite.selectSql({
      name: DB_NAME,
      sql,
      success: resolve,
      fail: reject
    })
  })
}

function readH5Bills() {
  const value = requireUni().getStorageSync(H5_STORAGE_KEY)
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const bill = normalizeBill(item)
    if (!bill.fingerprint) bill.fingerprint = createFingerprint(bill)
    return bill
  })
}

function writeH5Bills(list) {
  requireUni().setStorageSync(H5_STORAGE_KEY, list)
}

function normalizeBill(item) {
  const category = CATEGORY_MAP[item.category] || CATEGORY_MAP.other
  return {
    id: Number(item.id),
    amount: round2(item.amount),
    category: category.key,
    categoryName: category.name,
    categoryEmoji: category.emoji,
    categoryColor: category.color,
    note: item.note || '',
    date: item.date || '',
    month: item.month || String(item.date || '').slice(0, 7),
    timestamp: Number(item.timestamp || 0),
    refunded: Boolean(Number(item.refunded)),
    type: item.type === 'income' ? 'income' : 'expense',
    is_private: Boolean(Number(item.is_private)),
    fingerprint: item.fingerprint || ''
  }
}

// 类型判别只看 type。收入的 date 是 `月份 + '-01'` 占位，而缺日期的支出本来也会落在
// '-01'（见 resolveImportDate），所以用 date 判别类型从第一天就是错的。
export function isIncome(item) {
  return Boolean(item) && item.type === 'income'
}

export function isExpense(item) {
  return !isIncome(item)
}

// 「可见」口径 = 显示 + 统计：关掉隐藏开关时私人账目照常显示、照常计入统计，
// 只是不导出（导出处固定传 hidePrivate = true）。
export function filterVisibleBills(list, hidePrivate) {
  const source = list || []
  return hidePrivate ? source.filter((item) => !item.is_private) : source
}

export function getIncomeTotal(list, month) {
  return round2(
    (list || [])
      .filter((item) => isIncome(item) && !item.refunded && (!month || item.month === month))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
  )
}

function createFingerprint(item) {
  return [
    item.date || '',
    item.timestamp || 0,
    item.category || 'other',
    round2(item.amount),
    item.refunded ? 1 : 0,
    String(item.note || '').trim()
  ].join('|')
}

function nextH5Id(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

export function initLedger() {
  if (databaseReady) return databaseReady

  databaseReady = (async () => {
    if (isAppPlatform() && !isAppRuntime()) {
      await waitForAppRuntime()
    }

    if (!isAppRuntime()) {
      if (!Array.isArray(requireUni().getStorageSync(H5_STORAGE_KEY))) {
        writeH5Bills([])
      }
      return
    }

    await openSqlite()
    await executeSql(`
      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        note TEXT DEFAULT '',
        date TEXT NOT NULL,
        month TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        refunded INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT 'expense',
        fingerprint TEXT
      )
    `)
    try {
      await executeSql('ALTER TABLE bills ADD COLUMN fingerprint TEXT')
    } catch (error) {
      // Existing databases already have the column.
    }
    // 每条 ALTER 各自 try：塞进同一个 try 的话，第一条因「列已存在」抛错时
    // 第二条根本不会执行，会留下半迁移状态且不报错。
    try {
      await executeSql('ALTER TABLE bills ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0')
    } catch (error) {
      // Existing databases already have the column.
    }
    try {
      await executeSql("ALTER TABLE bills ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'")
    } catch (error) {
      // Existing databases already have the column.
    }
    // 索引先建、再补指纹：补的时候由索引来挡重复，重复的行撞了就被下面的 catch 接住
    await executeSql('CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_fingerprint ON bills(fingerprint) WHERE fingerprint IS NOT NULL')
    const missing = await selectSql("SELECT * FROM bills WHERE fingerprint IS NULL OR fingerprint = ''")
    for (const item of missing) {
      const bill = normalizeBill(item)
      try {
        await executeSql(`UPDATE bills SET fingerprint = ${toSql(createFingerprint(bill))} WHERE id = ${Number(bill.id)}`)
      } catch (error) {
        // 老库里两行内容完全一样（旧版本没有判重，同一个文本导入两次会留下这种行），
        // 第二行会撞唯一索引。跳过、保持 NULL，宁可这一行暂时没有指纹，也要让 App 能开
      }
    }
  })().catch((error) => {
    // 不缓存失败的 promise：否则本次会话里 listBills/addBill 全直接抛，且永不重试
    databaseReady = undefined
    throw error
  })

  return databaseReady
}

export async function listBills(month) {
  await initLedger()

  if (!isAppRuntime()) {
    return readH5Bills()
      .filter((item) => !month || item.month === month)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  const where = month ? ` WHERE month = ${toSql(month)}` : ''
  const rows = await selectSql(`SELECT * FROM bills${where} ORDER BY timestamp DESC`)
  return rows.map(normalizeBill)
}

export async function addBill(payload) {
  await initLedger()
  const bill = normalizeBill({
    ...payload,
    id: 0,
    refunded: payload.refunded ? 1 : 0,
    fingerprint: payload.fingerprint || createFingerprint(payload)
  })

  if (!isAppRuntime()) {
    const list = readH5Bills()
    const id = nextH5Id(list)
    const next = [{ ...bill, id }, ...list]
    writeH5Bills(next)
    return id
  }

  await executeSql(`
    INSERT INTO bills (amount, category, note, date, month, timestamp, refunded, is_private, type, fingerprint)
    VALUES (
      ${toSql(bill.amount)},
      ${toSql(bill.category)},
      ${toSql(bill.note)},
      ${toSql(bill.date)},
      ${toSql(bill.month)},
      ${toSql(bill.timestamp)},
      ${bill.refunded ? 1 : 0},
      ${bill.is_private ? 1 : 0},
      ${toSql(bill.type)},
      ${toSql(bill.fingerprint)}
    )
  `)
  const rows = await selectSql('SELECT last_insert_rowid() AS id')
  return Number(rows[0]?.id || 0)
}

export async function updateBill(id, payload) {
  await initLedger()
  const bill = normalizeBill({
    ...payload,
    id,
    refunded: payload.refunded ? 1 : 0,
    fingerprint: payload.fingerprint || createFingerprint(payload)
  })

  if (!isAppRuntime()) {
    const list = readH5Bills()
    const index = list.findIndex((item) => item.id === Number(id))
    if (index >= 0) {
      list[index] = bill
      writeH5Bills(list)
    }
    return
  }

  await executeSql(`
    UPDATE bills SET
      amount = ${toSql(bill.amount)},
      category = ${toSql(bill.category)},
      note = ${toSql(bill.note)},
      date = ${toSql(bill.date)},
      month = ${toSql(bill.month)},
      timestamp = ${toSql(bill.timestamp)},
      refunded = ${bill.refunded ? 1 : 0},
      is_private = ${bill.is_private ? 1 : 0},
      type = ${toSql(bill.type)},
      fingerprint = ${toSql(bill.fingerprint)}
    WHERE id = ${Number(id)}
  `)
}

export async function deleteBill(id) {
  await initLedger()

  if (!isAppRuntime()) {
    writeH5Bills(readH5Bills().filter((item) => item.id !== Number(id)))
    return
  }

  await executeSql(`DELETE FROM bills WHERE id = ${Number(id)}`)
}

export async function deleteBills(ids) {
  await initLedger()
  const idList = (ids || []).map(Number).filter((id) => Number.isFinite(id))
  if (!idList.length) return 0

  if (!isAppRuntime()) {
    const selected = new Set(idList)
    const existing = readH5Bills()
    const next = existing.filter((item) => !selected.has(item.id))
    writeH5Bills(next)
    return existing.length - next.length
  }

  await executeSql(`DELETE FROM bills WHERE id IN (${idList.join(',')})`)
  return idList.length
}

export function getCategoryStats(list) {
  const counted = (list || []).filter((item) => !item.refunded && isExpense(item))
  const total = round2(counted.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const map = {}

  counted.forEach((item) => {
    const category = CATEGORY_MAP[item.category] || CATEGORY_MAP.other
    if (!map[category.key]) {
      map[category.key] = {
        ...category,
        amount: 0,
        percent: 0
      }
    }
    map[category.key].amount = round2(map[category.key].amount + Number(item.amount || 0))
  })

  return Object.values(map)
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percent: total > 0 ? Math.round((item.amount / total) * 1000) / 10 : 0
    }))
}

// 近似判重用的可见字段键（不含 timestamp）
function approximateKey(item) {
  const parts = [
    item.date || '',
    item.category || 'other',
    item.refunded ? 1 : 0,
    String(item.note || '').trim()
  ]
  if (!item.refunded) parts.push(round2(item.amount))
  return parts.join('|')
}

// 按「精确到分钟」认账用的分钟桶。timestamp 是本地毫秒，除以 60000 取整即分钟编号；
// 导出的时间文本本来就只有 HH:MM（秒/毫秒在文本里不存在），所以同一笔账单往返后分钟桶不变。
function minuteBucket(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value / 60000)
}

// 统计本批待导入里每个分钟桶出现几次：同一分钟出现 2 次以上说明源文本本来就有多笔，
// 不能用分钟桶去匹配覆盖（会把这多笔并成一条），这些桶退回按字段判重
function countMinuteBuckets(list) {
  const map = new Map()
  ;(list || []).forEach((item) => {
    const bucket = minuteBucket(item.timestamp)
    if (!bucket) return
    map.set(bucket, (map.get(bucket) || 0) + 1)
  })
  return map
}

// 已退款账目导出时金额会被写成 0.00，往返后金额对不上，所以这一项不比
function approximateDupSql(bill) {
  const conditions = [
    `date = ${toSql(bill.date)}`,
    `category = ${toSql(bill.category)}`,
    `refunded = ${bill.refunded ? 1 : 0}`,
    `note = ${toSql(bill.note)}`
  ]
  if (!bill.refunded) conditions.push(`amount = ${toSql(bill.amount)}`)
  return `SELECT id FROM bills WHERE ${conditions.join(' AND ')} LIMIT 1`
}

export async function importBills(list) {
  await initLedger()
  const pending = (list || [])
    .map((item) => {
      const normalized = normalizeBill(item)
      normalized.fingerprint = normalized.fingerprint || createFingerprint(normalized)
      return normalized
    })
    // 0 元账单不进库（会拖出 min==max==0 的滑块、也不进统计却被「共 N 笔」计数）；
    // 已退款账目导出后金额就是 0，要放行
    .filter((item) => (item.amount > 0 || item.refunded) && item.date && item.category)

  // 本批每个分钟桶出现几次：同一分钟出现 2 次以上说明源文本本来就有多笔，
  // 不能用分钟桶去匹配覆盖（会把这多笔并成一条），这些桶退回按字段判重
  const minuteCounts = countMinuteBuckets(pending)

  let added = 0
  let skipped = 0
  let updated = 0

  if (!isAppRuntime()) {
    const existing = readH5Bills()
    const fingerprints = new Set(existing.map((item) => item.fingerprint).filter(Boolean))
    const approximate = new Set(existing.map(approximateKey))
    // 分钟桶 → 已有账单在 next 里的下标，用于「同一笔账单改了内容 → 覆盖」
    const minuteIndex = new Map()
    existing.forEach((item, index) => {
      const bucket = minuteBucket(item.timestamp)
      if (!bucket) return
      if (!minuteIndex.has(bucket)) minuteIndex.set(bucket, [])
      minuteIndex.get(bucket).push(index)
    })
    const next = existing.slice()
    let nextId = nextH5Id(existing)
    const imported = []

    pending.forEach((item) => {
      // 1. 指纹完全一致：已有同一笔，跳过
      if (fingerprints.has(item.fingerprint)) {
        skipped += 1
        return
      }
      const key = approximateKey(item)
      // 2. 近似判重：可见字段（分类/金额/备注/退款/日期）一致 → 是同一笔没改动，跳过。
      //    这一步必须在按分钟覆盖之前：导出往返只丢秒/毫秒，指纹对不上，但内容一致，
      //    那是重复而不是「改了内容」，不能算成更新
      if (approximate.has(key)) {
        skipped += 1
        return
      }
      // 3. 按分钟认账：本批这一分钟只有一条、库里这一分钟也恰好只有一条，且可见内容
      //    确实变了（没被上一步拦下）→ 视为同一笔改了内容，覆盖
      const bucket = minuteBucket(item.timestamp)
      if (bucket && minuteCounts.get(bucket) === 1) {
        const hits = minuteIndex.get(bucket) || []
        if (hits.length === 1) {
          const index = hits[0]
          const before = next[index]
          const merged = normalizeBill({
            ...before,
            amount: item.amount,
            category: item.category,
            note: item.note,
            refunded: item.refunded ? 1 : 0,
            fingerprint: item.fingerprint
          })
          next[index] = merged
          fingerprints.delete(before.fingerprint)
          fingerprints.add(merged.fingerprint)
          approximate.delete(approximateKey(before))
          approximate.add(key)
          updated += 1
          return
        }
      }
      fingerprints.add(item.fingerprint)
      approximate.add(key)
      imported.push({ ...item, id: nextId++ })
      added += 1
    })

    writeH5Bills(imported.concat(next))
    return { added, skipped, updated }
  }

  for (const bill of pending) {
    const rows = await selectSql(`SELECT id FROM bills WHERE fingerprint = ${toSql(bill.fingerprint)} LIMIT 1`)
    if (rows.length) {
      skipped += 1
      continue
    }
    // 近似判重：可见字段（分类/金额/备注/退款/日期）一致 → 同一笔没改动，跳过。
    // 必须在按分钟覆盖之前——指纹里含 timestamp，往返一次（导出再导入）秒/毫秒会丢，
    // 指纹对不上，但内容一致，那是重复而不是「改了内容」，不能算成更新，更不能覆盖
    const dups = await selectSql(approximateDupSql(bill))
    if (dups.length) {
      skipped += 1
      continue
    }
    // 按分钟认账：本批这一分钟只有一条、库里这一分钟也恰好只有一条 → 这笔可见内容
    // 确实变了（没被上一步拦下），覆盖那一行。覆盖只改来源文本里带的字段
    // （金额/分类/备注/退款/指纹），保留本机的 id、时间、私人标记与收支类型，
    // 免得把用户在简记里做的本地修改冲掉
    const bucket = minuteBucket(bill.timestamp)
    if (bucket && minuteCounts.get(bucket) === 1) {
      const start = bucket * 60000
      const hits = await selectSql(
        `SELECT id FROM bills WHERE timestamp >= ${start} AND timestamp < ${start + 60000}`
      )
      if (hits.length === 1) {
        try {
          await executeSql(`
            UPDATE bills SET
              amount = ${toSql(bill.amount)},
              category = ${toSql(bill.category)},
              note = ${toSql(bill.note)},
              refunded = ${bill.refunded ? 1 : 0},
              fingerprint = ${toSql(bill.fingerprint)}
            WHERE id = ${Number(hits[0].id)}
          `)
          updated += 1
        } catch (error) {
          // 新指纹撞了别的行（唯一索引）：宁可跳过，也不动已有数据
          skipped += 1
        }
        continue
      }
    }
    await executeSql(`
      INSERT OR IGNORE INTO bills (amount, category, note, date, month, timestamp, refunded, fingerprint)
      VALUES (
        ${toSql(bill.amount)},
        ${toSql(bill.category)},
        ${toSql(bill.note)},
        ${toSql(bill.date)},
        ${toSql(bill.month)},
        ${toSql(bill.timestamp)},
        ${bill.refunded ? 1 : 0},
        ${toSql(bill.fingerprint)}
      )
    `)
    added += 1
  }

  return { added, skipped, updated }
}

function resolveImportDate(headerDate, headerMonth, fullDate, timeText, line) {
  if (fullDate) return { date: fullDate, time: timeText || '12:00' }
  if (/^\d{4}-\d{2}-\d{2}$/.test(headerDate)) return { date: headerDate, time: timeText || '12:00' }

  const today = new Date()
  const todayText = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-')
  const fallbackDate = headerMonth === todayText.slice(0, 7) ? todayText : `${headerMonth || todayText.slice(0, 7)}-01`
  return { date: fallbackDate, time: timeText || '12:00' }
}

function parseLocalTimestamp(dateText, timeText) {
  const [year, month, day] = String(dateText).split('-').map(Number)
  const [hour, minute] = String(timeText || '12:00').split(':').map(Number)
  const timestamp = new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function stripImportSeparators(value) {
  return String(value || '')
    .replace(/^[\s,，|·:：-]+/, '')
    .replace(/[\s,，|·:：-]+$/, '')
    .trim()
}

// 段标记行的形状：横线/空格 包着段名，例如「── 明细 ──」。必须整行匹配，
// 不能只判断「行里有没有这两个字」——备注写「公司报销明细」的账单会被旧写法整行丢掉
function isSectionMarker(line, name) {
  return new RegExp(`^[\\s─—–\\-|·]*${name}[\\s─—–\\-|·]*$`).test(line)
}

export function parseMiniProgramBillText(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n')
  const headerMatch = source.match(/【[^】]+】\s*(\d{4}-\d{2}(?:-\d{2})?)\s*账单(?:（([^）]+)）)?/)
  const headerRange = headerMatch ? headerMatch[1] : ''
  const headerDate = /^\d{4}-\d{2}-\d{2}$/.test(headerRange) ? headerRange : ''
  const now = new Date()
  // 本地月份。不能用 toISOString().slice(0,7)——那是 UTC，东八区每月 1 号 00:00–08:00 会算成上个月
  const localMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const headerMonth = headerRange.slice(0, 7) || localMonth
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean)
  const detailIndex = lines.findIndex((line) => isSectionMarker(line, '明细'))

  // 没有「── 明细 ──」标记就不解析任何一行。旧写法「找不到标记就退化成全部行」，
  // 会把「明细字段全关、只导出汇总 + 分类占比」的文本里，汇总行和每个分类小计
  // 都当成账单塞进账本，当月统计直接翻倍
  if (detailIndex < 0) {
    return { month: headerMonth, bills: [], invalid: [], noDetail: true }
  }

  const candidates = lines.slice(detailIndex + 1).filter((line) => {
    if (!line || line.startsWith('【')) return false
    // 汇总行：小程序导出「总支出：…」，简记自己导出「我的总支出：…」
    if (/^\s*(?:【[^】]*】\s*)?(?:我的)?总支出\s*[：:]/.test(line)) return false
    // 分类小计行「🍜餐饮：12.37 元（24.2%）」：金额前是冒号；明细行金额前只可能是分隔符
    if (/[：:]\s*[\d.]+\s*元\s*[（(][\d.]+%[)）]\s*$/.test(line)) return false
    if (isSectionMarker(line, '分类占比') || isSectionMarker(line, '明细')) return false
    return true
  })

  const parsed = []
  const invalid = []
  const inTextFingerprints = new Set()

  candidates.forEach((line) => {
    // 左边界 (?<![\d.])：否则 12.3456元 会从「3456」处匹配出 3456 元（静默错 1000 倍）
    const amountMatch = line.match(/(?<![\d.])(\d+(?:\.\d{1,2})?)\s*元(?:\s*[（(]已退款[)）])?/)
    if (!amountMatch) {
      // 有「元」却拼不出合法金额（三位以上小数等），记进 invalid 让界面提示，别静默跳过
      if (/\d+\s*元/.test(line)) invalid.push(line)
      return
    }

    const amountText = amountMatch[0]
    const refunded = /[（(]已退款[)）]/.test(amountText)
    const amount = round2(amountMatch[1])
    const fullDateMatch = line.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/)
    const fullDateText = fullDateMatch ? fullDateMatch[0] : ''
    const fullDate = fullDateText.match(/\d{4}-\d{2}-\d{2}/)?.[0] || ''
    const fullTime = fullDateText.match(/\d{2}:\d{2}/)?.[0] || ''
    const timeOnlyMatch = line.match(/(?:^|[\s,，|])(\d{1,2}:\d{2})(?=[\s,，|]|$)/)
    const rawTime = fullTime || timeOnlyMatch?.[1] || ''
    const timeText = rawTime ? rawTime.padStart(5, '0') : ''

    // 分类只在前半段（金额 token 之前）找：否则备注里写了别的分类名就会改判
    const amountIndex = line.indexOf(amountText)
    const category = CATEGORIES
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .find((item) => (amountIndex >= 0 ? line.slice(0, amountIndex) : line).includes(item.name))
    const creator = line.match(/(?:^|[\s,，|])(呆呆|笛笛)(?=[\s,，|]|$)/)?.[1] || ''
    const resolved = resolveImportDate(headerDate, headerMonth, fullDate, timeText, line)
    const timestamp = parseLocalTimestamp(resolved.date, resolved.time)
    const categoryValue = category || CATEGORY_MAP.other

    let note = line
    if (fullDateText) note = note.replace(fullDateText, ' ')
    else if (timeOnlyMatch?.[1]) note = note.replace(timeOnlyMatch[1], ' ')
    if (creator) note = note.replace(creator, ' ')
    if (category) note = note.replace(category.name, ' ')
    note = note.replace(categoryValue.emoji, ' ')
    note = note.replace(amountText, ' ')
    note = stripImportSeparators(note)

    const bill = normalizeBill({
      id: 0,
      amount,
      category: categoryValue.key,
      note,
      date: resolved.date,
      month: resolved.date.slice(0, 7),
      timestamp,
      refunded,
      fingerprint: ''
    })
    bill.fingerprint = createFingerprint(bill)

    if (inTextFingerprints.has(bill.fingerprint)) {
      invalid.push(line)
      return
    }
    inTextFingerprints.add(bill.fingerprint)
    parsed.push(bill)
  })

  return {
    month: parsed[0]?.month || headerMonth,
    bills: parsed.sort((a, b) => b.timestamp - a.timestamp),
    invalid,
    noDetail: false
  }
}

export function getMonthStats(list, month) {
  const active = (list || []).filter((item) => !item.refunded && isExpense(item))
  const total = round2(active.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const [year, monthNumber] = String(month || '').split('-').map(Number)
  const daysInMonth = year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 30

  // 日均的分母是「已经过去的天数」，不是整月天数：今天是 10 月 22 日，10 月就除以 22。
  // 除以 31 会把月初的钱摊到还没发生的日子里，越接近月初日均被稀释得越厉害
  // （10 月 2 日记了 200 元会显示成日均 6.45）。历史月份用整月天数；
  // 未来月份（允许把下个月的生活费记进来）一天都还没过，按 1 天算
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthText = year && monthNumber
    ? `${year}-${String(monthNumber).padStart(2, '0')}`
    : ''
  let days = daysInMonth
  if (monthText && monthText === thisMonth) days = Math.min(now.getDate(), daysInMonth)
  else if (monthText && monthText > thisMonth) days = 1
  days = Math.max(1, days)

  return {
    total,
    count: active.length,
    dailyAverage: round2(total / days)
  }
}

// 日期取账单自身的 date，不取 timestamp 里的那一天：补记旧日期的账，timestamp 是「录入时刻」，
// 用它会让导出日期错、跨月补记还会被导入方归到另一个月。时间仍取 timestamp（字节格式不变）
function formatExportTime(dateText, timestamp, mode) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  const fallbackDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const billDate = dateText || fallbackDate
  const timeText = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (mode === 'time') return timeText
  if (mode === 'date') return billDate
  return `${billDate} ${timeText}`
}

function exportFieldsEmpty(config) {
  return !(config.time || config.category || config.amount || config.note || config.summary || config.categoryStats)
}

export function buildExportText(label, list, categoryStats, config = {}) {
  const cfg = { ...DEFAULT_EXPORT_CONFIG, ...config }
  if (exportFieldsEmpty(cfg)) return ''

  const stats = getMonthStats(list, String(label || '').slice(0, 7))
  const blocks = []

  if (cfg.summary) {
    blocks.push([
      `【简记】${label} 账单`,
      `我的总支出：${stats.total.toFixed(2)} 元，共 ${stats.count} 笔`
    ].join('\n'))
  }

  if (cfg.categoryStats && categoryStats.length) {
    blocks.push([
      '── 分类占比 ──',
      ...categoryStats.map((item) => `${cfg.emoji ? `${item.emoji} ` : ''}${item.name}：${item.amount.toFixed(2)} 元（${item.percent}%）`)
    ].join('\n'))
  }

  if (cfg.time || cfg.category || cfg.amount || cfg.note) {
    const lines = ['── 明细 ──']
    if (!list.length) {
      lines.push('（还没有账单）')
    } else {
      ;[...list].reverse().forEach((item) => {
        const tokens = []
        if (cfg.time) tokens.push(formatExportTime(item.date, item.timestamp, cfg.timeMode))
        if (cfg.category) tokens.push(`${cfg.emoji ? item.categoryEmoji : ''}${item.categoryName}`)
        if (cfg.amount) tokens.push(`${item.refunded ? '0.00' : item.amount.toFixed(2)}元${item.refunded ? '（已退款）' : ''}`)
        if (cfg.note && item.note) tokens.push(item.note)
        lines.push(tokens.filter(Boolean).join(EXPORT_SEPARATORS[cfg.sep] || ' '))
      })
    }
    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}

export function getAutoNote(categoryKey, date = new Date()) {
  if (categoryKey === 'food') {
    const hour = date.getHours()
    if (hour >= 5 && hour < 10) return '早饭'
    if (hour >= 10 && hour < 15) return '午饭'
    if (hour >= 15 && hour < 22) return '晚饭'
    return '夜宵'
  }

  if (categoryKey === 'daily') {
    const hour = date.getHours()
    return hour >= 18 && hour < 24 ? '洗澡' : ''
  }

  return ''
}

export { round2 }
