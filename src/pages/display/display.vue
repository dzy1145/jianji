<template>
  <page-meta :page-style="pageLockStyle" />
  <view class="page" :class="`theme-${theme}`">
    <view class="shell" :class="monthSlide">
      <!-- 顶栏 + 月份 + 进度条整块吸顶：进度条要一直看得见，不跟着账单滚走。
           整块一起贴是因为状态栏那块留白在 topbar 上，单把进度条贴上去会钻到状态栏下面 -->
      <view class="head-stack">
        <view class="topbar" :style="{ paddingTop: `${headerTop}px` }">
          <button
            class="side-toggle"
            :class="{ 'is-switching': switching }"
            aria-label="切回真实账本"
            @click="goBack"
          >
            <view class="side-toggle-icon" :class="{ 'is-out': switching }">
              <view class="side-sheet is-back"></view>
              <view class="side-sheet is-front"></view>
            </view>
            <view class="side-spinner" :class="{ 'is-in': switching }"></view>
          </button>
          <view class="head-copy">
            <text class="page-title">展示账本</text>
            <text class="head-sub">镜像副本 · 改动不影响真实账本</text>
          </view>
          <button
            class="text-action"
            :class="{ disabled: exporting, 'is-done': copied }"
            @click="copyExport"
          >
            {{ copied ? '已复制' : exporting ? '复制中' : '复制' }}
          </button>
        </view>

        <view class="month-nav">
          <button class="month-button" aria-label="上个月" @click="changeMonth(-1)">‹</button>
          <view class="month-copy">
            <text class="month-title">{{ monthTitle }}</text>
            <text class="month-sub">{{ monthSubLabel }}</text>
          </view>
          <button
            class="month-button"
            :class="{ disabled: !canGoNext }"
            aria-label="下个月"
            :disabled="!canGoNext"
            @click="changeMonth(1)"
          >
            ›
          </button>
        </view>

        <view class="progress-panel">
          <view class="progress-head">
            <text class="panel-label">本月假帐进度</text>
            <text class="progress-hint" :class="ledger.remaining > 0 ? 'is-need' : 'is-over'">
              {{ progressHint }}
            </text>
          </view>
          <view class="progress-numbers">
            <text class="progress-value">{{ ledger.inflated.toFixed(2) }}</text>
            <text class="progress-sep">/</text>
            <text class="progress-target">{{ ledger.target.toFixed(2) }}</text>
          </view>
          <view class="progress-track">
            <view class="progress-fill" :style="{ width: `${progressPercent}%` }"></view>
          </view>
          <view class="progress-foot">
            <text>私人 {{ ledger.privateTotal.toFixed(2) }} ＋ 想攒 {{ monthState.target.toFixed(2) }}</text>
            <view class="foot-amounts">
              <text>真实支出 {{ ledger.realTotal.toFixed(2) }}</text>
              <text class="foot-arrow">→</text>
              <text
                class="foot-display"
                :class="{ 'is-inflated': ledger.displayTotal !== ledger.realTotal }"
              >{{ ledger.displayTotal.toFixed(2) }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="control-panel">
        <view class="control-row">
          <text class="control-label">想攒的钱</text>
          <view class="target-field">
            <text class="target-unit">¥</text>
            <input
              class="target-input"
              type="digit"
              :value="targetDraft"
              placeholder="0"
              confirm-type="done"
              @input="onTargetInput"
              @blur="onTargetBlur"
            />
          </view>
        </view>
        <view class="control-row">
          <text class="control-label">保留尾数</text>
          <view class="control-side">
            <text class="control-hint">小数部分沿用真实金额</text>
            <switch :checked="keepTail" :color="switchOnColor" @change="onKeepTailChange" />
          </view>
        </view>
        <view class="ratio-block">
          <view class="ratio-head">
            <text class="control-label">类别比例</text>
            <text class="ratio-hint">0–3 倍，之后新记的账目也照这个比例；设为 1 会重置该类别的手动调整</text>
          </view>
          <view v-for="item in categories" :key="item.key" class="ratio-row">
            <view class="ratio-name-col">
              <text class="ratio-name">{{ item.emoji }} {{ item.name }}</text>
              <view v-if="ratioStats[item.key].touched" class="ratio-sum">
                <text class="ratio-sum-real">{{ formatCompact(ratioStats[item.key].real) }}</text>
                <text class="ratio-sum-arrow">→</text>
                <text
                  class="ratio-sum-display"
                  :class="{ 'is-adjusted': ratioStats[item.key].display !== ratioStats[item.key].real }"
                >{{ formatCompact(ratioStats[item.key].display) }}</text>
              </view>
            </view>
            <slider
              class="ratio-slider"
              :min="RATIO_MIN"
              :max="RATIO_MAX"
              :step="RATIO_STEP"
              :value="ratioValue(item.key)"
              :active-color="chartPalette.accent"
              :background-color="chartPalette.grid"
              :block-color="chartPalette.deep"
              :block-size="16"
              @changing="onRatioChanging(item.key, $event)"
              @change="onRatioChange(item.key, $event)"
            />
            <input
              class="ratio-input"
              type="digit"
              :value="ratioText(item.key)"
              @input="onRatioInput(item.key, $event)"
              @blur="onRatioCommit(item.key)"
              @confirm="onRatioCommit(item.key)"
            />
          </view>
          <button class="ratio-reset" @click="resetAllRatios">全部恢复 1 倍</button>
        </view>
      </view>

      <view class="section">
        <view class="section-heading">
          <view>
            <text class="section-title">展示账单</text>
            <text class="section-sub">{{ rows.length ? `${rows.length} 笔 · 拖动滑块调整展示金额` : '不含私人账目和收入' }}</text>
          </view>
        </view>

        <view v-if="rows.length" class="display-list">
          <view v-for="group in groupedRows" :key="group.date" class="display-group">
            <view class="group-heading">
              <text class="group-date">{{ group.label }}</text>
              <text v-if="group.total > 0" class="group-total">-¥{{ group.total.toFixed(2) }}</text>
            </view>

            <view
              v-for="row in group.rows"
              :key="row.key"
              class="display-row"
              :class="{ 'is-refunded': row.refunded }"
            >
              <view class="row-head">
                <!-- 和首页账单行同一个图标块：72rpx、emoji 居中、左侧离框 16rpx，
                     标题因此从 104rpx 起（16 + 72 + 16）。emoji 从标题里挪到这里，
                     两边「图标→文字→边框」的距离才对得上 -->
                <view
                  class="bill-icon"
                  :style="{ backgroundColor: `${row.categoryColor}1f`, color: row.categoryColor }"
                >
                  {{ row.categoryEmoji }}
                </view>
                <view class="row-main">
                  <text class="row-title" :class="{ 'is-hot': hotRowKeys.has(row.key) }">
                    {{ row.note || row.categoryName }}
                  </text>
                  <view class="row-meta-line">
                    <text class="row-meta">{{ row.categoryName }} · {{ formatTime(row.timestamp) }}</text>
                    <text v-if="row.source === 'virtual'" class="row-tag">虚拟</text>
                    <text v-if="row.refunded" class="row-tag">已退款</text>
                  </view>
                </view>

                <view class="row-amounts">
                  <text class="row-real">{{ row.amount.toFixed(2) }}</text>
                  <text class="row-arrow">→</text>
                  <!-- 展示金额可以直接点开改：敲进去的数字原样生效，不走保留尾数 -->
                  <view
                    class="display-chip"
                    :class="{ 'is-manual': row.manual, 'is-editing': editingRowKey === row.key }"
                    @click="startRowEdit(row)"
                  >
                    <input
                      v-if="editingRowKey === row.key"
                      class="display-input"
                      type="digit"
                      :value="rowAmountDraft"
                      :focus="rowAmountFocused"
                      confirm-type="done"
                      @input="onRowAmountInput"
                      @blur="commitRowEdit(row)"
                      @confirm="commitRowEdit(row)"
                    />
                    <text v-else class="row-display">{{ row.display.toFixed(2) }}</text>
                  </view>
                </view>

                <button
                  v-if="row.source === 'virtual'"
                  class="icon-button is-danger"
                  aria-label="删除虚拟账单"
                  @click="removeVirtual(row)"
                >
                  ×
                </button>
              </view>

              <view v-if="!row.refunded" class="row-slider-line">
                <slider
                  class="amount-slider"
                  :min="0"
                  :max="row.sliderMax"
                  :step="0.1"
                  :value="row.raw"
                  :active-color="chartPalette.accent"
                  :background-color="chartPalette.grid"
                  :block-color="chartPalette.deep"
                  :block-size="16"
                  @changing="onRowChanging(row, $event)"
                  @change="onRowChange(row, $event)"
                />
                <button class="icon-button" aria-label="重置为真实金额" @click="resetRow(row)">↺</button>
              </view>
            </view>
          </view>
        </view>

        <view v-else class="empty-panel">
          <text class="empty-title">这个月没有可展示的账目</text>
          <text class="empty-sub">私人账目不会出现在展示账本里。可以点下面的按钮加一笔虚拟账单把假帐补上。</text>
        </view>
      </view>
    </view>

    <button class="add-button" @click="openVirtualEditor">＋ 新增虚拟账单</button>

    <view
      v-if="virtualVisible"
      class="modal-mask"
      :class="{ 'is-closing': closingSheet === 'virtual' }"
      @click="closeVirtualEditor"
      @touchmove.stop.prevent
    >
      <view class="sheet" @click.stop @touchmove.stop>
        <view class="sheet-heading">
          <view>
            <text class="sheet-title">新增虚拟账单</text>
            <text class="sheet-sub">{{ monthTitle }} · 只进展示账本，不影响真实账本</text>
          </view>
          <button class="sheet-close" aria-label="关闭" @click="closeVirtualEditor">×</button>
        </view>

        <view class="form-block">
          <text class="form-label">类别</text>
          <view class="category-grid">
            <button
              v-for="item in categories"
              :key="item.key"
              class="category-option"
              :class="{ active: virtualForm.category === item.key }"
              @click="selectVirtualCategory(item.key)"
            >
              <text class="category-option-emoji">{{ item.emoji }}</text>
              <text class="category-option-name">{{ item.name }}</text>
            </button>
          </view>
        </view>

        <view class="form-block">
          <text class="form-label">金额</text>
          <view class="amount-input-wrap" :class="{ invalid: amountError }">
            <text class="amount-prefix">¥</text>
            <input
              v-model="virtualForm.amount"
              class="amount-input"
              type="digit"
              placeholder="0.00"
              confirm-type="done"
            />
          </view>
          <text v-if="amountError" class="field-error">{{ amountError }}</text>
        </view>

        <view class="form-block">
          <text class="form-label">时间</text>
          <picker-view
            class="virtual-wheel"
            :value="virtualPickerIndexes"
            :indicator-style="virtualIndicatorStyle"
            @change="onVirtualWheelChange"
          >
            <picker-view-column>
              <view v-for="item in virtualDayOptions" :key="`vd-${item}`" class="wheel-item">{{ item }}日</view>
            </picker-view-column>
            <picker-view-column>
              <view v-for="item in HOUR_OPTIONS" :key="`vh-${item}`" class="wheel-item">{{ item }}时</view>
            </picker-view-column>
            <picker-view-column>
              <view v-for="item in MINUTE_OPTIONS" :key="`vm-${item}`" class="wheel-item">{{ item }}分</view>
            </picker-view-column>
          </picker-view>
        </view>

        <view class="form-block">
          <text class="form-label">备注</text>
          <input
            v-model="virtualForm.note"
            class="field-input"
            maxlength="30"
            placeholder="午饭、奶茶等"
          />
        </view>

        <button class="primary-button" :class="{ disabled: !virtualValid }" @click="submitVirtual">
          加入展示账本
        </button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  CATEGORIES,
  CATEGORY_MAP,
  DEFAULT_EXPORT_CONFIG,
  buildExportText,
  getAutoNote,
  getCategoryStats,
  listBills,
  round2
} from '../../services/ledger'
import {
  RATIO_MAX,
  RATIO_MIN,
  RATIO_STEP,
  addVirtualBill,
  buildDisplayLedger,
  clampRatio,
  clearRowRaw,
  ensureMonthState,
  loadDisplayState,
  monthOrEmpty,
  pruneDisplayState,
  ratioOf,
  removeVirtualBill,
  saveDisplayState,
  setCategoryRatio,
  setMonthTarget,
  setRowExact,
  setRowRaw,
  toExportBills
} from '../../services/displayLedger'

const categories = CATEGORIES

// 开关色和滑块色跟着主题走。这两个表和 index.vue 里的 themeOptions.switchOn /
// chartPalettes 是同一份值，改主题色时三处都要改（CSS 令牌在 App.vue）。
const SWITCH_ON = { sakura: '#cf3b61', mint: '#2e816c', amber: '#a36621', night: '#b4557a' }
const CHART_PALETTES = {
  sakura: { accent: '#dc6f8b', deep: '#ad4864', grid: 'rgba(98, 67, 79, 0.12)' },
  mint: { accent: '#3eaf92', deep: '#207a65', grid: 'rgba(44, 107, 88, 0.12)' },
  amber: { accent: '#d99342', deep: '#975e1c', grid: 'rgba(120, 84, 41, 0.12)' },
  night: { accent: '#df8eaa', deep: '#f3b4c8', grid: 'rgba(255, 255, 255, 0.11)' }
}

// 今天的日期必须是响应式的：展示账本是独立页面，实例在整个 App 会话里一直存在，
// 跨天从后台唤起时若不重算，「本月/下月」标签、翻月上限、虚拟账单默认日期会全卡在昨天
// （首页 index.vue 同一处已经这样处理，这里是那条规则的补齐）。
// onShow 里刷新它，见下面的 onShow 注册。
const today = ref(getToday())
const systemInfo = uni.getSystemInfoSync()
const headerTop = ref((systemInfo.safeAreaInsets && systemInfo.safeAreaInsets.top) || systemInfo.statusBarHeight || 12)

// 上一次读到的账单。展示账本每次进来都是一个新页面实例，而 SQLite 查询是异步的——
// 不留一份缓存的话，首帧只能拿空数组算出「0.00」，等查询回来才跳成真数，看着就是慢一拍。
// 只影响首帧的显示，写操作和 prune 都在 await 之后用新数据跑
let cachedBills = []
const allBills = ref(cachedBills)
const currentMonth = ref(today.value.slice(0, 7))
const theme = ref(uni.getStorageSync('jianji_theme') || 'sakura')
const displayState = ref(loadDisplayState())
const closingSheet = ref('')
const virtualVisible = ref(false)
// 正在切回真实账本：按钮里的图标换成转圈
const switching = ref(false)
const exporting = ref(false)
// 复制成功的确认态：按钮原地变「已复制」约 0.9 秒再变回来
const copied = ref(false)
let copiedTimer = null
// 正在直接改金额的那一行（key），以及输入框里的草稿
const editingRowKey = ref('')
const rowAmountDraft = ref('')
const rowAmountFocused = ref(false)
const monthSlide = ref('')
const ratioDrafts = reactive({})
// 「想攒的钱」的草稿值。必须在 setup 里同步取好：displayState 是从 storage 同步读的，
// 而 loadData 要先 await 账单查询，等它回来再填就是那个「慢一拍」
const targetDraft = ref(targetText(displayState.value, currentMonth.value))

const virtualForm = reactive({ amount: '', category: 'food', note: '' })

// 虚拟账单的时间滚轮：日只给当月天数（这就是「限制在本月」），时分随便挑——
// 一天里补好几笔假账，时分全一样太假
const HOUR_OPTIONS = Array.from({ length: 24 }, (unused, index) => index)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (unused, index) => index)
const virtualPickerIndexes = ref([0, 0, 0])
const virtualDayOptions = computed(() => {
  const [year, month] = currentMonth.value.split('-').map(Number)
  return Array.from({ length: new Date(year, month, 0).getDate() }, (unused, index) => index + 1)
})
const virtualIndicatorStyle = computed(() => `height: ${uni.upx2px(88)}px;`)

const switchOnColor = computed(() => SWITCH_ON[theme.value] || SWITCH_ON.sakura)
const chartPalette = computed(() => CHART_PALETTES[theme.value] || CHART_PALETTES.sakura)
const keepTail = computed(() => displayState.value.keepTail)

// 只读当月那层。缺月时返回一个空对象——写操作走 mutableMonth，不会用到这里
const monthState = computed(() => monthOrEmpty(displayState.value, currentMonth.value))

const ledger = computed(() =>
  buildDisplayLedger({
    bills: allBills.value,
    month: currentMonth.value,
    monthState: monthState.value,
    keepTail: displayState.value.keepTail
  })
)

// 分类的图标、名字、颜色由这里挂上去：displayLedger 那层不认 CATEGORY_MAP
// （它要保持零依赖，好在 Node 里直接跑校验脚本）
function withCategory(row) {
  const category = CATEGORY_MAP[row.category] || CATEGORY_MAP.other
  return {
    ...row,
    categoryName: category.name,
    categoryEmoji: category.emoji,
    categoryColor: category.color
  }
}

const rows = computed(() => ledger.value.rows.map(withCategory))

// 按天分组：这一页原来只显示时分，跨天的账目混成一条流水，看不出哪天花了多少。
// 日期标签与合计跟首页 groupedBills 同一套口径（日期倒序、已退款不计入），
// 合计用展示金额——这一页对外展示的本来就是夸大后的数字。
// rows 已按 timestamp 倒序，组内顺序直接沿用。
const groupedRows = computed(() => {
  const map = {}
  rows.value.forEach((row) => {
    const date = row.date || ''
    if (!date) return
    if (!map[date]) {
      map[date] = { date, label: formatDateLabel(date), total: 0, rows: [] }
    }
    map[date].rows.push(row)
    if (!row.refunded) map[date].total = round2(map[date].total + row.display)
  })
  return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1))
})

// 最值得调整的账目：真实金额从大到小排前 20%，名字标红。
// 已退款的没有滑块、调了也没用，不参与排序；虚拟账单本来就是我们自己编的，也不参与
const hotRowKeys = computed(() => {
  const adjustable = ledger.value.rows
    .filter((row) => row.source === 'real' && !row.refunded)
    .sort((a, b) => b.amount - a.amount)
  const count = Math.ceil(adjustable.length * 0.2)
  return new Set(adjustable.slice(0, count).map((row) => row.key))
})

const progressPercent = computed(() => Math.round(ledger.value.progress * 100))
const progressHint = computed(() => {
  const remaining = ledger.value.remaining
  return remaining > 0
    ? `仍需假帐 ${remaining.toFixed(2)} 元`
    : `超出 ${Math.abs(remaining).toFixed(2)} 元`
})

// 每个类别的「真实合计 → 展示合计」，给滑块旁边那行小字用。
// 拖动滑块是实时改 state 的，所以这行字跟着动；虚拟账单只进展示合计（没有真实对照）
const ratioStats = computed(() => {
  const map = {}
  categories.forEach((item) => {
    map[item.key] = { real: 0, display: 0, touched: false }
  })
  ledger.value.rows.forEach((row) => {
    if (!map[row.category]) map[row.category] = { real: 0, display: 0, touched: false }
    const entry = map[row.category]
    // 已退款的和账本口径一致：不进真实合计，展示金额本身就是 0
    if (row.source === 'real' && !row.refunded) entry.real = round2(entry.real + row.amount)
    entry.display = round2(entry.display + row.display)
  })
  Object.keys(map).forEach((key) => {
    const entry = map[key]
    entry.touched = entry.real > 0 || entry.display > 0
  })
  return map
})

// 小字里整数不带 .00 才塞得下（列宽 240rpx），有小数才保留两位
function formatCompact(value) {
  const number = round2(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

const amountError = computed(() => {
  const raw = String(virtualForm.amount).trim()
  if (!raw) return ''
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return '只能填数字，最多两位小数'
  if (Number(raw) <= 0) return '金额要大于 0'
  return ''
})
const virtualValid = computed(() => !amountError.value && Boolean(String(virtualForm.amount).trim()))

function getToday() {
  const date = new Date()
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const isCurrentMonth = computed(() => currentMonth.value === today.value.slice(0, 7))
const monthTitle = computed(() => {
  const [year, month] = currentMonth.value.split('-')
  return `${year}年${Number(month)}月`
})
// 上限和首页一致：翻到下个月为止（真实账本现在允许记到下个月，展示账本得跟得上）。
// 库里真有更远月份的账单时也放行，否则那些账目在展示账本里翻不到
const nextMonthText = shiftMonth(today.value.slice(0, 7), 1)
const canGoNext = computed(() => {
  const next = shiftMonth(currentMonth.value, 1)
  if (next <= nextMonthText) return true
  return allBills.value.some((item) => item.month === next)
})
const monthSubLabel = computed(() => {
  if (isCurrentMonth.value) return '本月'
  return currentMonth.value > today.value.slice(0, 7) ? '下月' : '历史'
})

// 「今天 / 昨天 / M月D日」。基准取 today 这个 ref 而不是现调 new Date()：
// 跨天唤起后 onShow 会刷新 today，标签才会跟着走；现取的话 computed 没有响应式依赖，
// 只会算一次，第二天还挂着「今天」
function formatDateLabel(dateText) {
  const [year, month, day] = String(dateText).split('-').map(Number)
  if (!year || !month || !day) return String(dateText || '')
  const [todayYear, todayMonth, todayDay] = today.value.split('-').map(Number)
  if (year === todayYear && month === todayMonth && day === todayDay) return '今天'
  const yesterday = new Date(todayYear, todayMonth - 1, todayDay - 1)
  if (
    year === yesterday.getFullYear() &&
    month === yesterday.getMonth() + 1 &&
    day === yesterday.getDate()
  ) {
    return '昨天'
  }
  return `${month}月${day}日`
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 想攒的钱：0 就是没填，输入框显示空而不是「0」
function targetText(state, month) {
  const value = monthOrEmpty(state, month).target
  return value ? String(value) : ''
}

async function loadData() {
  // 先同步填好输入框（数据在 storage 里，不用等），再等账单查询
  targetDraft.value = targetText(displayState.value, currentMonth.value)
  cachedBills = await listBills()
  allBills.value = cachedBills
  let dirty = ensureMonthState(displayState.value, currentMonth.value)
  // 真实账本删了、标私人了、改金额或改类别了，对应的单笔调整就作废
  if (pruneDisplayState(displayState.value, allBills.value)) dirty = true
  if (dirty) saveDisplayState(displayState.value)
  Object.keys(ratioDrafts).forEach((key) => delete ratioDrafts[key])
}

onShow(() => {
  // 跨天唤起时先重算 today（页面实例不会重建，不刷就卡在昨天），再重载数据。
  // 和首页同一条口径：不动 currentMonth，免得把用户正在看的月份弹回本月
  today.value = getToday()
  loadData()
})

function persist() {
  saveDisplayState(displayState.value)
}

/* ---------- 顶部与翻月 ---------- */

function goBack() {
  if (switching.value) return
  // 底涨满 + 图标滑出 + 圆环滑入在按下瞬间同时发生，120ms 后开始退栈。
  // 本页向右滑出（slide 的反向），和「往左推过去」形成对称的方向感
  switching.value = true
  setTimeout(() => {
    uni.navigateBack({
      delta: 1,
      fail: () => uni.reLaunch({ url: '/pages/index/index' })
    })
  }, 120)
}

async function changeMonth(delta) {
  const next = shiftMonth(currentMonth.value, delta)
  if (next > nextMonthText && !allBills.value.some((item) => item.month === next)) {
    uni.showToast({ title: '最多只能看到下个月', icon: 'none' })
    return
  }
  currentMonth.value = next
  // 翻月顺手关掉正在改的金额框：那一行可能在新月份里根本不存在
  editingRowKey.value = ''
  rowAmountFocused.value = false
  await loadData()
  playMonthSlide(delta)
}

function shiftMonth(monthText, delta) {
  const [year, month] = monthText.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// 这个项目里 requestAnimationFrame 不是能直接用的全局（App 端原生事件回调里裸调会抛
// ReferenceError）。翻月要等一个帧边界再加类，取不到就退化成 16ms 的 setTimeout。
const rafFn =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 16)

let monthSlideTimer = null

// keyframe 不会自己重放：连着翻同方向时类名不变、Vue 不 patch，第二次点就静默没动画。
// 先摘掉类、等一帧再加回来。同理不能同步调 start——两次改动会被合并批处理
function playMonthSlide(delta) {
  const next = delta > 0 ? 'is-next' : 'is-prev'
  if (monthSlideTimer) clearTimeout(monthSlideTimer)
  monthSlide.value = ''
  rafFn(() => {
    monthSlide.value = next
    monthSlideTimer = setTimeout(() => {
      monthSlide.value = ''
    }, 200)
  })
}

/* ---------- 弹层 ---------- */

// 出场动画和 index.vue 一套做法：加 is-closing 跑 keyframe，等动画跑完再卸 v-if。
// 比 CSS 里的 200ms 多留一点，定时器与动画同长会有一帧被提前卸掉
const SHEET_EXIT_MS = 220
let closeTimer = null

const sheetRefs = { virtual: virtualVisible }
const pageLockStyle = computed(() =>
  Object.values(sheetRefs).some((sheet) => sheet.value) ? 'overflow: hidden' : 'overflow: visible'
)

function closeSheet(name) {
  if (closingSheet.value) return
  closingSheet.value = name
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    closeTimer = null
    sheetRefs[name].value = false
    closingSheet.value = ''
  }, SHEET_EXIT_MS)
}

/* ---------- 想攒的钱 ---------- */

function onTargetInput(event) {
  const text = String(event.detail.value || '')
  targetDraft.value = text
  // 边输边算：进度条要跟着动。非法输入（空、小数点后三位）先不动 state
  if (!/^\d*(\.\d{0,2})?$/.test(text)) return
  setMonthTarget(displayState.value, currentMonth.value, text || 0)
  persist()
}

function onTargetBlur() {
  targetDraft.value = monthState.value.target ? String(monthState.value.target) : ''
}

/* ---------- 保留尾数 ---------- */

function onKeepTailChange(event) {
  displayState.value.keepTail = Boolean(event.detail.value)
  persist()
}

/* ---------- 单笔调整 ---------- */

// 滑块给不出数值时直接不动：Number(undefined) 是 NaN，写进状态会变成 UI 上一串
// 「NaN」，落盘时又被 JSON 变成 null，等于把这一行的调整悄悄弄没了
function onRowChanging(row, event) {
  const value = Number(event.detail.value)
  if (!Number.isFinite(value)) return
  setRowRaw(displayState.value, currentMonth.value, row, value)
}

function onRowChange(row, event) {
  onRowChanging(row, event)
  persist()
}

/* ---------- 点开展示金额直接改 ---------- */

// 敲进去的数字走 setRowExact：它原样生效，不过保留尾数（否则输 20 会变成 20.99）。
// 上限是展示口径的滑块顶端（含保留尾数），免得出现「滑块顶到头、数字却更大」这种对不上的状态
function startRowEdit(row) {
  if (row.refunded) return
  // 已经在改这一行了就别重来一次：输入框在胶囊里面，点输入框会冒泡上来，
  // 没这个守卫的话点一下就把刚敲的字重置回原值
  if (editingRowKey.value === row.key) return
  editingRowKey.value = row.key
  rowAmountDraft.value = row.display.toFixed(2)
  rowAmountFocused.value = true
}

function onRowAmountInput(event) {
  rowAmountDraft.value = String(event.detail.value || '')
}

function commitRowEdit(row) {
  if (editingRowKey.value !== row.key) return
  const text = String(rowAmountDraft.value).trim()
  if (!text) {
    editingRowKey.value = ''
    rowAmountFocused.value = false
    return
  }
  const value = Number(text)
  // 校验不通过时先不收框：旧写法先清掉 editingRowKey 再校验，被拒时输入框已经关了，
  // 用户得重新点开才能改
  if (!Number.isFinite(value) || value < 0) {
    uni.showToast({ title: '只能填数字', icon: 'none' })
    return
  }
  if (value > row.displayMax + 1e-9) {
    uni.showToast({ title: `最多填到 ${row.displayMax.toFixed(2)}`, icon: 'none' })
    return
  }
  setRowExact(displayState.value, currentMonth.value, row, round2(value))
  persist()
  editingRowKey.value = ''
  rowAmountFocused.value = false
}

// 重置为真实金额。重置后仍然算「已手动调整」，不再跟批量比例走；
// 只有把该类别比例设回 1 才会清掉这个标记（需求里写明的）
function resetRow(row) {
  clearRowRaw(displayState.value, currentMonth.value, row)
  persist()
}

/* ---------- 类别比例 ---------- */

function ratioValue(key) {
  return ratioOf(monthState.value, key)
}

function ratioText(key) {
  return ratioDrafts[key] === undefined ? String(ratioValue(key)) : ratioDrafts[key]
}

function onRatioChanging(key, event) {
  const value = Number(event.detail.value)
  if (!Number.isFinite(value)) return
  // 拖动时滑块是唯一输入源，输入框要跟着回到跟随状态
  delete ratioDrafts[key]
  monthState.value.ratios[key] = clampRatio(value)
}

function onRatioChange(key, event) {
  const value = Number(event.detail.value)
  if (!Number.isFinite(value)) return
  const result = setCategoryRatio(displayState.value, currentMonth.value, key, value)
  persist()
  if (result.reset) {
    uni.showToast({ title: '已重置该类别的调整', icon: 'none' })
  }
}

function onRatioInput(key, event) {
  ratioDrafts[key] = String(event.detail.value || '')
}

function onRatioCommit(key) {
  const draft = ratioDrafts[key]
  delete ratioDrafts[key]
  if (draft === undefined) return
  const text = draft.trim()
  if (!text) return
  const value = Number(text)
  if (!Number.isFinite(value)) {
    uni.showToast({ title: '只能填 0 到 3 的数字', icon: 'none' })
    return
  }
  const result = setCategoryRatio(displayState.value, currentMonth.value, key, value)
  persist()
  if (result.reset) {
    uni.showToast({ title: '已重置该类别的调整', icon: 'none' })
  } else if (clampRatio(value) !== round2(value)) {
    uni.showToast({ title: '比例只支持 0 到 3', icon: 'none' })
  }
}

function resetAllRatios() {
  // 比例设成 1 会连带清掉该类别的手动调整，全部恢复等于把这个月的手动调整都抹掉，
  // 得先问一句
  uni.showModal({
    title: '全部恢复 1 倍',
    content: '所有类别的比例都会回到 1 倍，这个月已经手动调整过的账目也会一起恢复成真实金额。',
    success: (result) => {
      if (!result.confirm) return
      categories.forEach((item) => {
        setCategoryRatio(displayState.value, currentMonth.value, item.key, 1)
      })
      Object.keys(ratioDrafts).forEach((key) => delete ratioDrafts[key])
      persist()
      uni.showToast({ title: '已全部恢复 1 倍', icon: 'none' })
    }
  })
}

/* ---------- 虚拟账单 ---------- */

function openVirtualEditor() {
  virtualForm.amount = ''
  virtualForm.category = 'food'
  virtualForm.note = ''
  // 默认落在今天 + 当前时刻；历史月没有「今天」，落在 1 号
  const now = new Date()
  const day = currentMonth.value === today.value.slice(0, 7) ? now.getDate() : 1
  virtualPickerIndexes.value = [
    Math.min(day, virtualDayOptions.value.length) - 1,
    now.getHours(),
    now.getMinutes()
  ]
  virtualVisible.value = true
}

function closeVirtualEditor() {
  closeSheet('virtual')
}

function selectVirtualCategory(key) {
  virtualForm.category = key
  if (!String(virtualForm.note || '').trim()) virtualForm.note = getAutoNote(key)
}

function onVirtualWheelChange(event) {
  const [dayIndex, hourIndex, minuteIndex] = event.detail.value
  virtualPickerIndexes.value = [dayIndex ?? 0, hourIndex ?? 0, minuteIndex ?? 0]
}

function virtualDateTime() {
  const [dayIndex, hourIndex, minuteIndex] = virtualPickerIndexes.value
  const days = virtualDayOptions.value
  const day = days[Math.min(Math.max(dayIndex, 0), days.length - 1)]
  const hour = HOUR_OPTIONS[Math.min(Math.max(hourIndex, 0), HOUR_OPTIONS.length - 1)]
  const minute = MINUTE_OPTIONS[Math.min(Math.max(minuteIndex, 0), MINUTE_OPTIONS.length - 1)]
  const [year, month] = currentMonth.value.split('-').map(Number)
  return {
    date: `${currentMonth.value}-${String(day).padStart(2, '0')}`,
    timestamp: new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
  }
}

function submitVirtual() {
  if (!virtualValid.value) {
    uni.showToast({ title: '先填写金额', icon: 'none' })
    return
  }
  const when = virtualDateTime()
  addVirtualBill(displayState.value, currentMonth.value, {
    amount: round2(virtualForm.amount),
    category: virtualForm.category,
    note: String(virtualForm.note || '').trim(),
    date: when.date,
    timestamp: when.timestamp
  })
  persist()
  closeVirtualEditor()
  uni.vibrateShort({ type: 'light' })
}

function removeVirtual(row) {
  uni.showModal({
    title: '删除虚拟账单',
    content: `确定删除“${row.note || row.categoryName}”吗？`,
    success: (result) => {
      if (!result.confirm) return
      removeVirtualBill(displayState.value, currentMonth.value, row.vid)
      persist()
      uni.vibrateShort({ type: 'light' })
    }
  })
}

/* ---------- 导出 ---------- */

function copyExport() {
  if (exporting.value) return
  // 金额换成展示金额，私人账目和收入本来就不在 rows 里，汇总和分类占比由展示金额算出
  const list = toExportBills(rows.value)
  if (!list.length) {
    uni.showToast({ title: '这个月没有可导出的账目', icon: 'none' })
    return
  }

  // 沿用真实账本里保存的导出设置（字段、时间格式、连接符），展示账本不再维护一套
  const config = { ...DEFAULT_EXPORT_CONFIG, ...(uni.getStorageSync('jianji_export_config') || {}) }
  const text = buildExportText(currentMonth.value, list, getCategoryStats(list), config)
  if (!text) {
    uni.showToast({ title: '导出字段都被关掉了，先去首页导出里勾上', icon: 'none' })
    return
  }

  exporting.value = true
  try {
    uni.setClipboardData({
      data: text,
      success: () => {
        // 成功反馈落在按钮上（已复制），不再弹 toast——顶栏就在按钮旁边，
        // 报告结果的地方离触发的地方越近越好看
        copied.value = true
        clearTimeout(copiedTimer)
        copiedTimer = setTimeout(() => {
          copied.value = false
        }, 900)
      },
      fail: () => uni.showToast({ title: '复制失败，请重试', icon: 'none' }),
      complete: () => {
        exporting.value = false
      }
    })
  } catch (error) {
    exporting.value = false
    console.error('导出展示账本失败', error)
  }
}
</script>

<style scoped>
button {
  margin: 0;
  padding: 0;
  line-height: 1;
  box-sizing: border-box;
  /* 松手这半程带轻微过冲：缩下去再弹回时多走一点点才落定，手感才像实体键 */
  transition: transform 120ms cubic-bezier(0.34, 1.4, 0.64, 1);
}

button::after {
  border: 0;
}

/* 按下反馈走 .button-hover 而不是 :active（uni-app 在 touchstart 时挂这个类，
   WebView 里 <button> 的 :active 并不可靠）。按下那一刻必须 0ms 就位。
   只做形变、不做变淡——叠 opacity 会让小字发虚，像在加载而不是被按住 */
.button-hover {
  background-color: transparent;
  color: inherit;
  transform: scale(0.96);
}

button.button-hover {
  transition: none;
}

.shell {
  width: 100%;
  max-width: 840px;
  margin: 0 auto;
  padding: 0 var(--sp-6) 240rpx;
  box-sizing: border-box;
}

/* 翻月：和首页同一套，位移 24rpx + 淡入 140ms——翻月是浏览行为，不该大动 */
.shell.is-next {
  animation: monthInNext 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}

.shell.is-prev {
  animation: monthInPrev 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes monthInNext {
  from {
    transform: translateX(24rpx);
    opacity: 0;
  }
}

@keyframes monthInPrev {
  from {
    transform: translateX(-24rpx);
    opacity: 0;
  }
}

/* ---------- 顶栏 ---------- */

/* 吸顶块。负边距配同值内边距是为了让底色铺满整宽——.shell 有左右内边距，
   不给负边距的话吸顶时两侧会漏出下面滑过的账单行。
   底色先写不透明兜底再写半透明：color-mix() 不被支持时整条声明会被丢弃 */
.head-stack {
  position: sticky;
  top: 0;
  z-index: var(--z-fab);
  margin: 0 calc(-1 * var(--sp-6));
  padding: 0 var(--sp-6) var(--sp-3);
  background: var(--surface-strong);
  background: color-mix(in srgb, var(--surface-strong) 92%, transparent);
  backdrop-filter: blur(14px);
}

.topbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding-bottom: var(--sp-3);
}

.text-action {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: inset 0 0 0 1rpx var(--line);
  color: var(--text);
}

/* 和首页那个 ⇋ 是同一个开关：同一本账的两面，位置固定在顶栏最左，尺寸一模一样。
   首页 scoped 里有一份一样的是刻意的（本项目跨页面的组件样式都是各页各一份），改要两边一起改 */
.side-toggle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 64rpx;
  height: 64rpx;
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--accent-deep);
  box-shadow: inset 0 0 0 1rpx var(--line);
  /* 不写 overflow: hidden，否则 ::after 的 88rpx 命中区会被裁掉 */
  isolation: isolate;
}

/* 和首页一致：按下时底色涨满 + 图标滑出 + 圆环滑入，三样同步 */
.side-toggle::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--btn-from), var(--btn-to));
  opacity: 0;
  transform: scale(0.35);
  pointer-events: none;
  transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out;
}

.side-toggle.is-switching::before {
  opacity: 1;
  transform: scale(1);
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 90ms linear;
}

/* 和首页那份一致：两页纸叠在一起 = 两份账 */
.side-toggle-icon {
  position: relative;
  z-index: 1;
  display: block;
  width: 34rpx;
  height: 32rpx;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease-out;
}

.side-toggle-icon.is-out {
  transform: translateX(-150%);
  opacity: 0;
  transition-duration: 140ms, 100ms;
}

.side-sheet {
  position: absolute;
  width: 22rpx;
  height: 26rpx;
  border-radius: 4rpx;
}

.side-sheet.is-back {
  top: -2rpx;
  right: -2rpx;
  border: 3rpx solid currentColor;
  opacity: 0.55;
}

.side-sheet.is-front {
  left: 0;
  bottom: 0;
  background: currentColor;
}

/* 点击后转圈，直到页面切完；与底色涨满、图标滑出同步 */
.side-spinner {
  position: absolute;
  z-index: 1;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(255, 255, 255, 0.22);
  border-top-color: var(--on-accent);
  opacity: 0;
  transform: translateX(150%);
  /* 旋转用独立 rotate，写进 transform 会盖掉位移、圆环就不转了 */
  animation: sideSpin 380ms linear infinite;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease-out;
}

.side-spinner.is-in {
  opacity: 1;
  transform: translateX(0);
  transition-delay: 50ms;
}

@keyframes sideSpin {
  from {
    rotate: 0deg;
  }
  to {
    rotate: 360deg;
  }
}

.side-toggle.is-switching {
  transform: none;
  color: var(--on-accent);
}

/* 视觉尺寸不变，命中区撑到 88rpx（=44px） */
.side-toggle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 88rpx;
  height: 88rpx;
  transform: translate(-50%, -50%);
}

.text-action {
  flex: 0 0 auto;
  min-width: 96rpx;
  padding: 0 var(--sp-4);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.text-action.disabled {
  box-shadow: none;
  opacity: 0.5;
}

/* 复制成功：按钮原地变成绿色「已复制」，0.9 秒后自己退回 */
.text-action.is-done {
  border-color: transparent;
  background: color-mix(in srgb, var(--positive-text) 14%, transparent);
  color: var(--positive-text);
  box-shadow: none;
}

.head-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 顶栏这两行的行高与首页那份（日期 34 + 4 + 标题 56）故意配成同样的 94rpx：
   两块等高，⇋ 在两边居中算出来才是同一个 y。别改回 1.2 这种相对值 */
.page-title {
  color: var(--text-strong);
  font-size: var(--fs-xl);
  font-weight: var(--fw-black);
  letter-spacing: -0.02em;
  line-height: 56rpx;
}

.head-sub {
  margin-top: var(--sp-1);
  color: var(--text-soft);
  font-size: var(--fs-2xs);
  letter-spacing: 0.01em;
  line-height: 34rpx;
}

/* ---------- 月份 ---------- */

.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--sp-4);
}

.month-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 68rpx;
  height: 68rpx;
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: inset 0 0 0 1rpx var(--line);
  color: var(--accent-deep);
  font-size: var(--fs-2xl);
  line-height: 1;
}

.month-button.disabled {
  box-shadow: none;
  opacity: 0.4;
}

.month-copy {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.month-title {
  color: var(--text-strong);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heavy);
  letter-spacing: -0.01em;
}

.month-sub {
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-pill);
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  letter-spacing: 0.01em;
}

/* ---------- 进度条 ---------- */

.progress-panel {
  margin-top: var(--sp-5);
  padding: var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow);
}

.progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
}

.panel-label {
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.progress-hint {
  flex: 0 0 auto;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  letter-spacing: 0.01em;
}

.progress-hint.is-need {
  color: var(--accent-deep);
}

.progress-hint.is-over {
  color: var(--positive-text);
}

.progress-numbers {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

.progress-value {
  color: var(--text-strong);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-black);
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.progress-sep,
.progress-target {
  color: var(--text-soft);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
}

.progress-track {
  margin-top: var(--sp-4);
  height: 16rpx;
  border-radius: var(--r-pill);
  background: var(--accent-soft);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--btn-from), var(--btn-to));
  transition: width 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

.progress-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

/* 真实支出 → 展示总额。后者是这一页所有夸大之后的合计 */
.foot-amounts {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}

.foot-display.is-inflated {
  color: var(--accent-deep);
  font-weight: var(--fw-bold);
}

/* ---------- 控制区 ---------- */

.control-panel {
  margin-top: var(--sp-5);
  padding: var(--sp-4) var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow-xs);
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  min-height: 72rpx;
}

.control-label {
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.control-side {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.control-hint {
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

.target-field {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-3);
  height: 60rpx;
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 1rpx solid var(--line);
}

.target-unit {
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.target-input {
  width: 160rpx;
  height: 60rpx;
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-align: right;
}

/* ---------- 列表 ---------- */

.section {
  margin-top: var(--sp-6);
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-4);
}

.section-title {
  display: block;
  color: var(--text-strong);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heavy);
  letter-spacing: -0.01em;
}

.section-sub {
  display: block;
  margin-top: var(--sp-1);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  letter-spacing: 0.01em;
}

.display-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/* 一天一个框：日期在框头，当天的账目框在里面。原来是每笔一张独立小卡，
   跨天混排时看不出「哪天花了多少」。形状照首页 .bill-group：外框负责圆角与描边，
   组内的行只用一条分隔线，不再各自成卡 */
.display-group {
  overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow-xs);
}

.group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--surface-soft);
  border-bottom: 1rpx solid var(--line);
}

.group-date {
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

/* 当天的展示合计（已退款不计）。用强调色而不是收入绿：这一页所有数字都是支出 */
.group-total {
  flex: 0 0 auto;
  color: var(--accent-deep);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

/* 一行账目拆成两行：上排是图标/名字/金额，拖动条单独占下排整行——
   滑块长了才拨得准。外框由 .display-group 提供，上下内距与首页 .bill-item 同值（sp-4） */
.display-row {
  display: flex;
  flex-direction: column;
  padding: var(--sp-4);
}

.display-row + .display-row {
  border-top: 1rpx solid var(--line);
}

.row-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  /* 和首页 .bill-item 的 min-height 同值：图标 72rpx 在这块里居中，
     于是它也距行上边框 34rpx（16 padding + 18 居中留白），和真实账本一样 */
  min-height: 108rpx;
}

/* 和首页 .bill-icon 同一套度量：72rpx 方块、emoji 居中、底色是类别色的 12%、
   左边缘离卡片 16rpx；再靠 gap + margin-right 凑出 16rpx 的文字间距，
   标题于是和首页一样从 104rpx 起 */
.bill-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  flex: 0 0 72rpx;
  margin-right: var(--sp-2);
  border-radius: var(--r-md);
  font-size: var(--fs-lg);
}

.display-row.is-refunded {
  opacity: 0.62;
}

.row-main {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.row-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-strong);
  /* 与首页 .bill-title 同字号（fs-md）：文字列高度也跟着一致，
     标题距行上边框的位置才对得上 34rpx */
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
}

/* 真实金额排前 20% 的账目：标红 = 最值得拿来夸大 */
.row-title.is-hot {
  color: var(--danger-text);
}

.row-meta-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: 2rpx;
}

.row-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-soft);
  /* 首页 .bill-meta 是 fs-xs，这里跟上；比 fs-2xs 大一档，和标题的比例也才对 */
  font-size: var(--fs-xs);
}

.row-tag {
  flex: 0 0 auto;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: var(--fs-2xs);
  font-weight: var(--fw-medium);
  line-height: 1.6;
}

.row-amounts {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}

/* 前面的金额是真实账本里的数字，只读；后面的才是给父母看的 */
.row-real {
  color: var(--text-soft);
  font-size: var(--fs-xs);
}

.row-arrow {
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

/* 展示金额做成一个小胶囊：看着就能点，点开变成输入框 */
.display-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 124rpx;
  height: 56rpx;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--surface-soft);
  border: 1rpx solid var(--line);
  transition: background 140ms ease-out;
}

.display-chip:active {
  background: var(--accent-soft);
  transition: none;
}

.row-display {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
}

/* 手动调整过的行用强调色标出来——比再加一个标签省地方，扫一眼就能认出来 */
.display-chip.is-manual .row-display {
  color: var(--accent-deep);
}

.display-chip.is-editing {
  border-color: var(--accent);
  background: var(--surface-strong);
}

.display-input {
  width: 160rpx;
  height: 56rpx;
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
  text-align: center;
}

/* 左右各内收 sp-5：滑块不再顶到卡片边缘。竖着滑页面时手指最容易落在边缘一带，
   滑块抓住竖向手势就会在滚动途中改金额，两头留出死区能少很多误触 */
.row-slider-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  padding: 0 var(--sp-5);
}

.amount-slider {
  flex: 1 1 0;
  min-width: 0;
}

.amount-slider,
.ratio-slider {
  margin: 0;
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  border-radius: var(--r-sm);
  color: var(--text-soft);
  font-size: var(--fs-md);
}

.icon-button.is-danger {
  color: var(--danger-text);
}

.empty-panel {
  padding: var(--sp-7) var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  text-align: center;
}

.empty-title {
  display: block;
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  line-height: 1.2;
}

.empty-sub {
  display: block;
  margin-top: var(--sp-2);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  line-height: 1.45;
}

/* ---------- 底部按钮 ---------- */

/* 用 margin-left 居中而不是 translateX：按下时的 .button-hover 会把 transform
   整个换成 scale，用 transform 居中的按钮一按就跳。
   和首页「记一笔」同一套：白底 + 内描边，按下时品牌色从中心涨满 */
.add-button {
  position: fixed;
  left: 50%;
  bottom: calc(var(--sp-6) + env(safe-area-inset-bottom));
  z-index: var(--z-fab);
  isolation: isolate;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 380rpx;
  height: 92rpx;
  margin-left: -190rpx;
  border-radius: var(--r-pill);
  background: var(--surface-strong);
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
  letter-spacing: -0.01em;
  box-shadow: inset 0 0 0 1rpx var(--line);
  box-shadow: inset 0 0 0 1rpx var(--line), var(--shadow-xs);
  transition: transform 120ms cubic-bezier(0.34, 1.4, 0.64, 1), color 140ms ease-out;
}

.add-button::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 0;
  width: 160%;
  aspect-ratio: 1 / 1;
  transform: translate(-50%, -50%) scale(0.12);
  border-radius: 50%;
  background: linear-gradient(180deg, var(--btn-from), var(--btn-to));
  opacity: 0;
  pointer-events: none;
  transition: transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out;
}

.add-button > text {
  position: relative;
  z-index: 1;
  transition: color 120ms ease-out;
}

.add-button.button-hover {
  color: var(--on-accent);
  transform: scale(0.985);
}

.add-button.button-hover::before {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 60ms linear;
}

/* ---------- 弹层 ---------- */

.modal-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-mask);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--scrim);
  backdrop-filter: blur(14px);
  animation: maskIn 160ms ease-out;
}

@keyframes maskIn {
  from {
    opacity: 0;
  }
}

.sheet {
  width: 100%;
  max-width: 840px;
  max-height: 88vh;
  padding: var(--sp-5) var(--sp-6) calc(var(--sp-6) + env(safe-area-inset-bottom));
  border-radius: var(--r-sheet) var(--r-sheet) 0 0;
  /* 先写不透明兜底再写半透明：color-mix() 不被支持时整条声明会被丢弃而不是退化 */
  background: var(--surface-strong);
  background: color-mix(in srgb, var(--surface-strong) 92%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.5);
  color: var(--text);
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  animation: sheetIn 0.24s ease-out;
}

@keyframes sheetIn {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 出场：原路返回，比进场快、加速离开。退场期间整层不再接受点击 */
.modal-mask.is-closing {
  animation: maskOut 200ms ease-out forwards;
}

.modal-mask.is-closing .sheet {
  animation: sheetOut 200ms cubic-bezier(0.4, 0, 1, 1) forwards;
  pointer-events: none;
}

@keyframes maskOut {
  to {
    opacity: 0;
  }
}

@keyframes sheetOut {
  to {
    transform: translateY(100%);
  }
}

.sheet-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-5);
}

.sheet-title {
  display: block;
  color: var(--text-strong);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heavy);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.sheet-sub {
  display: block;
  margin-top: var(--sp-1);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  line-height: 1.45;
  letter-spacing: 0.01em;
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 68rpx;
  height: 68rpx;
  border-radius: var(--r-md);
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: var(--fs-lg);
}

/* ---------- 类别比例（摊在页面上，不收进弹层） ---------- */

.ratio-block {
  margin-top: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1rpx solid var(--line);
}

.ratio-head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-bottom: var(--sp-2);
}

.ratio-hint {
  color: var(--text-soft);
  font-size: var(--fs-2xs);
  line-height: 1.45;
}

.ratio-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 76rpx;
}

.ratio-name-col {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  width: 240rpx;
}

.ratio-name {
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

/* 「120 → 144」：真实合计 → 展示合计，滑块一拖就跟着变 */
.ratio-sum {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

.ratio-sum-display.is-adjusted {
  color: var(--accent-deep);
  font-weight: var(--fw-bold);
}

.ratio-slider {
  flex: 1 1 0;
  min-width: 0;
}

.ratio-input {
  flex: 0 0 auto;
  width: 96rpx;
  height: 56rpx;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--surface-soft);
  border: 1rpx solid var(--line);
  color: var(--text-strong);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-align: center;
}

.ratio-reset {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 76rpx;
  margin-top: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 1rpx solid var(--line);
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

/* ---------- 表单 ---------- */

.form-block {
  margin-bottom: var(--sp-5);
}

.form-label {
  display: block;
  margin-bottom: var(--sp-3);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--sp-2);
}

.category-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rpx;
  padding: var(--sp-3) var(--sp-1);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 1rpx solid transparent;
  color: var(--text);
}

.category-option.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-deep);
}

.category-option-emoji {
  font-size: var(--fs-md);
}

.category-option-name {
  font-size: var(--fs-2xs);
  letter-spacing: 0.01em;
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-4);
  height: 96rpx;
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 1rpx solid var(--line);
}

.amount-input-wrap.invalid {
  border-color: var(--danger-text);
}

.amount-prefix {
  color: var(--text-soft);
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
}

.amount-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 96rpx;
  color: var(--text-strong);
  font-size: var(--fs-xl);
  font-weight: var(--fw-black);
  letter-spacing: -0.02em;
}

.field-input {
  width: 100%;
  height: 84rpx;
  padding: 0 var(--sp-4);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 1rpx solid var(--line);
  color: var(--text-strong);
  font-size: var(--fs-md);
}

.field-error {
  display: block;
  margin-top: var(--sp-2);
  color: var(--danger-text);
  font-size: var(--fs-sm);
  line-height: 1.45;
}

/* ---------- 时间滚轮 ---------- */

.virtual-wheel {
  width: 100%;
  height: 360rpx;
  border-radius: var(--r-md);
  background: var(--surface-soft);
}

.wheel-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  color: var(--text);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
}

.primary-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 92rpx;
  border-radius: var(--r-md);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  background: linear-gradient(135deg, var(--btn-from), var(--btn-to));
  color: var(--on-accent);
  box-shadow: var(--shadow-xs);
}

.primary-button.disabled {
  box-shadow: none;
  opacity: 0.5;
}

/* 减弱动画：位移全去掉，只留淡入。和 index.vue 末尾那条兜底同一个口径 */
@media (prefers-reduced-motion: reduce) {
  .shell.is-next,
  .shell.is-prev {
    animation: none;
  }

  .modal-mask,
  .sheet,
  .modal-mask.is-closing,
  .modal-mask.is-closing .sheet {
    animation-duration: 1ms;
  }

  .sheet {
    animation-name: fadeIn;
  }

  .modal-mask.is-closing .sheet {
    animation-name: fadeOut;
  }

  .progress-fill {
    transition: none;
  }

  /* 按下扩散的品牌色不做膨胀 */
  .add-button::before {
    transition-duration: 1ms;
  }

  /* 转圈是状态指示，不能减速到看不出在转 */
  .side-spinner {
    animation-duration: 700ms;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
  }

  @keyframes fadeOut {
    to {
      opacity: 0;
    }
  }
}
</style>
