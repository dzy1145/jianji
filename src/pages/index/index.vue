<template>
  <!-- 弹层开着时把整页设成不可滚。这是唯一可靠的锁法：靠 touchmove 的
       preventDefault 挡不住「抽屉自己不用滚」那种情况（滚动链条会直接交给页面），
       而且它在 App 端是否真生效还取决于监听器是不是 passive。page-meta 必须放在根节点第一位 -->
  <page-meta :page-style="pageLockStyle" />
  <view class="page" :class="`theme-${theme}`">
    <view class="shell" :class="monthSlide">
      <view class="topbar" :style="{ paddingTop: `${headerTop}px` }">
        <view class="topbar-left">
          <button
            class="side-toggle"
            :class="{ 'is-switching': switching }"
            aria-label="切到展示账本"
            @click="openDisplayLedger"
          >
            <view class="side-toggle-icon" :class="{ 'is-out': switching }">
              <view class="side-sheet is-back"></view>
              <view class="side-sheet is-front"></view>
            </view>
            <view class="side-spinner" :class="{ 'is-in': switching }"></view>
          </button>
          <view class="date-copy">
            <text class="date-label">{{ todayLabel }}</text>
            <text class="page-title">记账</text>
          </view>
        </view>
        <view class="top-actions">
          <button class="text-action" @click="openImport">导入</button>
          <button class="text-action" @click="openExport">导出</button>
          <button class="round-action" aria-label="打开设置" @click="openSettings">⚙</button>
        </view>
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

      <view class="summary-panel">
        <text class="summary-label">本月总支出</text>
        <view class="summary-amount">
          <text class="summary-currency">¥</text>
          <text class="summary-number">{{ stats.total.toFixed(2) }}</text>
          <text v-if="balanceText" class="summary-balance" :class="balance < 0 ? 'is-over' : 'is-left'">
            {{ balanceText }}
          </text>
        </view>
        <view v-if="monthIncome > 0" class="summary-income">
          <text class="summary-label">本月总收入</text>
          <view class="summary-amount">
            <text class="summary-currency is-income">¥</text>
            <text class="summary-number is-income">{{ monthIncome.toFixed(2) }}</text>
          </view>
        </view>
        <view class="summary-metrics">
          <view class="metric-item">
            <text class="metric-label">笔数</text>
            <text class="metric-value">{{ stats.count }}</text>
          </view>
          <view class="metric-item">
            <text class="metric-label">日均</text>
            <text class="metric-value">{{ stats.dailyAverage.toFixed(2) }}</text>
          </view>
        </view>
      </view>

      <view class="section trend-section">
        <view class="section-heading">
          <text class="section-title">趋势</text>
          <view class="segment">
            <view class="segment-thumb" :style="segmentThumbStyle(trendMode, segmentKeys.trend)"></view>
            <button
              v-for="item in trendModes"
              :key="item.key"
              class="segment-button"
              :class="{ active: trendMode === item.key }"
              @click="setTrendMode(item.key)"
            >
              {{ item.label }}
            </button>
          </view>
        </view>

        <view class="trend-panel">
          <!-- 触摸挂在整块上而不是 canvas 上：圆点和日期标签是画在 canvas 之上的原生元素，
               落在它们身上的手指不会冒泡到 canvas（是兄弟节点，不是父子） -->
          <view
            class="trend-chart-wrap"
            :class="{ 'is-rising': trendRising }"
            :style="{ aspectRatio: `${trendChart.width} / ${trendChart.height}` }"
            @touchstart="onTrendTouch"
            @touchmove="onTrendTouch"
            @touchend="clearTrendTip"
            @touchcancel="clearTrendTip"
          >
            <canvas
              class="trend-chart-svg"
              canvas-id="trendCanvas"
              id="trendCanvas"
              :style="trendClipStyle"
            ></canvas>

            <view
              v-if="trendTip"
              class="trend-tip-guide"
              :style="{
                left: `${trendTip.point.xPercent}%`,
                top: `${trendChart.plotTopPercent}%`,
                height: `${trendChart.plotHeightPercent}%`
              }"
            ></view>

            <view
              v-for="item in trendChart.points"
              v-show="item.showMarker || item.key === trendTipKey"
              :key="`marker-${item.key}`"
              class="trend-point-marker"
              :class="{ active: item.active, 'is-tip': item.key === trendTipKey }"
              :style="{ left: `${item.xPercent}%`, top: `${item.yPercent}%` }"
            ></view>
            <text
              v-for="tick in trendChart.yTicks"
              :key="`ytick-${tick.key}`"
              class="trend-axis-value"
              :style="{ top: `${tick.yPercent}%`, right: `${trendChart.axisRightPercent}%` }"
            >
              {{ tick.label }}
            </text>
            <text
              v-for="item in trendChart.points"
              v-show="item.showLabel"
              :key="`label-${item.key}`"
              class="trend-point-label"
              :class="{ active: item.active }"
              :style="{ left: `${item.xPercent}%`, top: `${item.labelPercent}%` }"
            >
              {{ item.label }}
            </text>

            <!-- 选中点的明细。原生的 view/text 层，和圆点、日期标签一样不使用 SVG -->
            <view v-if="trendTip" class="trend-tip" :style="trendTipStyle">
              <view class="trend-tip-head">
                <text class="trend-tip-date">{{ trendTip.point.fullLabel }}</text>
                <text class="trend-tip-value">¥{{ trendTip.point.value.toFixed(2) }}</text>
              </view>
              <text v-if="trendTip.point.count" class="trend-tip-detail">
                {{ trendTip.point.count }} 笔 · {{ trendTip.point.topEmoji }}{{ trendTip.point.topName }}
                ¥{{ trendTip.point.topAmount.toFixed(2) }}
              </text>
              <text v-else class="trend-tip-detail">这个区间没有支出</text>
            </view>
          </view>
        </view>
      </view>

      <view class="section distribution-section">
        <view class="section-heading">
          <text class="section-title">占比</text>
        </view>

        <view v-if="categoryStats.length" class="distribution-panel">
          <view
            class="pie-chart-wrap"
            :style="{ aspectRatio: `${pieChart.width} / ${pieChart.height}` }"
          >
            <!-- 手势挂在 canvas 上，并且 touchmove 用 .prevent：
                 uni 只对带 .prevent 的监听器注册成「非被动」，手写
                 event.preventDefault() 在被动监听器里是空调用——这就是
                 「旋转的时候页面还能上下拖」一直修不掉的原因。
                 图例行在 canvas 之上、不在这条链上，所以在那儿上下滑仍然滚页面 -->
            <canvas
              class="pie-chart-svg"
              canvas-id="pieCanvas"
              id="pieCanvas"
            ></canvas>

            <!-- 手势命中层：只盖住圆盘，卡片其余地方（含图例行之间）照常原生滚动。
                 挂在 canvas 上的话，canvas 是 inset:0 铺满整张卡片的，整张卡片
                 的竖滑都会被掐掉 -->
            <view
              class="pie-hit"
              :style="pieChart.hit"
              @touchstart="onPieTouchStart"
              @touchmove.prevent="onPieTouchMove"
              @touchend="onPieTouchEnd"
              @touchcancel="onPieTouchEnd"
            ></view>

            <!-- 图例只留三行：中间是当前项、放大，上下两行缩小后退。
                 百分比和金额不再出现在这一列——它们浮在选中那块饼上 -->
            <view
              v-for="item in pieChart.slices"
              :key="`legend-${item.key}`"
              class="pie-legend-row"
              :class="{ 'is-minor': !item.major, 'is-selected': item.selected }"
              :style="{
                top: `${item.legendPercent}%`,
                left: `${item.legendLeft}%`,
                opacity: item.legendOpacity,
                transform: `translateY(-50%) rotate(${item.legendTilt}deg) scale(${item.legendScale})`
              }"
            >
              <view class="pie-legend-dot" :style="{ backgroundColor: item.color }"></view>
              <text class="pie-label-name">{{ item.emoji }} {{ item.name }}</text>
            </view>
          </view>
        </view>

        <view v-else class="empty-panel">
          <text class="empty-title">本月还没有支出</text>
        </view>
      </view>

      <view class="section bill-section">
        <view class="section-heading bill-heading">
          <text class="section-title">{{ selectionMode ? `已选 ${selectedIds.length} 笔` : '明细' }}</text>
          <button v-if="selectionMode" class="text-button" @click="toggleSelectAll">
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <button v-else-if="visibleBills.length" class="text-button" @click="toggleSelection">多选</button>
        </view>

        <view v-if="incomeBills.length || groupedBills.length" class="bill-groups">
          <view v-if="incomeBills.length" class="bill-group">
            <view class="group-heading">
              <text class="group-date">本月收入</text>
              <text class="group-total is-income">+¥{{ monthIncome.toFixed(2) }}</text>
            </view>

            <view
              v-for="item in incomeBills"
              :key="item.id"
              class="bill-item"
              :class="{ selected: isSelected(item.id) }"
              @click="handleBillTap(item)"
              @longpress="enterSelection(item)"
            >
              <view v-if="selectionMode" class="select-dot" :class="{ active: isSelected(item.id) }">✓</view>
              <view class="bill-icon" :style="{ backgroundColor: `${incomeCategory.color}1f`, color: incomeCategory.color }">
                {{ incomeCategory.emoji }}
              </view>
              <view class="bill-main">
                <text class="bill-title">{{ item.note || incomeCategory.name }}</text>
                <text class="bill-meta">收入</text>
              </view>
              <view class="bill-amount-wrap">
                <text class="bill-amount is-income">+{{ item.amount.toFixed(2) }}</text>
                <text v-if="item.is_private" class="refund-tag">私人</text>
              </view>
              <button
                v-if="!selectionMode"
                class="delete-button"
                aria-label="删除这笔收入"
                @click.stop="removeBill(item)"
              >
                ×
              </button>
            </view>
          </view>

          <view v-for="group in groupedBills" :key="group.date" class="bill-group">
            <view class="group-heading">
              <text class="group-date">{{ group.label }}</text>
              <text class="group-total">-¥{{ group.total.toFixed(2) }}</text>
            </view>

            <view
              v-for="item in group.items"
              :key="item.id"
              class="bill-item"
              :class="{ selected: isSelected(item.id) }"
              @click="handleBillTap(item)"
              @longpress="enterSelection(item)"
            >
              <view v-if="selectionMode" class="select-dot" :class="{ active: isSelected(item.id) }">✓</view>
              <view class="bill-icon" :style="{ backgroundColor: `${item.categoryColor}1f`, color: item.categoryColor }">
                {{ item.categoryEmoji }}
              </view>
              <view class="bill-main">
                <text class="bill-title">{{ item.note || item.categoryName }}</text>
                <text class="bill-meta">{{ item.categoryName }} · {{ formatTime(item.timestamp) }}</text>
              </view>
              <view class="bill-amount-wrap">
                <text class="bill-amount" :class="{ refunded: item.refunded }">
                  {{ item.refunded ? '0.00' : '-' + item.amount.toFixed(2) }}
                </text>
                <text v-if="item.refunded" class="refund-tag">已退款</text>
                <text v-if="item.is_private" class="refund-tag">私人</text>
              </view>
              <button
                v-if="!selectionMode"
                class="delete-button"
                aria-label="删除这笔账单"
                @click.stop="removeBill(item)"
              >
                ×
              </button>
            </view>
          </view>
        </view>

        <view v-else class="empty-panel">
          <template v-if="loadError">
            <text class="empty-title">账本读取失败</text>
            <text class="empty-sub">数据还在本机，点下面重试</text>
            <button class="text-button" @click="loadData">重试</button>
          </template>
          <template v-else>
            <text class="empty-title">这个月还没有记录</text>
          </template>
        </view>
      </view>
    </view>

    <view v-if="selectionMode" class="batch-bar">
      <button class="batch-secondary" @click="exitSelection">取消</button>
      <text class="batch-count">已选 {{ selectedIds.length }} 笔</text>
      <button class="batch-danger" :class="{ disabled: !selectedIds.length }" @click="deleteSelected">删除选中</button>
    </view>

    <button v-else class="add-button" @click="openCreate">
      <text class="add-plus">＋</text>
      <text>记一笔</text>
    </button>

    <view
      v-if="editorVisible"
      class="modal-mask"
      :class="{ 'is-closing': closingSheet === 'editor', 'is-stacked': datePickerVisible, 'is-dragging': dragTarget === 'editor' }"
      @click="closeEditor"
      @touchmove.stop.prevent
    >
      <view
        class="sheet editor-sheet"
        :ref="(el) => setSheetEl('editor', el)"
        :style="sheetDragStyle('editor')"
        @click.stop
        @touchmove.stop
      >
        <view
          class="sheet-handle"
          @touchstart.stop="sheetDragStart('editor', $event)"
          @touchmove.stop.prevent="sheetDragMove"
          @touchend.stop="sheetDragEnd"
          @touchcancel.stop="sheetDragEnd"
        ></view>
        <view class="sheet-heading">
          <view>
            <text class="sheet-title">{{ editingId ? '修改账单' : '记一笔' }}</text>
            <text class="sheet-sub">
              {{ editingId ? '保存后会同步更新统计' : form.type === 'income' ? '记录本月的一笔收入' : '记录今天的花销' }}
            </text>
          </view>
          <button class="sheet-close" aria-label="关闭" @click="closeEditor">×</button>
        </view>

        <view class="segment wide editor-segment">
          <view class="segment-thumb" :style="segmentThumbStyle(form.type, segmentKeys.type)"></view>
          <button
            v-for="item in billTypes"
            :key="item.key"
            class="segment-button"
            :class="{ active: form.type === item.key }"
            @click="setFormType(item.key)"
          >
            {{ item.label }}
          </button>
        </view>

        <view v-if="form.type === 'expense'" class="form-block">
          <text class="form-label">类别</text>
          <view class="category-grid">
            <button
              v-for="item in categories"
              :key="item.key"
              class="category-option"
              :class="{ active: form.category === item.key }"
              @click="selectCategory(item.key)"
            >
              <text class="category-option-emoji">{{ item.emoji }}</text>
              <text class="category-option-name">{{ item.name }}</text>
            </button>
          </view>
        </view>

        <view class="form-block">
          <text class="form-label">金额</text>
          <view class="amount-input-wrap" :class="{ focused: amountFocused, invalid: amountError }">
            <text class="amount-prefix">¥</text>
            <input
              v-model="form.amount"
              class="amount-input"
              type="digit"
              placeholder="0.00"
              :focus="amountFocused"
              confirm-type="done"
              @focus="amountFocused = true"
              @blur="amountFocused = false"
              @confirm="submitEditor"
            />
          </view>
          <text v-if="amountError" class="field-error">{{ amountError }}</text>
        </view>

        <view class="form-row">
          <view class="date-block">
            <text class="form-label">{{ form.type === 'income' ? '月份' : '日期' }}</text>
            <view class="date-chip" @click="openDatePicker">
              <text class="date-chip-text">{{ form.type === 'income' ? form.month : form.date }}</text>
              <text class="date-chip-caret">▾</text>
            </view>
          </view>
          <view v-if="editingId && form.type === 'expense'" class="form-block refund-block">
            <text class="form-label">已退款</text>
            <view class="refund-toggle">
              <text class="refund-hint">不计入支出</text>
              <switch :checked="form.refunded" :color="switchOnColor" @change="onRefundChange" />
            </view>
          </view>
        </view>

        <view v-if="!hidePrivate" class="form-block">
          <text class="form-label">私人</text>
          <view class="refund-toggle">
            <text class="refund-hint">计入统计，但不导出</text>
            <switch :checked="form.is_private" :color="switchOnColor" @change="onPrivateChange" />
          </view>
        </view>

        <view class="form-block">
          <text class="form-label">备注</text>
          <input
            v-model="form.note"
            class="field-input note-input"
            maxlength="30"
            :placeholder="form.type === 'income' ? '工资、报销等' : '午饭、奶茶等'"
            @input="onNoteInput"
          />
        </view>

        <button
          class="primary-button"
          :class="{ disabled: !formValid, 'is-done': saveDone }"
          @click="submitEditor"
        >
          <text v-if="saveDone" class="save-check">✓</text>
          {{ saveDone ? '已保存' : editingId ? '保存修改' : form.type === 'income' ? '保存收入' : '保存账单' }}
        </button>
      </view>
    </view>

    <view
      v-if="datePickerVisible"
      class="modal-mask date-mask"
      :class="{ 'is-closing': closingSheet === 'date', 'is-dragging': dragTarget === 'date' }"
      @click="closeDatePicker"
      @touchmove.stop.prevent
    >
      <view
        class="sheet date-sheet"
        :ref="(el) => setSheetEl('date', el)"
        :style="sheetDragStyle('date')"
        @click.stop
        @touchmove.stop
      >
        <!-- 日期弹层原来没有把手，加上：它现在是能往下拖关闭的，得有个抓得住的提示 -->
        <view
          class="sheet-handle"
          @touchstart.stop="sheetDragStart('date', $event)"
          @touchmove.stop.prevent="sheetDragMove"
          @touchend.stop="sheetDragEnd"
          @touchcancel.stop="sheetDragEnd"
        ></view>
        <view class="date-sheet-head">
          <text class="date-sheet-action" @click="closeDatePicker">取消</text>
          <text class="date-sheet-title">{{ form.type === 'income' ? '选择月份' : '选择日期' }}</text>
          <text class="date-sheet-action is-strong" @click="confirmDatePicker">确定</text>
        </view>
        <picker-view
          class="date-wheel"
          :value="datePickerIndexes"
          :indicator-style="dateIndicatorStyle"
          @change="onDateWheelChange"
        >
          <picker-view-column>
            <view v-for="item in dateYearOptions" :key="`y-${item}`" class="wheel-item">{{ item }}年</view>
          </picker-view-column>
          <picker-view-column>
            <view v-for="item in dateMonthOptions" :key="`m-${item}`" class="wheel-item">{{ item }}月</view>
          </picker-view-column>
          <picker-view-column v-if="form.type !== 'income'">
            <view v-for="item in dateDayOptions" :key="`d-${item}`" class="wheel-item">{{ item }}日</view>
          </picker-view-column>
        </picker-view>
      </view>
    </view>

    <view
      v-if="exportVisible"
      class="modal-mask"
      :class="{ 'is-closing': closingSheet === 'export', 'is-dragging': dragTarget === 'export' }"
      @click="closeExport"
      @touchmove.stop.prevent
    >
      <view
        class="sheet export-sheet"
        :ref="(el) => setSheetEl('export', el)"
        :style="sheetDragStyle('export')"
        @click.stop
        @touchmove.stop
      >
        <view
          class="sheet-handle"
          @touchstart.stop="sheetDragStart('export', $event)"
          @touchmove.stop.prevent="sheetDragMove"
          @touchend.stop="sheetDragEnd"
          @touchcancel.stop="sheetDragEnd"
        ></view>
        <view class="sheet-heading">
          <view>
            <text class="sheet-title">导出账单</text>
            <text class="sheet-sub">复制为可编辑的纯文本</text>
          </view>
          <button class="sheet-close" aria-label="关闭" @click="closeExport">×</button>
        </view>

        <scroll-view scroll-y class="export-scroll">
          <view class="config-group">
            <text class="form-label">范围</text>
            <view class="segment wide">
              <view class="segment-thumb" :style="segmentThumbStyle(exportConfig.scope, segmentKeys.scope)"></view>
              <button
                v-for="item in exportScopes"
                :key="item.key"
                class="segment-button"
                :class="{ active: exportConfig.scope === item.key }"
                @click="setExportValue('scope', item.key)"
              >
                {{ item.label }}
              </button>
            </view>
            <picker
              v-if="exportConfig.scope === 'pickMonth'"
              mode="date"
              fields="month"
              :value="exportConfig.scopeMonth"
              :end="today.slice(0, 7)"
              @change="onExportMonthChange"
            >
              <view class="picker-field export-picker">{{ exportConfig.scopeMonth }}</view>
            </picker>
            <picker
              v-if="exportConfig.scope === 'day'"
              mode="date"
              :value="exportConfig.scopeDate"
              :end="today"
              @change="onExportDateChange"
            >
              <view class="picker-field export-picker">{{ exportConfig.scopeDate }}</view>
            </picker>
          </view>

          <view class="config-group">
            <text class="form-label">明细字段</text>
            <view class="pill-list">
              <button
                v-for="item in exportFields"
                :key="item.key"
                class="config-pill"
                :class="{ active: exportConfig[item.key] }"
                @click="toggleExportValue(item.key)"
              >
                {{ item.label }}
              </button>
            </view>
          </view>

          <view v-if="exportConfig.time" class="config-group">
            <text class="form-label">时间格式</text>
            <view class="segment wide">
              <view class="segment-thumb" :style="segmentThumbStyle(exportConfig.timeMode, segmentKeys.timeMode)"></view>
              <button
                v-for="item in timeModes"
                :key="item.key"
                class="segment-button"
                :class="{ active: exportConfig.timeMode === item.key }"
                @click="setExportValue('timeMode', item.key)"
              >
                {{ item.label }}
              </button>
            </view>
          </view>

          <view class="config-group">
            <text class="form-label">连接符</text>
            <view class="segment wide">
              <view class="segment-thumb" :style="segmentThumbStyle(exportConfig.sep, segmentKeys.sep)"></view>
              <button
                v-for="item in separators"
                :key="item.key"
                class="segment-button"
                :class="{ active: exportConfig.sep === item.key }"
                @click="setExportValue('sep', item.key)"
              >
                {{ item.label }}
              </button>
            </view>
          </view>

          <view class="config-group">
            <text class="form-label">汇总内容</text>
            <view class="pill-list">
              <button class="config-pill" :class="{ active: exportConfig.emoji }" @click="toggleExportValue('emoji')">
                分类 Emoji
              </button>
              <button class="config-pill" :class="{ active: exportConfig.summary }" @click="toggleExportValue('summary')">
                标题与总额
              </button>
              <button
                class="config-pill"
                :class="{ active: exportConfig.categoryStats }"
                @click="toggleExportValue('categoryStats')"
              >
                分类占比
              </button>
            </view>
          </view>
        </scroll-view>

        <button class="primary-button" :class="{ disabled: exporting }" @click="confirmExport">
          <view v-if="exporting" class="spinner"></view>
          {{ exporting ? '复制中…' : '复制账单文本' }}
        </button>
      </view>
    </view>

    <view
      v-if="settingsVisible"
      class="modal-mask"
      :class="{ 'is-closing': closingSheet === 'settings', 'is-dragging': dragTarget === 'settings' }"
      @click="closeSettings"
      @touchmove.stop.prevent
    >
      <view
        class="sheet settings-sheet"
        :ref="(el) => setSheetEl('settings', el)"
        :style="sheetDragStyle('settings')"
        @click.stop
        @touchmove.stop
      >
        <view
          class="sheet-handle"
          @touchstart.stop="sheetDragStart('settings', $event)"
          @touchmove.stop.prevent="sheetDragMove"
          @touchend.stop="sheetDragEnd"
          @touchcancel.stop="sheetDragEnd"
        ></view>
        <view class="sheet-heading">
          <view>
            <text class="sheet-title">设置</text>
            <text class="sheet-sub">主题与数据迁移</text>
          </view>
          <button class="sheet-close" aria-label="关闭" @click="closeSettings">×</button>
        </view>

        <view class="settings-card">
          <text class="form-label">页面主题</text>
          <view class="theme-list">
            <button
              v-for="item in themeOptions"
              :key="item.key"
              class="theme-option"
              :class="{ active: theme === item.key }"
              @click="selectTheme(item.key)"
            >
              <view class="theme-swatch" :style="{ background: item.preview }"></view>
              <text>{{ item.label }}</text>
            </button>
          </view>
        </view>

        <view class="settings-card">
          <text class="form-label">私人账目</text>
          <view class="refund-toggle">
            <text class="refund-hint">隐藏私人账目：不显示，也不计入统计</text>
            <switch :checked="hidePrivate" :color="switchOnColor" @change="selectHidePrivate" />
          </view>
        </view>

        <view class="settings-card">
          <text class="form-label">趋势图显示数量</text>
          <view v-for="item in trendCountLimits" :key="item.key" class="count-row">
            <text class="count-label">{{ item.label }}</text>
            <slider
              class="count-slider"
              :min="item.min"
              :max="item.max"
              :step="1"
              :value="trendCounts[item.key]"
              :active-color="chartPalette.accent"
              :background-color="chartPalette.grid"
              :block-color="chartPalette.deep"
              :block-size="18"
              @change="onTrendCountChange(item.key, $event)"
            />
            <text class="count-value">{{ trendCounts[item.key] }}{{ item.unit }}</text>
          </view>
        </view>

        <view class="settings-actions">
          <button class="secondary-button accent" @click="openExport">导出账单</button>
          <button class="secondary-button" @click="openImport">导入小程序账单</button>
        </view>
      </view>
    </view>

    <view
      v-if="importVisible"
      class="modal-mask"
      :class="{ 'is-closing': closingSheet === 'import', 'is-dragging': dragTarget === 'import' }"
      @click="closeImport"
      @touchmove.stop.prevent
    >
      <view
        class="sheet import-sheet"
        :ref="(el) => setSheetEl('import', el)"
        :style="sheetDragStyle('import')"
        @click.stop
        @touchmove.stop
      >
        <view
          class="sheet-handle"
          @touchstart.stop="sheetDragStart('import', $event)"
          @touchmove.stop.prevent="sheetDragMove"
          @touchend.stop="sheetDragEnd"
          @touchcancel.stop="sheetDragEnd"
        ></view>
        <view class="sheet-heading">
          <view>
            <text class="sheet-title">导入账单</text>
            <text class="sheet-sub">支持小程序导出的文本格式</text>
          </view>
          <button class="sheet-close" aria-label="关闭" @click="closeImport">×</button>
        </view>

        <textarea
          v-model="importText"
          class="import-textarea"
          maxlength="-1"
          placeholder="在小程序里点击“复制账单”，再粘贴到这里"
        />

        <view class="import-hint">
          <text>自动识别日期、分类、金额、备注和退款状态，重复账单会跳过；同一时间改动过的账单会覆盖更新。</text>
        </view>

        <view class="import-actions">
          <button class="secondary-button" @click="readClipboard">读取剪贴板</button>
          <button
            class="primary-button compact"
            :class="{ disabled: !importText.trim() || importBusy }"
            @click="confirmImport"
          >
            <view v-if="importBusy" class="spinner"></view>
            {{ importBusy ? '导入中…' : '开始导入' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { onReady, onShow } from '@dcloudio/uni-app'
import {
  CATEGORIES,
  DEFAULT_EXPORT_CONFIG,
  addBill,
  buildExportText,
  deleteBill,
  deleteBills,
  filterVisibleBills,
  getAutoNote,
  getCategoryStats,
  getIncomeTotal,
  getMonthStats,
  importBills,
  INCOME_CATEGORY,
  initLedger,
  isExpense,
  isIncome,
  listBills,
  parseMiniProgramBillText,
  round2,
  updateBill
} from '../../services/ledger'

const trendModes = [
  { key: 'year', label: '年' },
  { key: 'month', label: '月' },
  { key: 'day', label: '日' }
]
const billTypes = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' }
]
const exportScopes = [
  { key: 'month', label: '当前月' },
  { key: 'pickMonth', label: '指定月' },
  { key: 'day', label: '指定日' }
]
const exportFields = [
  { key: 'time', label: '时间' },
  { key: 'category', label: '分类' },
  { key: 'amount', label: '金额' },
  { key: 'note', label: '备注' }
]
const timeModes = [
  { key: 'full', label: '日期+时间' },
  { key: 'date', label: '只日期' },
  { key: 'time', label: '只时间' }
]
const separators = [
  { key: 'space', label: '空格' },
  { key: 'comma', label: '逗号' },
  { key: 'pipe', label: '竖线' }
]
const themeOptions = [
  { key: 'sakura', label: '樱花', switchOn: '#cf3b61', preview: 'linear-gradient(135deg,#f8b4c5,#f3d4a5)' },
  { key: 'mint', label: '薄荷', switchOn: '#2e816c', preview: 'linear-gradient(135deg,#8fd8c4,#a9cdf1)' },
  { key: 'amber', label: '琥珀', switchOn: '#a36621', preview: 'linear-gradient(135deg,#e9a967,#f2ce86)' },
  { key: 'night', label: '夜间', switchOn: '#b4557a', preview: 'linear-gradient(135deg,#3e4054,#8f7186)' }
]
const switchOnColor = computed(
  () => (themeOptions.find((item) => item.key === theme.value) || themeOptions[0]).switchOn
)
// 与 CSS 令牌一一对应：--accent / --accent-deep。改色板时两边要同时改
const chartPalettes = {
  sakura: { accent: '#dc6f8b', deep: '#ad4864', grid: 'rgba(98, 67, 79, 0.12)' },
  mint: { accent: '#3eaf92', deep: '#207a65', grid: 'rgba(44, 107, 88, 0.12)' },
  amber: { accent: '#d99342', deep: '#975e1c', grid: 'rgba(120, 84, 41, 0.12)' },
  night: { accent: '#df8eaa', deep: '#f3b4c8', grid: 'rgba(255, 255, 255, 0.11)' }
}

const categories = CATEGORIES
const incomeCategory = INCOME_CATEGORY

// 趋势图各档显示多少个点，可在设置里调
const trendCountLimits = [
  { key: 'year', label: '年', min: 3, max: 10, unit: ' 年' },
  { key: 'month', label: '月', min: 3, max: 18, unit: ' 个月' },
  { key: 'day', label: '日', min: 3, max: 30, unit: ' 天' }
]
const DEFAULT_TREND_COUNTS = { year: 5, month: 6, day: 7 }

function clampTrendCount(key, value) {
  const limit = trendCountLimits.find((item) => item.key === key)
  if (!limit) return DEFAULT_TREND_COUNTS[key] || 7
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return DEFAULT_TREND_COUNTS[key] || limit.min
  return Math.min(Math.max(number, limit.min), limit.max)
}

const savedTrendCounts = uni.getStorageSync('jianji_trend_counts') || {}
// 滑块用图表的强调色，和折线保持一致
const chartPalette = computed(() => chartPalettes[theme.value] || chartPalettes.sakura)
const trendCounts = reactive({
  year: clampTrendCount('year', savedTrendCounts.year ?? DEFAULT_TREND_COUNTS.year),
  month: clampTrendCount('month', savedTrendCounts.month ?? DEFAULT_TREND_COUNTS.month),
  day: clampTrendCount('day', savedTrendCounts.day ?? DEFAULT_TREND_COUNTS.day)
})
const allBills = ref([])
const bills = ref([])
const trendMode = ref('day')
const currentMonth = ref(getToday().slice(0, 7))
const theme = ref(uni.getStorageSync('jianji_theme') || 'sakura')
const hidePrivate = ref(Boolean(uni.getStorageSync('jianji_hide_private')))
const editorVisible = ref(false)
const exportVisible = ref(false)
const exporting = ref(false)
const settingsVisible = ref(false)
const importVisible = ref(false)
const importText = ref('')
const importBusy = ref(false)
const selectionMode = ref(false)
const selectedIds = ref([])
// 正在切到展示账本：按钮里的图标换成转圈
const switching = ref(false)
const loadError = ref(false)
// 备注是否被用户手动改过。改过之后，切分类 / 切收支类型都不再自动覆盖它
const noteTouched = ref(false)
const editingId = ref(null)
const amountFocused = ref(false)
const saving = ref(false)
// 保存成功的确认态：按钮原地变 ✓ 已保存，停半秒再关抽屉
const saveDone = ref(false)
const trendRising = ref(false)
const monthSlide = ref('')

// 分段选择器的高亮块：宽度按段数等分、位移按当前段索引，切换时靠 CSS 过渡滑过去。
// 段与段之间的 gap 必须是 0，否则等分算不准（按钮没有底色，去 gap 看不出差别）。
const segmentKeys = {
  trend: trendModes.map((item) => item.key),
  scope: exportScopes.map((item) => item.key),
  timeMode: timeModes.map((item) => item.key),
  sep: separators.map((item) => item.key),
  type: billTypes.map((item) => item.key)
}

function segmentThumbStyle(activeKey, keys) {
  const index = Math.max(0, keys.indexOf(activeKey))
  return `width: calc((100% - 8rpx) / ${keys.length}); transform: translateX(${index * 100}%)`
}
const exportConfig = reactive({
  ...DEFAULT_EXPORT_CONFIG,
  ...(uni.getStorageSync('jianji_export_config') || {})
})

const form = reactive({
  type: 'expense',
  amount: '',
  category: 'food',
  note: '',
  date: getToday(),
  month: getToday().slice(0, 7),
  refunded: false,
  is_private: false
})

// 口径：私人账目**默认计入统计**，只是不导出（导出那边固定按 hidePrivate=true 过滤）。
// 只有设置里的「隐藏私人账目」打开时才完全消失：不显示、不计统计、不导出。
// 所以「统计」和「可见」是同一套口径，全部跟 hidePrivate 走。
const visibleBills = computed(() => filterVisibleBills(bills.value, hidePrivate.value))
const visibleAllBills = computed(() => filterVisibleBills(allBills.value, hidePrivate.value))
const expenseBills = computed(() => visibleBills.value.filter(isExpense))
const incomeBills = computed(() => visibleBills.value.filter(isIncome))
const statAllExpenses = computed(() => visibleAllBills.value.filter(isExpense))
const monthIncome = computed(() => getIncomeTotal(visibleBills.value, currentMonth.value))
const categoryStats = computed(() => getCategoryStats(expenseBills.value))

const systemInfo = uni.getSystemInfoSync()
const headerTop = ref((systemInfo.safeAreaInsets && systemInfo.safeAreaInsets.top) || systemInfo.statusBarHeight || 12)
// today 必须是响应式的：页面实例在整个 App 会话里一直存在，跨天唤起时若不重算，
// 「导出指定日」上限、编辑日期的年份/月份滚轮、翻月上限、月份标签会全卡在昨天。
// onShow 里刷新它（见下方 onShow 注册），派生量一律走 computed。
const today = ref(getToday())
const todayYear = computed(() => Number(today.value.slice(0, 4)))
const todayMonth = computed(() => Number(today.value.slice(5, 7)))

const datePickerVisible = ref(false)
const datePickerIndexes = ref([5, 0, 0])
// 日期上限是「下个月月底」：这个月 30 号收到爸妈下个月的生活费，得能记成下个月的账。
// 12 月时上限落在明年 1 月，所以年份滚轮也要能往后多一格
const dateLimit = computed(() => {
  const next = new Date(todayYear.value, todayMonth.value, 1)
  return { year: next.getFullYear(), month: next.getMonth() + 1 }
})
const dateYearOptions = computed(() => {
  const years = []
  for (let year = todayYear.value - 5; year <= dateLimit.value.year; year += 1) years.push(year)
  return years
})
const dateMonthOptions = computed(() =>
  Array.from({ length: lastMonthOf(dateYearOptions.value[datePickerIndexes.value[0]]) }, (unused, index) => index + 1)
)
const dateDayOptions = computed(() =>
  Array.from(
    {
      length: lastDayOf(
        dateYearOptions.value[datePickerIndexes.value[0]],
        dateMonthOptions.value[datePickerIndexes.value[1]]
      )
    },
    (unused, index) => index + 1
  )
)
const dateIndicatorStyle = computed(() => `height: ${uni.upx2px(88)}px;`)
const isCurrentMonth = computed(() => currentMonth.value === today.value.slice(0, 7))
const monthTitle = computed(() => {
  const [year, month] = currentMonth.value.split('-')
  return `${year}年${Number(month)}月`
})
// 翻月的上限和日期滚轮一致：下个月。库里真有更远月份的账单（导入进来的）时也放行，
// 否则那些账目在界面上根本翻不到
const nextMonthText = computed(() => shiftMonth(today.value.slice(0, 7), 1))
const canGoNext = computed(() => {
  const next = shiftMonth(currentMonth.value, 1)
  if (next <= nextMonthText.value) return true
  return allBills.value.some((item) => item.month === next)
})
const monthSubLabel = computed(() => {
  if (isCurrentMonth.value) return '本月'
  return currentMonth.value > today.value.slice(0, 7) ? '下月' : '历史'
})
const todayLabel = computed(() => {
  // 从 today 推，不能在里面 new Date()：这个 computed 没有任何响应式依赖，
  // 只会在首次求值时算一次，跨天不会更新
  const [year, month, day] = today.value.split('-').map(Number)
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${month}月${day}日 ${weekDays[new Date(year, month - 1, day).getDay()]}`
})
const stats = computed(() => getMonthStats(expenseBills.value, currentMonth.value))
// 超支/剩余 = 本月总收入 − 本月总支出；没记收入时整条不显示（见模板）
const balance = computed(() => round2(monthIncome.value - stats.value.total))
// 折线起伏的支点落在 x 轴那条线上，不是画布底边。收起那一态必须也是 inset()，
// 否则展开时是从 none 跳到 inset，浏览器没法插值，会变成硬切。
const trendClipStyle = computed(() => {
  const base = (trendChart.value.bottom / trendChart.value.height) * 100
  return {
    clipPath: trendRising.value ? `inset(${base}% 0 ${100 - base}% 0)` : 'inset(0% 0 0% 0)'
  }
})
const balanceText = computed(() => {
  if (monthIncome.value <= 0) return ''
  return balance.value < 0
    ? `超支 ${Math.abs(balance.value).toFixed(2)} 元`
    : `剩余 ${balance.value.toFixed(2)} 元`
})
// 空着不算错（还没开始填），填错就要说明原因，不能只把按钮变灰
const amountError = computed(() => {
  const raw = String(form.amount).trim()
  if (!raw) return ''
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return '只能填数字，最多两位小数'
  if (Number(raw) <= 0) return '金额要大于 0'
  return ''
})
const formValid = computed(() => !amountError.value && Boolean(String(form.amount).trim()))
const allSelected = computed(
  () => visibleBills.value.length > 0 && selectedIds.value.length === visibleBills.value.length
)

// ===== 饼图：一块真的躺在卡片上的 3D 圆盘 =====

// 视角压扁系数：1 是正上方看下来的正圆，0 是侧面看到的一条线。
// 饼是「摊在桌面上」的，压得越扁越像躺着的圆盘
const PIE_FLATTEN = 0.5
// 柱体厚度（屏幕像素）。薄了像描边，厚了就是一块蛋糕
const PIE_THICKNESS = 14
// 裂缝是「锯口」，按屏幕像素算，不是按角度：同一个锯口，细扇区被吃掉的
// 比例更大，所以角度缝隙必须换算，否则 3% 的小块会被削掉三成。
// 1.2–2.4px 是装了十来个分类之后还能看成一个整饼的上限：再宽，五六个细块
// 挨在一起时，每块的侧壁和剖面会在下沿排成一排手指
const PIE_KERF_MIN = 1.2
const PIE_KERF_MAX = 2.4
// 接地阴影的错位量（屏幕像素）
const PIE_CONTACT = 6
// 选中块沿径向外移 + 抬起（抬起是屏幕上移，露出剖面和底面）
const PIE_POP = 12
const PIE_LIFT = 7
// 每块自己的高度偏移：饼不是一块整板切的，切下来的每一块都不在同一个平面
const PIE_TILT = 3.5
// 半径 92 / 圆心 73 / 非选中 0.68R / 选中 1.34R / 外移 12
// 这两条边是被联立钉死的：
//   左边缘 = 73 - 0.68*92 = 10.4（原来 13.2）
//   选中块右边缘 = 73 + 1.34*92 + 12 = 208.3（原来 209.2）
// 圆心能往左挪多少，完全由「非选中缩多小」决定——idle + focus 的和被
// 两条边的距离固定住（约 2.02），idle 越小圆心越靠左，选中块也随之越长。
// 试过 idle 0.55 / focus 1.47，圆心能挪到 62，但选中那块会变成一根长条
const PIE_RADIUS = 92
const PIE_CX = 73
// 10% 以上的算大块，转到 3 点方向时块面上写字；太小的块塞不下字，只在图例里给数
const PIE_MAJOR_MIN = 10
// 图例每格的高度百分比
const PIE_LEGEND_STEP = 34
// 图例列的基准左边距（占画布宽度的百分比）、圆弧往右让开的像素、倾斜系数
const PIE_LEGEND_LEFT = 72
const PIE_LEGEND_BULGE = 6
const PIE_LEGEND_TILT = 0.28
// 选中块右侧「占比 / 金额」的字号（直接是画布像素，不乘 scale，方便调）
const PIE_LABEL_SIZE = 30
const PIE_LABEL_SIZE_SUB = 25
// 上下两行往右退的像素（配合缩放，读起来像退到后面）
const PIE_LEGEND_DEPTH = 9
// 图例中间那行比上下两行放大多少
const PIE_LEGEND_FOCUS_SCALE = 1.34

// 稳定的伪随机（同一个 index 永远得到同一个数），用来做「不均匀」：
// 每块的裂缝宽度、抬起高度都不一样，但每次重绘不能抖
function pieJitter(index, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

// 饼图整体旋转角度（度）。手指拖它，松手吸附到最近的块心
const pieRotation = ref(0)

// 把一个旋转角度算成一组扇区。吸附时也要用同一套几何，所以单独拆出来，
// 得能接受「还没提交到响应式」的角度
function buildPieSlices(rotation) {
  let cursor = -90
  return categoryStats.value.map((item) => {
    const percent = Number(item.percent) || 0
    const sweep = Math.max(0, Math.min(360, percent * 3.6))
    // cursor 一直累加「未旋转」的基准角，rotation 只加到起点上。
    // 之前把 rotation 从累加里减掉，后面的扇区起点全错位、挤成一团
    const startAngle = cursor + rotation
    cursor += sweep
    const midAngle = startAngle + sweep / 2
    // 归一到 (-180, 180]：0° 就是 3 点方向，也就是「选中位」
    const normalized = ((((midAngle + 180) % 360) + 360) % 360) - 180
    return {
      ...item,
      percent,
      sweep,
      startAngle,
      endAngle: startAngle + sweep,
      midAngle,
      normalized,
      major: percent >= PIE_MAJOR_MIN,
      selected: false,
      legendPercent: 50,
      legendOpacity: 0
    }
  })
}

const pieChart = computed(() => {
  const width = 360
  const slices = buildPieSlices(pieRotation.value)
  const height = Math.max(172, Math.min(210, slices.length * 15 + 44))
  const count = slices.length || 1

  // 3 点方向（0°）压在哪块上，那块就是选中项。
  // anchorFrac 是 0° 在这块里的位置（0 = 起点，1 = 终点），图例靠它连续滚动
  let anchorIndex = -1
  let anchorFrac = 0.5
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index]
    if (slice.sweep <= 0) continue
    const into = (((-slice.startAngle) % 360) + 360) % 360
    if (into <= slice.sweep) {
      anchorIndex = index
      anchorFrac = Math.min(1, into / slice.sweep)
      break
    }
  }
  // 正卡在两条裂缝之间：没有块真的盖住 0°，取离得最近的那块当锚，
  // 别让整列在拖动过程中跳一格
  if (anchorIndex < 0) {
    anchorIndex = 0
    slices.forEach((slice, index) => {
      if (Math.abs(slice.normalized) < Math.abs(slices[anchorIndex].normalized)) anchorIndex = index
    })
    anchorFrac = 0.5
  }

  // 行坐标：3 点线上那块落在 50%，其余按序号上下铺开。
  // 用环形距离绕回，转满一圈时整列是无缝循环的
  const anchor = anchorIndex + anchorFrac - 0.5
  const centerY = (height - PIE_THICKNESS) / 2
  slices.forEach((slice, index) => {
    let distance = (((index - anchor + count / 2) % count) + count) % count
    distance -= count / 2
    const percent = 50 + distance * PIE_LEGEND_STEP
    slice.selected = index === anchorIndex
    slice.legendPercent = percent
    // 场上只留三行：中间是当前项（原大），上下两行缩小、往右退、越远越淡，
    // 再远的直接不显示——一排十几行读不过来，转盘只需要「上一格 / 这一格 / 下一格」
    const distanceAbs = Math.abs(distance)
    slice.legendScale = Math.max(0.62, 0.86 - distanceAbs * 0.1)
    if (distanceAbs < 0.5) slice.legendScale = PIE_LEGEND_FOCUS_SCALE
    slice.legendOpacity = Math.max(0, Math.min(1, 1.45 - distanceAbs * 1.1))
    // 整列绕着右上方一个很远的圆心排开：中点最靠近饼，上下两端往右让开，
    // 看起来就像文字贴着饼的外沿铺开（圆心在右侧，弧口朝左）
    const dy = (percent / 100) * height - centerY
    const norm = Math.min(1, Math.abs(dy) / (height * 0.45))
    slice.legendLeft = PIE_LEGEND_LEFT + (PIE_LEGEND_BULGE * norm * norm) / width * 100

        // 每一行按它在圆盘平面上的角度倾斜（纵向距离除以压扁系数换算），
        // 上端翘、下端压，中点水平——和饼的椭圆是同一种投影
        const dxPx = (PIE_LEGEND_LEFT / 100) * width - PIE_CX
        const phi = (Math.atan2(dy / PIE_FLATTEN, dxPx) * 180) / Math.PI
        slice.legendTilt = -phi * PIE_LEGEND_TILT
        // 上下两行往右退一点，配合缩放读起来像退到后面
        slice.legendLeft += (Math.min(1, distanceAbs) * PIE_LEGEND_DEPTH) / width * 100
  })

  return {
    width,
    height,
    cx: PIE_CX,
    cy: (height - PIE_THICKNESS) / 2,
    radius: PIE_RADIUS,
    depth: PIE_THICKNESS,
    // 手势命中层只盖住圆盘本身（外弹和抬起都算上）。canvas 是铺满整张卡片的，
    // 手势挂在它身上的话，图例行之间的空隙也全成了滚动死区——整张卡片竖滑不动
    hit: {
      left: `${((PIE_CX - PIE_RADIUS - 2) / width) * 100}%`,
      top: `${(((height - PIE_THICKNESS) / 2 - PIE_RADIUS * PIE_FLATTEN - PIE_LIFT - 2) / height) * 100}%`,
      width: `${((PIE_RADIUS * 2 + PIE_POP + 4) / width) * 100}%`,
      height: `${((PIE_RADIUS * PIE_FLATTEN * 2 + PIE_THICKNESS + PIE_LIFT + 4) / height) * 100}%`
    },
    slices
  }
})

// 数据一变（翻月 / 记账），把最大的那块转到 3 点方向的选中位
watch(
  () => categoryStats.value.map((item) => `${item.key}:${item.percent}`).join('|'),
  () => {
    const stats = categoryStats.value
    if (!stats.length) return
    let cursor = -90
    let bestStart = -90
    let bestSweep = 0
    let bestPercent = -1
    stats.forEach((item) => {
      const sweep = Math.max(0, Math.min(360, (Number(item.percent) || 0) * 3.6))
      if ((Number(item.percent) || 0) > bestPercent) {
        bestPercent = Number(item.percent) || 0
        bestStart = cursor
        bestSweep = sweep
      }
      cursor += sweep
    })
    pieRotation.value = -(bestStart + bestSweep / 2)
  },
  { immediate: true }
)

// 只收支出（收入没有具体日期，进不了日期分组）；小计跟统计同口径，私人账目也算进去。
const groupedBills = computed(() => {
  const groupMap = {}
  expenseBills.value.forEach((item) => {
    if (!groupMap[item.date]) {
      groupMap[item.date] = {
        date: item.date,
        label: formatDateLabel(item.date),
        total: 0,
        items: []
      }
    }
    groupMap[item.date].items.push(item)
    if (!item.refunded) {
      groupMap[item.date].total = round2(groupMap[item.date].total + item.amount)
    }
  })
  // 按日期倒序排，而不是跟着「哪笔时间戳最新」——否则补记一笔旧日期的账，
  // 那一天的分组会莫名其妙跳到列表最上面
  return Object.values(groupMap).sort((a, b) => (a.date < b.date ? 1 : -1))
})

// 折线图上每个点背后是哪些账：笔数 + 花得最多的一类。触摸浮标要显示这些。
// 和 sumBills 同一口径：已退款的账不计进来
function bucketInfo(list) {
  const byCategory = {}
  let count = 0
  list.forEach((item) => {
    if (item.refunded) return
    count += 1
    const key = item.category || 'other'
    byCategory[key] = (byCategory[key] || 0) + Number(item.amount || 0)
  })
  let topKey = ''
  let topAmount = 0
  Object.keys(byCategory).forEach((key) => {
    if (byCategory[key] > topAmount) {
      topAmount = byCategory[key]
      topKey = key
    }
  })
  const sample = list.find((item) => !item.refunded && item.category === topKey)
  return {
    count,
    topName: sample ? sample.categoryName : '',
    topEmoji: sample ? sample.categoryEmoji : '',
    topAmount: round2(topAmount)
  }
}

const trendData = computed(() => {
  const buckets = []
  const todayDate = new Date()
  // label 是画在轴上的短标签（会被抽稀），fullLabel 是浮标里那句完整的
  const pushBucket = (key, label, fullLabel, list) => {
    buckets.push({ key, label, fullLabel, value: sumBills(list), ...bucketInfo(list) })
  }

  if (trendMode.value === 'day') {
    for (let offset = trendCounts.day - 1; offset >= 0; offset -= 1) {
      const date = new Date(todayDate)
      date.setDate(todayDate.getDate() - offset)
      const key = formatDateKey(date)
      pushBucket(
        key,
        `${date.getMonth() + 1}/${date.getDate()}`,
        `${date.getMonth() + 1}月${date.getDate()}日`,
        statAllExpenses.value.filter((item) => item.date === key)
      )
    }
  } else if (trendMode.value === 'month') {
    for (let offset = trendCounts.month - 1; offset >= 0; offset -= 1) {
      const date = new Date(todayDate.getFullYear(), todayDate.getMonth() - offset, 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      pushBucket(
        key,
        `${date.getMonth() + 1}月`,
        `${date.getFullYear()}年${date.getMonth() + 1}月`,
        statAllExpenses.value.filter((item) => item.month === key)
      )
    }
  } else {
    for (let offset = trendCounts.year - 1; offset >= 0; offset -= 1) {
      const year = todayDate.getFullYear() - offset
      pushBucket(
        String(year),
        `${year}`,
        `${year}年`,
        statAllExpenses.value.filter((item) => String(item.date).startsWith(`${year}-`))
      )
    }
  }

  const activeKey = trendMode.value === 'day'
    ? formatDateKey(todayDate)
    : trendMode.value === 'month'
      ? today.value.slice(0, 7)
      : String(todayDate.getFullYear())

  return buckets.map((item) => ({
    ...item,
    active: item.key === activeKey
  }))
})

const trendChart = computed(() => {
  const width = 360
  const height = 218
  // 左边多留一截给 Y 轴刻度数字
  const left = 44
  const right = 344
  const top = 30
  const bottom = 164
  const labelY = 198
  const data = trendData.value
  const maxValue = Math.max(...data.map((item) => Number(item.value) || 0), 0)
  const points = data.map((item, index) => {
    const ratio = data.length <= 1 ? 0.5 : index / (data.length - 1)
    const x = left + (right - left) * ratio
    const valueRatio = maxValue > 0 ? (Number(item.value) || 0) / maxValue : 0
    const y = bottom - (bottom - top) * valueRatio
    return {
      ...item,
      x,
      y,
      xPercent: (x / width) * 100,
      yPercent: (y / height) * 100,
      labelPercent: (labelY / height) * 100
    }
  })
  const linePoints = points.map((item) => `${item.x},${item.y}`).join(' ')
  const areaPath = points.length
    ? `M ${points[0].x} ${bottom} L ${points.map((item) => `${item.x} ${item.y}`).join(' L ')} L ${points[points.length - 1].x} ${bottom} Z`
    : ''

  // 日期标签在点数多时会叠：每隔 step 个点标一个，最后一点和当前点必标。
  // 靠近末尾的那个等距标签要额外掐掉——否则它和最后一点（今天）只差一个点距，
  // 「9/26」和「9/27」会直接压在一条线上。
  const count = points.length
  const lastIndex = count - 1
  const labelStep = Math.max(1, Math.ceil(count / 8))
  const denseMarkers = count > 14
  const gridLines = [top, top + (bottom - top) / 3, top + ((bottom - top) * 2) / 3, bottom]

  return {
    width,
    height,
    left,
    right,
    bottom,
    labelY,
    // 绘图区的上下边界（百分比）：触摸那根竖线只画这一段，别穿到日期标签上
    plotTopPercent: (top / height) * 100,
    plotHeightPercent: ((bottom - top) / height) * 100,
    points: points.map((item, index) => ({
      ...item,
      showLabel:
        item.active ||
        index === lastIndex ||
        (index % labelStep === 0 && lastIndex - index >= labelStep),
      showMarker: item.active || !denseMarkers
    })),
    linePoints,
    areaPath,
    gridLines,
    // 网格线自上而下对应 max、2/3、1/3、0
    yTicks: gridLines.map((line, index) => ({
      key: index,
      yPercent: (line / height) * 100,
      label: formatAxisValue((maxValue * (gridLines.length - 1 - index)) / (gridLines.length - 1))
    })),
    // Y 轴刻度的右边缘离绘图区左边界留 12 个绘图单位（390px 宽上约 13px）。
    // 直接贴着 left 的话，第一个点的圆点中心正好就在 left 上，数字会和圆点压在一起
    axisRightPercent: (1 - (left - 12) / width) * 100
  }
})

onShow(() => {
  // 跨天唤起时重算 today（页面实例不会重建，不刷就卡在昨天）；不动 currentMonth，
  // 免得把用户正在看的月份弹回本月
  today.value = getToday()
  loadData()
})
onReady(scheduleChartRender)

async function loadData() {
  try {
    await initLedger()
    allBills.value = await listBills()
    bills.value = allBills.value.filter((item) => item.month === currentMonth.value)
    selectedIds.value = []
    // 重载（含翻月）时连多选状态一起收掉，否则屏幕上留着「已选 0 笔」的批量栏要点取消
    selectionMode.value = false
    loadError.value = false
    pieNeedReveal = true
    scheduleChartRender()
  } catch (error) {
    // 数据库没就绪 / 查询失败时别只留一个空账本，给出错误态和重试入口
    console.error('读取账本失败', error)
    loadError.value = true
    uni.showToast({ title: '账本读取失败，请重试', icon: 'none' })
  }
}

let chartRenderTimer = null
let monthSlideTimer = null

/* ---------- 饼图：手指按着就跟手转，松手带惯性吸附 ---------- */

// 1px 横移 = 1.05°：滑 35px 就过一格（10 类时一格约 36°），
// 三下就是一圈。之前 0.62 太钝，转一格要拉 58px，手上要挪一大截
const PIE_DEG_PER_PX = 1.05

// App 端触摸事件的 clientX/clientY 本来就是 CSS 像素，和布局、
// boundingClientRect 同单位——不需要换算。之前乘过 1/dpr，
// 结果整条手势慢了 3.24 倍（滑 60px 才转 19°），是错的
const PIE_TOUCH_SCALE = 1

let pieDragStartX = 0
let pieDragStartY = 0
let pieDragStartRotation = 0
let pieDragPrevX = 0
let pieDragPrevTime = 0
let pieDragVelocity = 0
// 拖动中先把角度写在这里，由 rAF 一帧提交一次；每个 touchmove 都写
// pieRotation.value 会让图例那十行跟着重渲染
let piePendingRotation = 0

// —— 选中块的「由小变大」弹簧 ——
// 每块一个 0.95 / 1.06 的半径比例，被选中时不是瞬间跳过去，而是带过冲再回弹。
// 刚度 140 / 阻尼 10 → ω≈11.8 rad/s、ζ≈0.42：冲过头 23% 再弹回来，
// 全程约 600ms。之前是 320/22（ζ≈0.61、350ms），太快，弹不出来
// 刚度 110 / 阻尼 9 → ω≈10.5 rad/s、ζ≈0.43：过冲 22%，全程约 660ms。
// 半径差必须给够（0.90 → 1.10，位移 0.20R）——过冲量是位移的 22%，
// 位移只有 0.11R 时那点过冲只有 2px，看不出来
const PIE_SCALE_IDLE = 0.68
const PIE_SCALE_FOCUS = 1.34
const PIE_SCALE_STIFFNESS = 110
const PIE_SCALE_DAMPING = 9
const pieScales = {}
let pieScaleRaf = 0
let pieScaleTime = 0

function pieScaleFor(key, selected) {
  const target = selected ? PIE_SCALE_FOCUS : PIE_SCALE_IDLE
  let entry = pieScales[key]
  if (!entry) {
    // 第一次见到这个分类时直接落在目标值，不播动画（否则进页面整圈会抖一下）
    entry = pieScales[key] = { value: target, velocity: 0, target }
    return entry.value
  }
  entry.target = target
  // 关了动效就直接落到目标值，否则弹簧循环不会启动，那块会永远停在 0.95
  if (prefersReducedMotion) {
    entry.value = target
    entry.velocity = 0
  }
  return entry.value
}

function stepPieScales() {
  const now = Date.now()
  const dt = Math.min(0.032, Math.max(0.001, (now - pieScaleTime) / 1000))
  pieScaleTime = now
  let moving = false
  Object.keys(pieScales).forEach((key) => {
    const entry = pieScales[key]
    // 弹簧：加速度 = 刚度 × 位移，减去阻尼 × 速度
    entry.velocity +=
      ((entry.target - entry.value) * PIE_SCALE_STIFFNESS - entry.velocity * PIE_SCALE_DAMPING) * dt
    entry.value += entry.velocity * dt
    if (Math.abs(entry.target - entry.value) < 0.0006 && Math.abs(entry.velocity) < 0.02) {
      entry.value = entry.target
      entry.velocity = 0
    } else {
      moving = true
    }
  })
  if (pieRectCache) drawPieCanvas(pieRectCache)
  if (moving) {
    pieScaleRaf = rafFn(stepPieScales)
  } else {
    pieScaleRaf = 0
  }
}

function startPieScaleLoop() {
  if (pieScaleRaf) return
  if (prefersReducedMotion) return
  pieScaleTime = Date.now()
  pieScaleRaf = rafFn(stepPieScales)
}

// —— 转得快时被甩出去（离心） ——
// 速度单位是「度/毫秒」，1.2 大约是正常一次快拨。pieSpinOut 是 0..1 的强度，
// 平滑跟过去而不是直接用它：松手速度归零时，饼要自己收回来，不能啪一下弹回
const PIE_SPIN_POP = 7
let pieSpinOut = 0
let pieSpinTarget = 0
let pieSpinRaf = 0

function setPieSpin(speed) {
  pieSpinTarget = Math.min(1, Math.abs(speed) / 1.2)
  if (pieSpinRaf || prefersReducedMotion) return
  const step = () => {
    pieSpinOut += (pieSpinTarget - pieSpinOut) * 0.22
    pieSpinTarget *= 0.86
    if (pieRectCache) drawPieCanvas(pieRectCache)
    if (pieSpinOut > 0.004 || pieSpinTarget > 0.004) {
      pieSpinRaf = rafFn(step)
    } else {
      pieSpinOut = 0
      pieSpinTarget = 0
      pieSpinRaf = 0
      if (pieRectCache) drawPieCanvas(pieRectCache)
    }
  }
  pieSpinRaf = rafFn(step)
}
let pieDragging = false
let pieDragLocked = false
let pieFrameRaf = 0
let pieSnapRaf = 0
// 按在饼图上哪个位置决定了「往哪边拖算正转」：手按在下半圈时把饼往左推，
// 饼该跟着手逆着表针走；按在上半圈则反过来。之前一律「右拖=顺时针」，
// 于是按着下半部往左拖，饼反向转
let pieGrabSign = 1
let pieGrabOffsetX = 0
let pieGrabOffsetY = 0

function cancelPieSnap() {
  if (!pieSnapRaf) return
  cafFn(pieSnapRaf)
  pieSnapRaf = 0
}

// 拖拽期间一帧最多画一次。这里**不能** debounce——之前是 80ms 的 setTimeout，
// 手指一直在动就一直重置，等于中途中一张都不画，松手才蹦一下，所以根本不跟手。
// 另外也别在这里重新量画布：createSelectorQuery 是异步往返，量回来的尺寸
// 还是上一帧的。拖动时直接用上次量到的包围盒
function schedulePieFrame() {
  if (pieFrameRaf) return
  pieFrameRaf = rafFn(() => {
    pieFrameRaf = 0
    if (piePendingRotation !== pieRotation.value) pieRotation.value = piePendingRotation
    if (pieRectCache) drawPieCanvas(pieRectCache)
  })
}

function onPieTouchStart(event) {
  const touch = event.touches && event.touches[0]
  if (!touch) return
  // 第二根手指按下会再触发一次 touchstart，把第一根手指的当前位置当成新起点，
  // 饼会「跳」一下。正在拖就忽略后续按下
  if (pieDragging) return
  cancelPieSnap()
  const startX = touch.clientX * PIE_TOUCH_SCALE
  const startY = touch.clientY * PIE_TOUCH_SCALE
  pieDragStartX = startX
  pieDragStartY = startY
  pieDragPrevX = startX
  pieDragPrevTime = Date.now()
  pieDragStartRotation = pieRotation.value
  piePendingRotation = pieRotation.value
  pieDragVelocity = 0
  pieDragging = true
  pieDragLocked = false
  pieGrabSign = 0
  pieGrabOffsetX = 0
  pieGrabOffsetY = 0
  uni
    .createSelectorQuery()
    .select('#pieCanvas')
    .boundingClientRect((rect) => {
      if (!rect || !rect.width) return
      pieRectCache = rect
      const chart = pieChart.value
      pieGrabOffsetX = startX - (rect.left + chart.cx * (rect.width / chart.width))
      pieGrabOffsetY = startY - (rect.top + chart.cy * (rect.height / chart.height))
      // 已经锁定就不要再改符号了：同一段 dx 中途换向会让饼「跟一下就翻脸」
      if (pieDragLocked) return
      // 左右两侧（|x| 远大于 |y|）时横向拖动的含义是明确的，不用翻符号
      pieGrabSign = Math.abs(pieGrabOffsetY) > Math.abs(pieGrabOffsetX) * 0.45 ? (pieGrabOffsetY > 0 ? -1 : 1) : 1
    })
    .exec()
}

function onPieTouchMove(event) {
  const touch = event.touches && event.touches[0]
  if (!touch || !pieDragging) return
  const pointerX = touch.clientX * PIE_TOUCH_SCALE
  const pointerY = touch.clientY * PIE_TOUCH_SCALE
  const dx = pointerX - pieDragStartX
  const dy = pointerY - pieDragStartY
  // 方向锁定：先动够 8px 再判定，且锥形只留水平方向 ±35°
  if (!pieDragLocked) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    if (Math.abs(dy) > Math.abs(dx) * 0.7) {
      // 竖直方向：这一手不是转饼。命中层上挂了 .prevent（事件进来之前就
      // preventDefault 了），所以这里放不放弃都滚不了页面——真正让页面能滚的
      // 是「手势区只覆盖圆盘」，见模板里的 .pie-hit
      pieDragging = false
      return
    }
    // 符号要等异步量的包围盒回来才算得出来。没回来之前先不锁，
    // 否则先用默认方向转一段、回调一到立刻换向
    if (pieGrabSign === 0) return
    pieDragLocked = true
  }
  const now = Date.now()
  const elapsed = Math.max(1, now - pieDragPrevTime)
  // 只用最近一段的位移算速度，抬手时拿它推惯性
  pieDragVelocity = ((pointerX - pieDragPrevX) / elapsed) * PIE_DEG_PER_PX * pieGrabSign
  pieDragPrevX = pointerX
  pieDragPrevTime = now
  setPieSpin(pieDragVelocity)
  piePendingRotation = pieDragStartRotation + dx * PIE_DEG_PER_PX * pieGrabSign
  schedulePieFrame()
}

function onPieTouchEnd(event) {
  if (!pieDragging) return
  const locked = pieDragLocked
  pieDragging = false
  pieDragLocked = false
  if (!locked) {
    // 没锁定 = 手指没怎么移动 = 点击：把点到的那块转到 3 点方向
    rotateSliceToFocus(event)
    return
  }
  // 把最后一帧还没提交的角度补上，否则吸附会从上一帧的位置起算
  if (pieFrameRaf) {
    cafFn(pieFrameRaf)
    pieFrameRaf = 0
  }
  pieRotation.value = piePendingRotation
  // 抬手前如果手指停住过，旧速度不该继续生效，否则松手还会甩出去一段
  const idle = Date.now() - pieDragPrevTime
  const velocity = idle > 80 ? 0 : pieDragVelocity
  glidePie(pieRotation.value, velocity)
}

// 松手后的滑行：速度按指数衰减，一直转到快停了才吸附。
// 以前是「按速度外推 90ms 取个终点再直接吸附」，等于松手就定住，
// 感觉像被粘住——真正的惯性要能看到它自己滑过去、越滑越慢，最后咔一声归位
function glidePie(from, velocity) {
  cancelPieSnap()
  if (prefersReducedMotion || Math.abs(velocity) < 0.08) {
    animatePieTo(snapPieRotation(from))
    return
  }
  let rotation = from
  let speed = velocity
  let last = Date.now()
  const tick = () => {
    const now = Date.now()
    const dt = Math.max(1, Math.min(40, now - last))
    last = now
    speed *= Math.exp(-dt / 300)
    rotation += speed * dt
    pieRotation.value = rotation
    setPieSpin(speed)
    if (pieRectCache) drawPieCanvas(pieRectCache)
    if (Math.abs(speed) > 0.035) {
      pieSnapRaf = rafFn(tick)
    } else {
      pieSnapRaf = 0
      animatePieTo(snapPieRotation(rotation))
    }
  }
  tick()
}

// 点某块 → 把它转到 3 点方向。命中判定要在「压扁后的圆盘坐标系」里算：
// 屏幕 y 除以 PIE_FLATTEN 才是圆盘上真正的角度，否则点在椭圆上下两端会判错块
function rotateSliceToFocus(event) {
  // touchend 在 uni 的合成事件里不一定带 changedTouches，退回到按下时记的位置
  const touch =
    (event && event.changedTouches && event.changedTouches[0]) ||
    (event && event.touches && event.touches[0]) ||
    null
  const pointerX = touch ? touch.clientX * PIE_TOUCH_SCALE : pieDragStartX
  const pointerY = touch ? touch.clientY * PIE_TOUCH_SCALE : pieDragStartY
  const rect = pieRectCache
  if (!rect || !rect.width) return
  const chart = pieChart.value
  const centerX = rect.left + chart.cx * (rect.width / chart.width)
  const centerY = rect.top + chart.cy * (rect.height / chart.height)
  const offsetX = pointerX - centerX
  const offsetY = (pointerY - centerY) / PIE_FLATTEN
  const distance = Math.hypot(offsetX, offsetY)
  const radius = chart.radius * (rect.width / chart.width)
  // 圆心附近方向没有意义，圆外是卡片空白，都不响
  if (distance < radius * 0.16 || distance > radius * 1.06) return
  const angle = (Math.atan2(offsetY, offsetX) * 180) / Math.PI
  let best = null
  let bestDelta = Infinity
  chart.slices.forEach((slice) => {
    const delta = ((((angle - slice.midAngle + 180) % 360) + 360) % 360) - 180
    if (Math.abs(delta) > slice.sweep / 2) return
    if (Math.abs(delta) < bestDelta) {
      bestDelta = Math.abs(delta)
      best = slice
    }
  })
  if (!best) return
  animatePieTo(pieRotation.value - best.normalized)
}

// 把任意角度对齐到「某块的正中刚好落在 3 点方向」
function snapPieRotation(rotation) {
  const slices = buildPieSlices(rotation)
  if (!slices.length) return rotation
  let best = slices[0]
  slices.forEach((slice) => {
    if (Math.abs(slice.normalized) < Math.abs(best.normalized)) best = slice
  })
  return rotation - best.normalized
}

// 吸附不能瞬移：一帧跳过去，视觉上那块是「闪」到正中的。补一段 200-400ms 的收尾
function animatePieTo(target) {
  cancelPieSnap()
  const from = pieRotation.value
  const delta = target - from
  if (prefersReducedMotion || Math.abs(delta) < 0.05) {
    pieRotation.value = target
    schedulePieFrame()
    return
  }
  const duration = Math.min(420, 190 + Math.abs(delta) * 1.1)
  const startedAt = Date.now()
  const tick = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    pieRotation.value = from + delta * eased
    if (pieRectCache) drawPieCanvas(pieRectCache)
    pieSnapRaf = progress < 1 ? rafFn(tick) : 0
  }
  tick()
}

/* ---------- 折线图：按在哪个点附近就看哪个点的明细 ---------- */

const trendTipKey = ref('')
// 画布最近一次量到的包围盒（每次重画时更新），触摸命中只用它的 left
let trendRectCache = null

// 只按 x 找最近的点，竖直方向不参与判定：手指压住线也能选准，
// 也省掉了「触摸时还得重新量一次画布」那一步
function nearestTrendIndex(event) {
  const chart = trendChart.value
  const touch = event.touches && event.touches[0]
  if (!chart.points.length || !trendRectCache || !trendRectCache.width || !touch) return -1
  if (!Number.isFinite(touch.clientX)) return -1
  const unitX = ((touch.clientX - trendRectCache.left) / trendRectCache.width) * chart.width
  let best = 0
  let bestDistance = Infinity
  chart.points.forEach((point, index) => {
    const distance = Math.abs(point.x - unitX)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

function onTrendTouch(event) {
  const index = nearestTrendIndex(event)
  if (index < 0) return
  trendTipKey.value = trendChart.value.points[index].key
}

// 抬手就收：浮标挂着不走的话会一直挡着折线，也没有别的地方好点掉它
function clearTrendTip() {
  trendTipKey.value = ''
}

// 浮标离选中点拉开这么远：手指肚压着屏幕大概盖住 45px 见方，16rpx 那点距离
// 等于把浮标塞在指尖底下
const TIP_OFFSET = '88rpx'

const trendTip = computed(() => {
  const point = trendChart.value.points.find((item) => item.key === trendTipKey.value)
  if (!point) return null
  // 默认浮在点的上边；点太靠上、上面塞不下（浮标高约 50px + 让开手指的 88rpx
  // ≈ 图高的 51%）就翻到下边，下边同样留出这个距离。
  // 左右两端把浮标对齐到边，不然会被画布裁掉一截
  return {
    point,
    above: point.yPercent > 51,
    align: point.xPercent < 20 ? 'start' : point.xPercent > 80 ? 'end' : 'center'
  }
})

const trendTipStyle = computed(() => {
  const tip = trendTip.value
  if (!tip) return {}
  const shiftX = tip.align === 'start' ? '0%' : tip.align === 'end' ? '-100%' : '-50%'
  const shiftY = tip.above ? `calc(-100% - ${TIP_OFFSET})` : TIP_OFFSET
  return {
    left: `${tip.point.xPercent}%`,
    top: `${tip.point.yPercent}%`,
    transform: `translate(${shiftX}, ${shiftY})`
  }
})

function scheduleChartRender() {
  if (chartRenderTimer) clearTimeout(chartRenderTimer)
  chartRenderTimer = setTimeout(async () => {
    await nextTick()
    await renderCharts()
  }, 80)
}

function queryCanvasRect(selector) {
  return new Promise((resolve) => {
    uni.createSelectorQuery()
      .select(selector)
      .boundingClientRect((rect) => resolve(rect || null))
      .exec()
  })
}

async function renderCharts() {
  const [trendRect, pieRect] = await Promise.all([
    queryCanvasRect('#trendCanvas'),
    queryCanvasRect('#pieCanvas')
  ])

  if (trendRect && trendRect.width > 0 && trendRect.height > 0) {
    // 顺手记下来给触摸命中用。只用它的 left：横向不会滚动，left 永远准；
    // 纵向位置不参与命中判定，所以不用每次触摸重新量
    trendRectCache = trendRect
    drawTrendCanvas(trendRect)
  }
  if (pieRect && pieRect.width > 0 && pieRect.height > 0) {
    drawPieCanvas(pieRect)
    // 首次进入：等画布真的量到尺寸再开动画（量不到就根本没画布）。
    // 只播一次——之后翻月、切主题重绘都是瞬时到位，不再抖
    if (pieNeedReveal && !pieRevealed) {
      pieNeedReveal = false
      pieRevealed = true
      playPieReveal()
    }
  }
}

function drawTrendCanvas(rect) {
  const chart = trendChart.value
  if (!chart.points.length) return
  const palette = chartPalettes[theme.value] || chartPalettes.sakura
  const canvas = uni.createCanvasContext('trendCanvas')
  const scaleX = rect.width / chart.width
  const scaleY = rect.height / chart.height
  const left = chart.left * scaleX
  const right = chart.right * scaleX
  const bottom = chart.bottom * scaleY
  const points = chart.points.map((item) => ({ x: item.x * scaleX, y: item.y * scaleY }))
  const traceLine = () => {
    canvas.beginPath()
    points.forEach((point, index) => {
      if (index === 0) canvas.moveTo(point.x, point.y)
      else canvas.lineTo(point.x, point.y)
    })
  }

  canvas.clearRect(0, 0, rect.width, rect.height)

  // 网格用极淡实线，不用虚线；底线压一点强调色，把 x 轴立起来
  chart.gridLines.forEach((line, index) => {
    const y = line * scaleY
    const isBaseline = index === chart.gridLines.length - 1
    canvas.beginPath()
    canvas.moveTo(left, y)
    canvas.lineTo(right, y)
    canvas.setStrokeStyle(isBaseline ? hexToRgba(palette.accent, 0.3) : palette.grid)
    canvas.setLineWidth(1)
    canvas.stroke()
  })

  // 面积从线色渐隐到底，避免一整片色块把画面压平。
  // 终点 x 用 1 而不是 0：App 端 canvas 对 x0 === x1 的竖向渐变直接跳过 fill，
  // 静默不画（H5 正常）。差 1px 肉眼看不出，却绕开了那个退化包围盒。
  // 饼图的侧壁当初就是这条踩雷了，整整三轮都以为是「饼变平了」
  const areaGradient = canvas.createLinearGradient(0, chart.gridLines[0] * scaleY, 1, bottom)
  areaGradient.addColorStop(0, hexToRgba(palette.accent, 0.3))
  areaGradient.addColorStop(0.72, hexToRgba(palette.accent, 0.07))
  areaGradient.addColorStop(1, hexToRgba(palette.accent, 0))
  canvas.beginPath()
  canvas.moveTo(points[0].x, bottom)
  points.forEach((point) => canvas.lineTo(point.x, point.y))
  canvas.lineTo(points[points.length - 1].x, bottom)
  canvas.closePath()
  canvas.setFillStyle(areaGradient)
  canvas.fill()

  canvas.setLineCap('round')
  canvas.setLineJoin('round')
  // 线下的柔光，让折线有厚度，不只是根细线
  traceLine()
  canvas.setStrokeStyle(hexToRgba(palette.accent, 0.18))
  canvas.setLineWidth(7)
  canvas.stroke()

  traceLine()
  canvas.setStrokeStyle(palette.accent)
  canvas.setLineWidth(2.4)
  canvas.stroke()

  canvas.draw()
}

// 平面饼图：只画扇区 + 一圈白色细分隔线。
// 原来是「3D 实心饼 + 日晷阴影 + 三十度斜切的椭圆透视」，颜色一降饱和，
// 底部那圈暗面就显脏。拍平之后靠色相区分扇区，和这套 1px 描边、无毛玻璃的界面一致。
//
// 首次进入时扇区逐个展开：pieReveal 是 0→1 的总进度，每个扇区按 index 错开 45ms，
// 各自用 easeOutBack 冲过头再回落——过冲就是「果冻」，错开就是「扇子打开」。
const pieReveal = ref(1)
let pieRevealRaf = 0
let pieRectCache = null
let pieNeedReveal = false
let pieRevealed = false

// 1 → 1.1 → 1：先冲出去再落回，收尾那一下就是弹
function easeOutBack(t) {
  const c1 = 1.35
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function playPieReveal() {
  if (pieRevealRaf) {
    cafFn(pieRevealRaf)
    pieRevealRaf = 0
  }
  if (prefersReducedMotion) {
    pieReveal.value = 1
    if (pieRectCache) drawPieCanvas(pieRectCache)
    return
  }
  const duration = 780
  const startedAt = Date.now()
  pieReveal.value = 0
  const tick = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    pieReveal.value = progress
    if (pieRectCache) drawPieCanvas(pieRectCache)
    if (progress < 1) {
      pieRevealRaf = rafFn(tick)
    } else {
      pieRevealRaf = 0
      pieReveal.value = 1
    }
  }
  tick()
}

// 一块实心圆盘的画法：顶面是压扁的扇形，朝下那半圈有外壁，
// 两条半径上是「剖面」。**剖面**才是关键——只有顶面 + 一层阴影，
// 无论怎么调色都只是两张贴纸；有了剖面和侧壁的明暗转折才有体积
function drawPieCanvas(rect) {
  const chart = pieChart.value
  if (!chart.slices.length) return
  pieRectCache = rect
  const canvas = uni.createCanvasContext('pieCanvas')
  const scale = Math.min(rect.width / chart.width, rect.height / chart.height)
  const cx = chart.cx * (rect.width / chart.width)
  const cy = chart.cy * (rect.height / chart.height)
  const radius = chart.radius * scale
  const ry = radius * PIE_FLATTEN
  const thickness = chart.depth * scale
  const reveal = pieReveal.value

  canvas.clearRect(0, 0, rect.width, rect.height)

  // 按「离观察者的远近」排序：sin 大的在下方、离眼睛近，后画才能盖住远处的侧壁
  const bodies = chart.slices
    .map((slice, index) => {
      const delay = index * 0.04
      const local = Math.max(0, Math.min(1, (reveal - delay) / Math.max(0.001, 1 - delay)))
      const eased = local <= 0 ? 0 : Math.max(0, easeOutBack(local))
      const radians = (slice.midAngle * Math.PI) / 180
      // 选中权重 0..1（弹簧过冲时会 >1）：外移、抬起、放大全都由它驱动，
      // 整块是同一个动作弹出来的，而不是三个属性各自补间
      const scaleValue = pieScaleFor(slice.key, slice.selected)
      const grow01 = (scaleValue - PIE_SCALE_IDLE) / (PIE_SCALE_FOCUS - PIE_SCALE_IDLE)
      // 只有选中那块沿半径外移。其余各块不能外移——一外移，几条边就不在圆心
      // 交汇了，锯齿状的缝会散成「摔碎的样子」；原地不动，缝就是个从圆心张开的 V
      const pop = PIE_POP * grow01 * eased * scale
      // 离心：转得越快，所有块一起往外让开一点，中间露出缝
      const spin = pieSpinOut * PIE_SPIN_POP * eased * scale
      // 每块自己的高度：切开之后又被顺手放回去的，不会严丝合缝
      const jitterTilt = pieJitter(index, 2) * PIE_TILT
      const tilt = (jitterTilt + (PIE_LIFT - jitterTilt) * grow01) * eased * scale
      // 锯口按屏幕像素算再换算成角度：每块都不一样宽，但被吃掉的比例是同一个量级
      const kerf = (PIE_KERF_MIN + pieJitter(index, 3) * (PIE_KERF_MAX - PIE_KERF_MIN)) * scale
      return {
        slice,
        eased,
        // 落在 3 点方向的那块放大、其余整体收小：光靠往外挪 12px 看不出差别，
        // 大块小块还是一样大，「三点钟放大」就白做了。半径差 1.06 / 0.95
        // 换算成面积是 25%，一眼就能看出谁是主角。
        // 用弹簧值而不是直接读 selected：这样被选中的那一下是「弹」出来的
        r: radius * scaleValue,
        kerfDeg: (kerf / radius) * (180 / Math.PI),
        bx: cx + Math.cos(radians) * (pop + spin),
        by: cy + Math.sin(radians) * (pop + spin) * PIE_FLATTEN - tilt,
        nearness: Math.sin(radians)
      }
    })
    .sort((a, b) => a.nearness - b.nearness)

  // 每一块的有效角度：两侧各让出一个锯口。每块的锯口宽度都不一样，
  // 裂缝就宽窄不一——这就是「不均匀」
  bodies.forEach((body) => {
    // 角度不能跟着 easeOutBack 过冲：多出来的几度会盖住隔壁那块，
    // 展开到 90% 时整圈会闪一下。过冲只留给外弹和抬起
    const grow = Math.min(1, body.eased)
    const sweep = body.slice.sweep * grow
    // 缝隙上限还要跟自己的角度挂钩：一个 3% 的块只有 10°，两侧各让 5px 就吃掉
    // 四成，底盘会从缝里漏成一块灰。8% 是「看得出来裂了、又不至于碎掉」的位置
    const crack = Math.min(sweep * 0.08, body.kerfDeg * grow)
    // **必须归一化**：pieRotation 是无界累加的，转两圈就是 -720°，a0/a1 会跑到
    // ±2000°。下面判断「哪半圈能看到侧壁」用的是 max/min 比大小，角度一超界
    // 就得到负的长度，侧壁整片被跳过——转一圈之后只剩顶面，就是这个原因。
    // 顶面一直没事，因为 cos/sin 是周期的
    const rawStart = body.slice.startAngle + crack
    const start = ((((rawStart + 180) % 360) + 360) % 360) - 180
    body.sweep = sweep
    body.crack = crack
    // 选中那块加厚：占比和金额要贴到它的侧面上，14px 的侧壁塞不下两行字
    body.th = thickness * (body.slice.selected ? 1.9 : 1)
    body.a0 = start
    body.a1 = start + (sweep - crack * 2)
    body.visible = sweep >= 0.4 && body.a1 - body.a0 >= 0.3
  })

  // —— 第一遍：壳体 ——
  // 只画「看得见的侧面」：近端的侧壁 + 近端的剖面。**不画底面**——
  // 饼是平摊在台面上的，底面永远看不见。之前每块都把底面往下挪一个厚度当厚度，
  // 12° 的细块被这个下移从两条半径边漏出来，整圈变成一把立起来的刀片
  //
  // 先铺一层「接地阴影」：每块按自己的半径和位置往下错 6px 压一层淡黑。
  // 它跟着每块走，不会像整圆底盘那样对不齐；错位小、颜色淡，
  // 读起来是接触阴影而不是又一层底面
  bodies.forEach((body) => {
    if (!body.visible) return
    const { bx, by, a0, a1 } = body
    const r = body.r
    const rY = r * PIE_FLATTEN
    canvas.beginPath()
    canvas.moveTo(bx, by + PIE_CONTACT)
    traceCanvasArc(canvas, bx, by + PIE_CONTACT, r * 1.01, rY * 1.01, a0, a1, false)
    canvas.closePath()
    canvas.setFillStyle('rgba(26, 18, 22, 0.11)')
    canvas.fill()
  })

  bodies.forEach((body) => {
    if (!body.visible) return
    const { slice, bx, by, a0, a1 } = body
    const r = body.r
    const rY = r * PIE_FLATTEN

    // 外壁：只有下半圈（sin > 0）朝向观察者，上半圈被自己的顶面挡住。
    // a0/a1 归一之后可能落在别的 360 区间里（占比 >50% 的块被拖到 9-12 点方向时
    // 一块能跨过 360），所以三份平移各求一次交集，交集非空就画一段
    for (let wrap = -1; wrap <= 1; wrap += 1) {
      // 侧壁严格落在自己顶面的角度里，不往缝里多铺。之前为了「让相邻侧壁接上」
      // 往两侧各多铺一个锯口，结果顺时针那端会多出一小截露在白色描边外面，
      // 每块都长一个尖，很难看
      const wallFrom = Math.max(a0 + wrap * 360, 0.4)
      const wallTo = Math.min(a1 + wrap * 360, 179.6)
      if (wallTo - wallFrom <= 0.6) continue
      canvas.beginPath()
      traceCanvasArc(canvas, bx, by, r, rY, wallFrom, wallTo, true)
      traceCanvasArc(canvas, bx, by + body.th, r, rY, wallTo, wallFrom, false)
      canvas.closePath()
      // 侧壁：斜向渐变（两个坐标都变）。竖向渐变（x0 === x1）在 App 的原生
      // canvas 上整片不渲染，这就是之前侧壁只能填纯色、整块看着像纸片的原因。
      // 上亮下暗才有一条圆柱的受光
      const wallShade = canvas.createLinearGradient(bx - r * 0.18, by, bx + r * 0.18, by + rY + body.th)
      wallShade.addColorStop(0, shadeHexColor(slice.color, -0.26))
      wallShade.addColorStop(0.5, shadeHexColor(slice.color, -0.46))
      wallShade.addColorStop(1, shadeHexColor(slice.color, -0.66))
      canvas.setFillStyle(wallShade)
      canvas.fill()
    }

    // 两条剖面只画给选中那块。其余各块的半径不完全一致（0.9R 与 1.1R），
    // 剖面从圆心一直铺到自己的圆周，外端就会比隔壁那块多出一个小尖，
    // 每块顺时针那头都冒一截出来——就是「最远端多出来一小截」的来源
    if (slice.selected) {
      drawPieCutFace(canvas, bx, by, r, rY, body.th, a0, -1, slice.color)
      drawPieCutFace(canvas, bx, by, r, rY, body.th, a1, 1, slice.color)
    }
  })

  // —— 第二遍：所有顶面 ——
  // 盖在壳体之上。这一遍是整个重写的关键：以前每块画完自己的面就轮到下一块，
  // 而剖面（圆心到圆周的一条带）的面积是「半径 × 厚度」，和扇区角度无关——
  // 3% 的细块被两条 88px 长的暗面撑出体积，25% 的大块反而显小。
  // 分成两遍，压在每个顶面底下的剖面自动被埋掉，只剩裂缝里和抬起来那块露在外面，
  // 面积于是回到「角度占比」本身
  bodies.forEach((body) => {
    if (!body.visible) return
    const { slice, bx, by, a0, a1, eased } = body
    const r = body.r
    const rY = r * PIE_FLATTEN

    const topShade = canvas.createLinearGradient(bx - r, by - rY, bx + r, by + rY)
    topShade.addColorStop(0, shadeHexColor(slice.color, 0.1))
    topShade.addColorStop(0.5, shadeHexColor(slice.color, 0))
    topShade.addColorStop(1, shadeHexColor(slice.color, -0.16))
    canvas.beginPath()
    canvas.moveTo(bx, by)
    traceCanvasArc(canvas, bx, by, r, rY, a0, a1, false)
    canvas.closePath()
    canvas.setFillStyle(topShade)
    canvas.fill()

    // 远端（屏幕上半圈）看不到侧壁——那半圈的厚度被饼自己挡住，是对的。
    // 但十来个分类里小块多半落在远端，整片就是纯色纸，和近端的块不像一个东西。
    // 沿远端外缘压一条深边当「厚度」。两个坑：
    //   1) 角度归一到 (-180,180] 之后，远端是 **-180…0**，不是 180…360
    //   2) 描边是骑在路径上的，压在边界线上会有半个线宽漏到图形外面，
    //      白色描边又盖住中间，结果是一条浮在白底上的游丝。所以往里缩 1.8px
    const inset = 1.8 * scale
    const farFrom = Math.max(a0, -179.6)
    const farTo = Math.min(a1, -0.4)
    if (farTo - farFrom > 0.6) {
      canvas.beginPath()
      traceCanvasArc(canvas, bx, by, r - inset, rY - inset * PIE_FLATTEN, farFrom, farTo, true)
      canvas.setLineWidth(Math.max(1.4, 2.4 * scale))
      canvas.setLineCap('butt')
      canvas.setStrokeStyle(shadeHexColor(slice.color, -0.3))
      canvas.stroke()
    }

    canvas.beginPath()
    canvas.moveTo(bx, by)
    traceCanvasArc(canvas, bx, by, r, rY, a0, a1, false)
    canvas.closePath()
    canvas.setLineWidth(Math.max(0.8, (slice.selected ? 1.5 : 1) * scale))
    canvas.setLineJoin('round')
    canvas.setLineCap('butt')
    canvas.setStrokeStyle(slice.selected ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.78)')
    canvas.stroke()
    // 顶面上不再写字：占比和金额已经贴到侧面上了（见下面那一遍）
  })

  // —— 第三遍：选中块的占比与金额 ——
  // 挂在选中块外缘的固定位置上（3 点钟方向），不跟着「侧壁可见的那段弧」走。
  // 之前按侧壁弧的中点定位：细分类的侧壁只有 1.8° 宽，文字要么被切掉、
  // 要么因为弧长不足直接不画——「有些文字消失」就是这个。
  // 字号也不再由厚度推算（26px 厚只算出 9.6px 字），改成固定档
  const focus = bodies.find((body) => body.visible && body.slice.selected && body.eased >= 0.9)
  if (focus) {
    const { slice, bx, by } = focus
    const r = focus.r
    const labelX = bx + r + 8 * scale
    const labelY = by + focus.th * 0.42
    const bigSize = PIE_LABEL_SIZE
    canvas.setTextAlign('left')
    canvas.setTextBaseline('middle')
    // 字现在落在卡片白底上，白字+暗描边会变成空心字。改成「分类色的深色版 +
    // 白色描边」：任何底色上都读得出来，也不靠 setShadow / measureText
    const ink = shadeHexColor(slice.color, -0.52)
    const outline = Math.max(0.9, bigSize * 0.06)
    const drawOutlined = (text, x, y, size) => {
      canvas.setFontSize(size)
      canvas.setFillStyle('rgba(255, 255, 255, 0.96)')
      canvas.fillText(text, x - outline, y)
      canvas.fillText(text, x + outline, y)
      canvas.fillText(text, x, y - outline)
      canvas.fillText(text, x, y + outline)
      canvas.setFillStyle(ink)
      canvas.fillText(text, x, y)
    }
    drawOutlined(`${slice.percent}%`, labelX, labelY - bigSize * 0.62, bigSize)
    drawOutlined(`¥${Number(slice.amount).toFixed(2)}`, labelX, labelY + bigSize * 0.62, PIE_LABEL_SIZE_SUB)
  }

  canvas.draw()

  // 有块的弹簧还没落定（刚换了选中项）就把循环推起来，一帧一帧把它弹回去。
  // 放在 draw 之后：本轮仍然按当前值画，下一帧才开始变
  const unsettled = Object.keys(pieScales).some((key) => {
    const entry = pieScales[key]
    return Math.abs(entry.target - entry.value) > 0.0006
  })
  if (unsettled) startPieScaleLoop()
}

// 剖面：从圆心到圆周的一条竖带，高度就是厚度。投影之后是个平行四边形。
// 只在「近端」画。远端（屏幕上半圈）的剖面虽然按法线算是朝向观察者的，
// 但它被整块饼自己挡住——真实视角下那半圈只看得到顶面。之前不分远近都画，
// 于是 3% 的细块被两条 88px 长、22px 高的剖面撑成一把立起来的刀片
function drawPieCutFace(canvas, bx, by, rx, ry, thickness, angle, side, color) {
  const radians = (angle * Math.PI) / 180
  if (Math.sin(radians) < -0.25) return
  const facing = side * Math.cos(radians)
  if (facing < 0.02) return
  const rim = piePoint(bx, by, rx, ry, angle)
  canvas.beginPath()
  canvas.moveTo(bx, by)
  canvas.lineTo(rim.x, rim.y)
  canvas.lineTo(rim.x, rim.y + thickness)
  canvas.lineTo(bx, by + thickness)
  canvas.closePath()
  // 正对观察者的那块亮一档，侧过去的压深，两个面之间才有转折
  canvas.setFillStyle(shadeHexColor(color, facing > 0.5 ? -0.3 : -0.44))
  canvas.fill()
}

function traceCanvasArc(canvas, cx, cy, rx, ry, startAngle, endAngle, move) {
  const steps = Math.max(4, Math.ceil(Math.abs(endAngle - startAngle) / 6))
  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / steps
    const point = piePoint(cx, cy, rx, ry, angle)
    if (move && index === 0) canvas.moveTo(point.x, point.y)
    else canvas.lineTo(point.x, point.y)
  }
}

function hexToRgba(color, alpha) {
  const value = String(color || '#8796b0').replace('#', '')
  const normalized = normalizeHexColor(value)
  const number = Number.parseInt(normalized, 16)
  const red = (number >> 16) & 255
  const green = (number >> 8) & 255
  const blue = number & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function shadeHexColor(color, amount) {
  const normalized = normalizeHexColor(String(color || '#8796b0').replace('#', ''))
  const number = Number.parseInt(normalized, 16)
  const target = amount >= 0 ? 255 : 0
  const weight = Math.min(1, Math.abs(amount))
  const red = Math.round(((number >> 16) & 255) + (target - ((number >> 16) & 255)) * weight)
  const green = Math.round(((number >> 8) & 255) + (target - ((number >> 8) & 255)) * weight)
  const blue = Math.round((number & 255) + (target - (number & 255)) * weight)
  return `rgb(${red}, ${green}, ${blue})`
}

function normalizeHexColor(value) {
  return value.length === 3
    ? value.split('').map((item) => `${item}${item}`).join('')
    : value.padEnd(6, '0').slice(0, 6)
}

function getToday() {
  return formatDateKey(new Date())
}

function formatDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sumBills(list) {
  return round2((list || []).reduce((sum, item) => sum + (item.refunded ? 0 : Number(item.amount || 0)), 0))
}

function piePoint(cx, cy, rx, ry, angle, scale = 1) {
  const radians = (angle * Math.PI) / 180
  return {
    x: cx + rx * scale * Math.cos(radians),
    y: cy + ry * scale * Math.sin(radians)
  }
}

// 轴刻度取整到十位，别出现 6717 / 444.4 这种不好读的数；小数值保留精度，否则全变 0
function formatAxisValue(value) {
  const amount = Number(value || 0)
  if (amount >= 10000) return `${Math.round(amount / 1000) / 10}万`
  if (amount >= 100) return String(Math.round(amount / 10) * 10)
  if (amount >= 10) return String(Math.round(amount))
  return amount ? String(round2(amount)) : '0'
}

function formatDateLabel(dateText) {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayText = formatDateKey(yesterday)
  if (dateText === getToday()) return '今天'
  if (dateText === yesterdayText) return '昨天'
  const [, month, day] = dateText.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function changeMonth(delta) {
  const next = shiftMonth(currentMonth.value, delta)
  if (next > nextMonthText.value && !allBills.value.some((item) => item.month === next)) {
    uni.showToast({ title: '最多只能记到下个月', icon: 'none' })
    return
  }
  currentMonth.value = next
  // 等新月份的内容到位再滑入，否则滑的还是上个月的数据
  await loadData()
  playMonthSlide(delta)
}

/* ---------- 逐帧调度器 ---------- */

// 这个项目里 requestAnimationFrame 不是能直接拿来用的全局——App 端的原生事件回调里
// 直接调会抛 ReferenceError（页面里别处都是先判 typeof 才敢用）。所有需要帧边界的
// 地方统一走这两个包装，取不到就退化成 16ms 的 setTimeout，那也是一个真正的帧边界。
const rafFn =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 16)
const cafFn =
  typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : (handle) => clearTimeout(handle)

// 和 CSS 里那条 prefers-reduced-motion 对应的 JS 判断。CSS 只能管到关键帧和过渡，
// 手势那条弹簧是在 JS 里逐帧跑的，必须自己读一次（apple-design §14 要求写进组件，
// 不能只写在样式表里）。启动时读一次；中途改系统设置不会重读，可接受。
const prefersReducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- 翻月 ---------- */

// keyframe 不会自己重放：连着翻同方向时类名不变，Vue 不 patch，第二次点就静默没有动画。
// 所以先摘掉类、等一个帧边界再加回来，强制重启。用帧边界而不是 nextTick，
// 是因为 nextTick 只推进微任务；更不能在没有 rAF 时同步调 start——那样两次改动会被
// Vue 合并成一次批处理，DOM 上等于没摘过类，动画依然不会重放。
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

/* ---------- 弹层：退场动画 ---------- */

// uni-app App 端不支持 <transition> 组件，出场只能自己搭：先加 is-closing 类把
// 退场 keyframe 跑起来，等动画跑完再卸 v-if。直接设 false 是「啪」地消失。
// 比 CSS 里的 200ms 多留一点：定时器和动画同长的话，会有一帧被提前卸掉
const SHEET_EXIT_MS = 220
const closingSheet = ref('')
let closeTimer = null

const sheetRefs = {
  editor: editorVisible,
  date: datePickerVisible,
  export: exportVisible,
  settings: settingsVisible,
  import: importVisible
}

// 任一弹层打开（含正在播退场动画的——ref 要到动画结束才置 false）就锁住整页滚动。
// 解锁必须显式写 overflow: visible，不能给空字符串：page-style 是往页面上补样式，
// 空字符串等于「什么都不设」，已经写上去的 overflow: hidden 会一直留着，页面就再也滚不动了。
// 清单直接取自 sheetRefs，不再另抄一份——两份清单漏同步的后果是页面永久滚不动
const pageLockStyle = computed(() =>
  Object.values(sheetRefs).some((sheet) => sheet.value) ? 'overflow: hidden' : 'overflow: visible'
)

function closeSheet(name) {
  if (closingSheet.value) return
  // 手上（或回弹中）还有拖拽位移时点遮罩/×：不能先把位移清零再从头播 keyframe，
  // 那会先跳回原位再滑出去；也不能留着行内 transform——它优先级高于 keyframe，
  // 出场动画根本不会播。正确做法是当成一次甩动关闭，从当前位置接着走
  if (dragTarget.value) {
    dragDismiss(0)
    return
  }
  closingSheet.value = name
  clearTimeout(closeTimer)
  closeTimer = setTimeout(finishSheetClose, SHEET_EXIT_MS)
}

function finishSheetClose() {
  clearTimeout(closeTimer)
  closeTimer = null
  if (closingSheet.value && sheetRefs[closingSheet.value]) {
    sheetRefs[closingSheet.value].value = false
  }
  closingSheet.value = ''
  // 拖拽关闭走的是 dragDismiss → 这里，不经过 closeEditor，得在这里一并把焦点收回，
  // 否则 :focus 会一直停在已经销毁的输入框上，键盘停在屏幕里
  amountFocused.value = false
  cancelDrag()
}

/* ---------- 弹层：下拉关闭 ---------- */

// 不引库：uni-app App 端没有 Motion/Framer，弹簧按帧自己积分。
// 三条规矩都来自 apple-design：1) 1:1 跟手，不做插值；2) 越界给橡皮筋阻尼而不是硬停；
// 3) 松手按「投影落点」决定关还是弹回，并把松手速度交给回弹动画，不能硬切。
const dragTarget = ref('')
// 兜底通道：拿不到 DOM 节点时位移才走响应式。正常路径下它恒为 0，见 applyDragOffset
const dragY = ref(0)
const DISMISS_DISTANCE = 96 // px
const DISMISS_VELOCITY = 0.11 // px/ms，Apple 的手势判定阈值
const DECELERATION = 0.998 // Apple 的动量投影衰减率
const DRAG_SLOP = 8 // px，先移动这么多才确认是拖拽而不是点一下

const sheetEls = {}
let dragPending = ''
let dragSheetEl = null
let dragOffset = 0
let dragStartY = 0
let dragHistory = []
let dragRaf = 0

// :ref 回调，把每个抽屉的真实节点存下来（节点卸载时回调 null）
function setSheetEl(name, el) {
  sheetEls[name] = el || null
}

// 能不能直接写行内样式，按「是不是真的 CSSStyleDeclaration」判断：只有它才有
// setProperty。uni-app 的元素对象上如果有同名属性但不是真样式对象，写进去不生效、
// 又跳过了下面的响应式兜底，拖拽会整个冻住——所以这个判断必须严
function dragStyleTarget() {
  const el = dragSheetEl
  return el && el.style && typeof el.style.setProperty === 'function' ? el.style : null
}

// 位移直接写元素的行内 transform，不走响应式：这是个 3800 行的单文件组件，
// 任何一次响应式写入都会让整页重渲染（上百行账单、两个 Canvas、五个抽屉），
// 弹簧每帧写一次就等于每帧重渲染一次，抽屉会跟不上手指、点按也会变迟钝。
// 拿不到可写节点时退回响应式通道，行为一样、只是慢一点。
function applyDragOffset(px) {
  dragOffset = px
  const style = dragStyleTarget()
  if (style) {
    style.setProperty('transform', px ? `translateY(${px}px)` : '')
    return
  }
  dragY.value = px
}

// 只有走兜底通道时这里才有返回值，正常路径下恒为空，不会引起重渲染
function sheetDragStyle(name) {
  if (dragTarget.value !== name || !dragY.value) return ''
  return `transform: translateY(${dragY.value}px)`
}

function cancelDrag() {
  if (dragRaf) {
    cafFn(dragRaf)
    dragRaf = 0
  }
  const style = dragStyleTarget()
  if (style) style.setProperty('transform', '')
  dragSheetEl = null
  dragPending = ''
  dragTarget.value = ''
  dragOffset = 0
  dragY.value = 0
}

function sheetDragStart(name, event) {
  const touch = event.touches && event.touches[0]
  if (!touch || closingSheet.value || saving.value) return
  // 抓住正在回弹的抽屉要能续上：只停弹簧、保住当前位移，并把起点挪到当前位移，
  // 这样跟手是从「现在这个位置」接着走，而不是跳回目标值（apple-design §3）
  if (dragRaf) {
    cafFn(dragRaf)
    dragRaf = 0
  }
  dragPending = name
  dragStartY = touch.clientY - dragOffset
  dragHistory = [{ y: touch.clientY, t: Date.now() }]
}

function sheetDragMove(event) {
  const touch = event.touches && event.touches[0]
  if (!touch || !dragPending || closingSheet.value) return
  const raw = touch.clientY - dragStartY
  if (!dragTarget.value) {
    // 先走 8px 的滞后确认。不确认的话点一下把手也会被当成拖拽，
    // 白白掐掉还在跑的进场动画，抽屉会跳一下
    if (Math.abs(raw) < DRAG_SLOP) return
    dragTarget.value = dragPending
    dragSheetEl = sheetEls[dragPending] || null
  }
  // 往下拖 1:1 跟手；往上拖是「这里没有更多了」，按阻尼衰减，越拖越沉，不硬停
  applyDragOffset(raw >= 0 ? raw : -rubberband(-raw, systemInfo.windowHeight))
  dragHistory.push({ y: touch.clientY, t: Date.now() })
  if (dragHistory.length > 6) dragHistory.shift()
}

function sheetDragEnd() {
  dragPending = ''
  if (!dragTarget.value || closingSheet.value) return
  const velocity = sheetDragVelocity()
  // project 要的是 px/s，速度是按 px/ms 算的，这里换算一次；不换算投影就恒等于 0
  const projected = dragOffset + project(velocity * 1000)
  // 只有「往下甩」才算关闭意图；往上甩不该把它关掉
  const dismiss = dragOffset > DISMISS_DISTANCE || (velocity > DISMISS_VELOCITY && projected > 0)
  if (dismiss) dragDismiss(velocity)
  else dragReturn(velocity)
}

// 只用最近 60ms 的位移算速度。用整段会把中途的反向移动抵消掉，松手速度算出来是错的
function sheetDragVelocity() {
  if (dragHistory.length < 2) return 0
  const last = dragHistory[dragHistory.length - 1]
  let first = dragHistory[0]
  for (let i = dragHistory.length - 1; i >= 0; i -= 1) {
    if (last.t - dragHistory[i].t > 60) break
    first = dragHistory[i]
  }
  const elapsed = last.t - first.t
  return elapsed ? (last.y - first.y) / elapsed : 0
}

// Apple 的动量投影用的是指数衰减形式，不是物理课本的 v²/(2a)。
// 拿「预计落点」而不是「松手点」去判断，小动作才能有大结果——甩一下就够了。
// 量纲：velocity 必须是 px/s。0.998 的衰减率下投影系数约 499，
// 传成 px/ms 会小 1000 倍，投影等于没有
function project(velocity, deceleration = DECELERATION) {
  return ((velocity / 1000) * deceleration) / (1 - deceleration)
}

// 越界阻尼：越往外拖，跟手比例越小。东西不会「突然停住」，是先慢下来
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

function dragDismiss(velocity) {
  const name = dragTarget.value
  closingSheet.value = name
  // 减弱动画时不做整屏位移：清掉跟手位移，交给 CSS 那条纯淡出（见 reduced-motion 块里的
  // .is-closing .sheet）。1:1 跟手本身要保留——那是直接操作，不是可以省略的动画
  if (prefersReducedMotion) {
    cancelDrag()
    closeTimer = setTimeout(finishSheetClose, SHEET_EXIT_MS)
    return
  }
  // 0.8 / 0.3 是 apple-design §4 给抽屉的出厂值：甩动本身带了动量，允许一点点回弹；
  // 取消（dragReturn）不带动量，保持临界阻尼不过冲
  runSpring({
    from: dragOffset,
    to: systemInfo.windowHeight,
    velocity,
    damping: 0.8,
    response: 0.3,
    onFrame: applyDragOffset,
    onDone: finishSheetClose
  })
}

function dragReturn(velocity) {
  runSpring({
    from: dragOffset,
    to: 0,
    velocity,
    onFrame: applyDragOffset,
    onDone: cancelDrag
  })
}

// 简谐振子按帧积分。默认阻尼比 1.0 = 临界阻尼，正好停住、不过冲——apple-design 说 UI
// 默认就该是这个值。只有手势本身带了动量（甩动关闭）才降到 0.8 加一点回弹，
// 那处调用会显式传参；取消回弹不带动量，用默认值。
function runSpring({ from, to, velocity, damping = 1, response = 0.35, onFrame, onDone }) {
  const omega = (2 * Math.PI) / response
  let value = from
  let speed = velocity * 1000 // px/ms → px/s
  let previous = Date.now()
  const tick = () => {
    const now = Date.now()
    // 切后台再回来时 dt 会是个巨大的值，不夹住积分会直接炸开
    const dt = Math.min((now - previous) / 1000, 0.064)
    previous = now
    const acceleration = -omega * omega * (value - to) - 2 * damping * omega * speed
    speed += acceleration * dt
    value += speed * dt
    if (Math.abs(value - to) < 0.5 && Math.abs(speed) < 20) {
      onFrame(to)
      dragRaf = 0
      if (onDone) onDone()
      return
    }
    onFrame(value)
    dragRaf = rafFn(tick)
  }
  dragRaf = rafFn(tick)
}

async function setTrendMode(key) {
  if (trendMode.value === key) return
  trendMode.value = key
  // 换了一档，点全变了，浮标上那个点已经不存在
  clearTrendTip()
  // 开了减弱动画时不做这套收起/揭开：CSS 已经把 clip-path 的过渡关掉了，
  // 收起和放开都成了瞬时的，用户看到的是折线先消失再出现的一下闪烁——比硬切更糟。
  // 单张 canvas 也做不了交叉淡化（从 0 淡入会闪出「空图」），所以直接换数据，
  // 这就是 §14 说的 static transition
  if (prefersReducedMotion) {
    await nextTick()
    await renderCharts()
    return
  }
  // 先在收起状态下把新数据画好，再放开让 clip-path 过渡把它从 x 轴揭开，
  // 用户看不到数据跳变
  trendRising.value = true
  await nextTick()
  await renderCharts()
  releaseTrendRise()
}

// 放开要等一个帧边界，否则两次样式会被合成一次、过渡不触发。
// 后台时 rAF 会挂起，所以再挂一个定时器兜底，别让折线永远卡在收起状态。
function releaseTrendRise() {
  const release = () => {
    trendRising.value = false
  }
  rafFn(release)
  setTimeout(release, 220)
}

function shiftMonth(monthText, delta) {
  const [year, month] = monthText.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function openCreate() {
  const now = new Date()
  editingId.value = null
  form.type = 'expense'
  form.amount = ''
  form.category = 'food'
  form.note = getAutoNote('food', now)
  form.date = getToday()
  form.month = getToday().slice(0, 7)
  form.refunded = false
  form.is_private = false
  noteTouched.value = false
  editorVisible.value = true
  // 等抽屉滑上来再聚焦，否则键盘会在动画中途弹出来。
  // 必须带守卫：抽屉关掉后有 220ms 还在 DOM 里（退场动画），这个定时器会晚到，
  // 把键盘弹在一个正在滑走的弹层上
  setTimeout(() => {
    if (!editorVisible.value || closingSheet.value) return
    amountFocused.value = true
  }, 120)
}

function openEdit(item) {
  editingId.value = item.id
  form.type = item.type
  form.amount = String(item.amount)
  form.category = item.category
  form.note = item.note
  form.date = item.date
  form.month = item.month
  form.refunded = item.refunded
  form.is_private = item.is_private
  // 编辑既有账目：备注是用户自己的，任何时候都不自动覆盖
  noteTouched.value = true
  amountFocused.value = false
  editorVisible.value = true
}

function closeEditor() {
  amountFocused.value = false
  closeSheet('editor')
}

// 只给「写操作成功了」这一个时刻加触感：保存、删除。
// apple-design §13 的 utility 规则——到处都振会训练用户忽略它，那样还不如不振。
function commitFeedback() {
  uni.vibrateShort({ type: 'light' })
}

// 收入没有分类、没有具体日期（只有月份）、不能退款；切回支出时把残留的
// 'income' 分类换回真实分类，否则饼图里会多出一个「收入」扇区。
function setFormType(type) {
  if (form.type === type) return
  form.type = type
  if (type === 'income') {
    form.refunded = false
    // 支出默认预填的「午饭/夜宵」不是收入该有的备注，没手动改过就清掉
    // （只按「有没有手动改过」判断，不再拿「此刻的自动备注」去比——不同时刻比对不上会漏清）
    if (!noteTouched.value) form.note = ''
    if (!form.month) form.month = String(form.date || today.value).slice(0, 7)
  } else {
    if (!form.category || form.category === 'income') form.category = 'food'
    // 收入的日期只是留痕（月份以 month 列为准），切回支出时把日期收进这个月里，
    // 免得出现「浏览 8 月却显示 9月22日」这种对不上的行
    const day = Number(String(form.date).slice(8, 10)) || 1
    const [year, month] = String(form.month || today.value.slice(0, 7)).split('-').map(Number)
    const safeDay = Math.min(Math.max(day, 1), new Date(year, month, 0).getDate())
    form.date = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
  }
}

// 用户手动打过的备注不能被选分类悄悄清掉：只有备注还是自动填的那句（或为空）时才覆盖
function onNoteInput() {
  noteTouched.value = true
}

function selectCategory(key) {
  if (form.type === 'income') return
  form.category = key
  if (!noteTouched.value) form.note = getAutoNote(key, new Date())
}

function onPrivateChange(event) {
  form.is_private = event.detail.value
}

// 上限年只给到上限月，之前的年份都是完整的 12 个月
function lastMonthOf(year) {
  return year === dateLimit.value.year ? dateLimit.value.month : 12
}

// 不再按「今天」截断当月天数：允许记未来日期（记下个月的生活费就是靠这个）
function lastDayOf(year, month) {
  return new Date(year, month, 0).getDate()
}

function openDatePicker() {
  if (form.type === 'income') {
    const [year, month] = String(form.month || today.value.slice(0, 7)).split('-').map(Number)
    const yearIndex = dateYearOptions.value.indexOf(year)
    const safeYear = yearIndex < 0 ? dateYearOptions.value.length - 1 : yearIndex
    const safeMonth = Math.min(Math.max(month, 1), lastMonthOf(dateYearOptions.value[safeYear])) - 1
    datePickerIndexes.value = [safeYear, safeMonth, 0]
    datePickerVisible.value = true
    return
  }
  const [year, month, day] = String(form.date || today.value).split('-').map(Number)
  const yearIndex = dateYearOptions.value.indexOf(year)
  const safeYear = yearIndex < 0 ? dateYearOptions.value.length - 1 : yearIndex
  const safeMonth = Math.min(Math.max(month, 1), lastMonthOf(dateYearOptions.value[safeYear])) - 1
  const safeDay =
    Math.min(Math.max(day, 1), lastDayOf(dateYearOptions.value[safeYear], safeMonth + 1)) - 1
  datePickerIndexes.value = [safeYear, safeMonth, safeDay]
  datePickerVisible.value = true
}

function closeDatePicker() {
  closeSheet('date')
}

function onDateWheelChange(event) {
  const [yearIndex, monthIndex, dayIndex] = event.detail.value
  const year = dateYearOptions.value[yearIndex]
  const month = Math.min(monthIndex + 1, lastMonthOf(year))
  const day = Math.min((dayIndex ?? 0) + 1, lastDayOf(year, month))
  datePickerIndexes.value = [yearIndex, month - 1, day - 1]
}

function confirmDatePicker() {
  const year = dateYearOptions.value[datePickerIndexes.value[0]]
  const month = dateMonthOptions.value[datePickerIndexes.value[1]]
  if (form.type === 'income') {
    form.month = `${year}-${String(month).padStart(2, '0')}`
    closeSheet('date')
    return
  }
  const day = dateDayOptions.value[datePickerIndexes.value[2]]
  form.date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // 月份也要跟着走：收入的入库月份只认 form.month，不更新的话「支出里挑了下个月 →
  // 切成收入 → 保存」会把这笔收入记到上个月
  form.month = `${year}-${String(month).padStart(2, '0')}`
  closeSheet('date')
}

function onRefundChange(event) {
  form.refunded = event.detail.value
}

async function submitEditor() {
  if (saving.value || saveDone.value) return
  const amountText = String(form.amount).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
    uni.showToast({ title: amountText ? '金额最多两位小数' : '先填写金额', icon: 'none' })
    return
  }
  const amount = round2(amountText)
  if (!(amount > 0)) {
    uni.showToast({ title: '金额需要大于 0', icon: 'none' })
    return
  }

  const existing = editingId.value ? allBills.value.find((item) => item.id === editingId.value) : null
  const incomeMode = form.type === 'income'
  const month = incomeMode ? form.month || today.value.slice(0, 7) : String(form.date).slice(0, 7)
  const payload = {
    amount,
    type: form.type,
    // 收入也把原有的分类留着：这样「支出→收入→支出」来回一趟，分类和日期都还在
    category: incomeMode ? (existing ? existing.category : 'income') : form.category,
    note: String(form.note || '').trim(),
    // 收入没有具体日期，新记的一律落在当月 1 号；但把已有支出改成收入时要保留它原本的
    // 日期，否则「支出→收入→支出」一趟下来原始哪天就被 1 号覆盖掉了
    date: incomeMode ? (existing ? existing.date : `${month}-01`) : form.date,
    month,
    timestamp: existing ? existing.timestamp : Date.now(),
    refunded: incomeMode ? false : form.refunded,
    is_private: form.is_private
  }

  saving.value = true
  try {
    if (editingId.value) await updateBill(editingId.value, payload)
    else await addBill(payload)
  } catch (error) {
    // 撞上指纹唯一索引时 addBill 会 reject，不能让它变成无声的未处理异常
    console.error('保存账单失败', error)
    saving.value = false
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
    return
  }
  saving.value = false

  // 成功态：先把按钮切成 ✓ 已保存，停 520ms 再收抽屉。这一下停顿是「确认收到了」，
  // 比抽屉瞬间消失 + 弹 toast 更像人手按完等回执。减弱动画的用家不等，直接关
  commitFeedback()
  saveDone.value = true
  if (!prefersReducedMotion) {
    await new Promise((resolve) => setTimeout(resolve, 520))
  }
  saveDone.value = false

  closeEditor()
  currentMonth.value = payload.month
  await loadData()
}

function removeBill(item) {
  uni.showModal({
    title: '删除账单',
    content: `确定删除“${item.note || item.categoryName}”吗？`,
    success: async (result) => {
      if (!result.confirm) return
      try {
        await deleteBill(item.id)
      } catch (error) {
        console.error('删除账单失败', error)
        uni.showToast({ title: '删除失败，请重试', icon: 'none' })
        return
      }
      commitFeedback()
      await loadData()
      uni.showToast({ title: '已删除', icon: 'success' })
    }
  })
}

function toggleSelection() {
  if (selectionMode.value) exitSelection()
  else {
    selectionMode.value = true
    selectedIds.value = []
  }
}

function exitSelection() {
  selectionMode.value = false
  selectedIds.value = []
}

function enterSelection(item) {
  if (!selectionMode.value) {
    selectionMode.value = true
    selectedIds.value = [item.id]
    return
  }
  toggleSelected(item.id)
}

function handleBillTap(item) {
  if (selectionMode.value) toggleSelected(item.id)
  else openEdit(item)
}

function toggleSelected(id) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
  } else {
    selectedIds.value = selectedIds.value.concat(id)
  }
}

function isSelected(id) {
  return selectedIds.value.includes(id)
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : visibleBills.value.map((item) => item.id)
}

function deleteSelected() {
  if (!selectedIds.value.length) return
  const ids = selectedIds.value.slice()
  uni.showModal({
    title: '批量删除',
    content: `确定删除选中的 ${ids.length} 笔账单吗？`,
    success: async (result) => {
      if (!result.confirm) return
      try {
        await deleteBills(ids)
      } catch (error) {
        console.error('批量删除失败', error)
        uni.showToast({ title: '删除失败，请重试', icon: 'none' })
        return
      }
      commitFeedback()
      exitSelection()
      await loadData()
      uni.showToast({ title: '已删除', icon: 'success' })
    }
  })
}

function openSettings() {
  settingsVisible.value = true
}

function openDisplayLedger() {
  if (switching.value) return
  // 按下就换状态（底涨满 + 图标滑出 + 圆环滑入），120ms 后把页面推过去。
  // 120ms 是「看得出在转」和「不用等」的中间值：圆环 380ms 一圈，这期间转约 1/3 圈；
  // 再短（80ms）只能看到一帧静止的圆环，反而像卡住
  switching.value = true
  setTimeout(() => {
    uni.navigateTo({ url: '/pages/display/display' })
    // 等新页面完全盖住再复位，否则会在本页闪一下白底
    setTimeout(() => {
      switching.value = false
    }, 420)
  }, 120)
}

function closeSettings() {
  closeSheet('settings')
}

function onTrendCountChange(key, event) {
  const value = clampTrendCount(key, event.detail.value)
  if (trendCounts[key] === value) return
  trendCounts[key] = value
  uni.setStorageSync('jianji_trend_counts', {
    year: trendCounts.year,
    month: trendCounts.month,
    day: trendCounts.day
  })
  scheduleChartRender()
}

function selectHidePrivate(event) {
  hidePrivate.value = event.detail.value
  uni.setStorageSync('jianji_hide_private', hidePrivate.value)
  // 屏幕上的行会变少，先退出多选，避免「删除选中」删掉看不见的私人账目
  if (selectionMode.value) exitSelection()
  loadData()
}

function selectTheme(key) {
  theme.value = key
  uni.setStorageSync('jianji_theme', key)
  scheduleChartRender()
}

function openExport() {
  settingsVisible.value = false
  exportConfig.scopeMonth = exportConfig.scopeMonth || currentMonth.value
  exportConfig.scopeDate = exportConfig.scopeDate || today.value
  exportVisible.value = true
}

function closeExport() {
  if (exporting.value) return
  closeSheet('export')
}

function setExportValue(key, value) {
  exportConfig[key] = value
  saveExportConfig()
}

function toggleExportValue(key) {
  exportConfig[key] = !exportConfig[key]
  saveExportConfig()
}

function saveExportConfig() {
  const config = { ...exportConfig }
  delete config.scopeMonth
  delete config.scopeDate
  uni.setStorageSync('jianji_export_config', config)
}

function onExportMonthChange(event) {
  setExportValue('scopeMonth', event.detail.value)
}

function onExportDateChange(event) {
  setExportValue('scopeDate', event.detail.value)
}

async function confirmExport() {
  if (exporting.value) return

  let list
  let label
  if (exportConfig.scope === 'pickMonth') {
    list = allBills.value.filter((item) => item.month === exportConfig.scopeMonth)
    label = exportConfig.scopeMonth
  } else if (exportConfig.scope === 'day') {
    list = allBills.value.filter((item) => item.date === exportConfig.scopeDate)
    label = exportConfig.scopeDate
  } else {
    list = bills.value
    label = currentMonth.value
  }

  // 导出是给小程序解析的：私人账目和收入都不进文本，且必须在判空之前过滤，
  // 否则「当天只有收入」会复制出一段总支出 0.00 的空文本
  list = filterVisibleBills(list, true).filter(isExpense)

  if (!list.length) {
    uni.showToast({ title: '这个范围没有账单', icon: 'none' })
    return
  }

  const text = buildExportText(label, list, getCategoryStats(list), exportConfig)
  if (!text) {
    uni.showToast({ title: '至少保留一个导出字段', icon: 'none' })
    return
  }

  exporting.value = true
  try {
    uni.setClipboardData({
      data: text,
      success: () => {
        closeSheet('export')
        uni.showToast({ title: '账单已复制', icon: 'success' })
      },
      fail: () => uni.showToast({ title: '复制失败，请重试', icon: 'none' }),
      complete: () => {
        exporting.value = false
      }
    })
  } catch (error) {
    exporting.value = false
    console.error('导出账单失败', error)
  }
}

function openImport() {
  settingsVisible.value = false
  importText.value = ''
  importVisible.value = true
  readClipboard(true)
}

function closeImport() {
  if (importBusy.value) return
  closeSheet('import')
}

function readClipboard(silent = false) {
  uni.getClipboardData({
    success: (result) => {
      const text = String(result.data || '')
      if (!text) {
        if (!silent) uni.showToast({ title: '剪贴板为空', icon: 'none' })
        return
      }
      importText.value = text
      if (!silent) uni.showToast({ title: '已读取剪贴板', icon: 'success' })
    },
    fail: () => {
      if (!silent) uni.showToast({ title: '没有剪贴板权限，请手动粘贴', icon: 'none' })
    }
  })
}

async function confirmImport() {
  if (importBusy.value) return
  const text = importText.value.trim()
  if (!text) {
    uni.showToast({ title: '先粘贴账单文本', icon: 'none' })
    return
  }

  const parsed = parseMiniProgramBillText(text)
  if (!parsed.bills.length) {
    uni.showModal({
      title: parsed.noDetail ? '这段文本里没有明细' : '没有识别到账单',
      content: parsed.noDetail
        ? '导出的文本里没有「── 明细 ──」那一段。请回到小程序，把「明细」的几个字段至少打开一个，再重新复制。'
        : '请在小程序里重新点击“复制账单”，再粘贴完整内容。',
      showCancel: false
    })
    return
  }

  importBusy.value = true
  try {
    const result = await importBills(parsed.bills)
    currentMonth.value = parsed.month
    await loadData()
    importVisible.value = false
    const invalidText = parsed.invalid.length ? `，忽略 ${parsed.invalid.length} 条重复或异常的明细` : ''
    // 更新是「同一时间改动过的账单被覆盖」，为 0 时不显示，免得每次导入都多一句没用的
    const updatedText = result.updated ? `，更新 ${result.updated} 条` : ''
    uni.showModal({
      title: '导入完成',
      content: `成功导入 ${result.added} 条${updatedText}，跳过 ${result.skipped} 条已有账单${invalidText}。`,
      showCancel: false
    })
  } catch (error) {
    console.error('导入账单失败', error)
    uni.showModal({
      title: '导入失败',
      content: '账单文本可能不完整，请重新从小程序复制后重试。',
      showCancel: false
    })
  } finally {
    importBusy.value = false
  }
}
</script>

<style scoped>
button {
  margin: 0;
  padding: 0;
  line-height: 1;
  box-sizing: border-box;
}

button::after {
  border: 0;
}

/* 按下反馈走 .button-hover 而不是 :active：uni-app 在 touchstart 时挂这个类，
   而 WebView 里 <button> 的 :active 并不可靠。过渡必须挂在 button 基类上——
   挂在 .button-hover 上的话，松手时类被摘掉、过渡也跟着没了，回弹会硬切。
   松手这半程用一条带轻微过冲的曲线（0.34,1.4,0.64,1）：缩小之后弹回原位时
   多走一点点再落定，手感才像「按下去又弹回来」，而不是匀速回放 */
button {
  transition: transform 120ms cubic-bezier(0.34, 1.4, 0.64, 1);
}

/* uni-app 自带 .button-hover{background:#dedede;color:rgba(0,0,0,.6)}，按下时会在
   手指位置闪一块灰（透明分段按钮上尤其难看）。按下只做形变，不做变淡——
   之前还叠了 opacity:.72，小字压到七成会发虚，看着像加载中而不是被按下 */
.button-hover {
  background-color: transparent;
  color: inherit;
  transform: scale(0.96);
}

/* 按下那一刻必须 0ms 就位。过渡只负责「松手回弹」那半程，留在各按钮的基类上；
   这一条比 .batch-secondary 之类的单类选择器多一个元素名，特异性更高，
   所以按下时一律瞬时——apple-design §1：反馈延迟一出现，直接感就没了 */
button.button-hover {
  transition: none;
}

/* 主题令牌（.page 与四个主题块）在 App.vue 的全局 style 里——展示账本是独立页面，
   scoped 样式过不去。这里不要再写一份，两边会不一致。 */

/* ---------- 排印：字距与行高按字号分档 ---------- */

/* 一个字距值打天下必然在某档出错：字号越大，同样的字距在视觉上被放得越大，得往回收；
   小字相反，松开一点更好认。这是 apple-design §15 的核心。
   两类元素不参与：① 纯符号（‹ › ⚙ × ＋ emoji）没有字距可言，加了只会被挤出中心；
   ② 图表里的数值和标签——那几处的间距是量过像素、做过避让的，一动就可能重新叠字。 */
.page-title,
.sheet-title,
.amount-prefix,
.amount-input {
  letter-spacing: -0.02em;
}

.month-title,
.section-title,
.summary-currency {
  letter-spacing: -0.01em;
}

.month-sub,
.metric-label,
.section-sub,
.segment-button,
.empty-sub,
.bill-meta,
.refund-tag,
.sheet-sub,
.category-option-name,
.theme-option {
  letter-spacing: 0.01em;
}

/* 行高随字号反向：大字收紧，否则一行的字看着散；正文和说明放松，中文尤其需要 */
.page-title,
.sheet-title,
.empty-title {
  line-height: 1.2;
}

.sheet-sub,
.empty-sub,
.field-error {
  line-height: 1.45;
}

.shell {
  width: 100%;
  max-width: 840px;
  margin: 0 auto;
  padding: 0 var(--sp-6) 200rpx;
  box-sizing: border-box;
}

/* 翻月：新内容从对应方向滑进来。整屏只有一个 shell，翻页感靠位移 + 淡入做出来。
   翻月是浏览行为（一天可能几十次），按 apple-design §1 的频率规则它本就不该怎么动，
   所以时长压到 140ms、位移只有 24rpx——幅度一大就变成「整屏在飞」，越快越像卡顿。
   keyframe 中途改不了向，连按只能重放；换成弹簧要逐帧给整页 shell 写 transform，
   在这个 WebView 上比一条 140ms 的 keyframe 更糟，所以保持 keyframe。 */
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

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--sp-3);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  min-width: 0;
}

.date-copy {
  display: flex;
  flex-direction: column;
}

/* 顶栏这两行的行高是写死的，不是随手填的：展示页顶栏那块文字（标题 + 副标题）
   要跟这里一样高（34 + 4 + 56 = 94rpx），⇋ 在两边按居中算出来才落在同一个 y。
   默认行高随字体变（中文字体的 normal 能差出 4-6rpx），写死才能保证两边一致 */
.date-label {
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  line-height: 34rpx;
}

.page-title {
  margin-top: var(--sp-1);
  color: var(--text-strong);
  font-size: var(--fs-xl);
  font-weight: var(--fw-black);
  line-height: 56rpx;
}

/* 真实账本 / 展示账本是同一本账的两面。这个 ⇋ 在两个页面上都是顶栏最左的那个按钮，
   位置、尺寸完全一致——位置会跑的话就不像同一个开关了。
   点了翻到另一面，页面上只做淡入淡出（pages.json 里 animationType: fade-in），
   没有左右翻页。展示账本页里这份是各写一份的，改这里记得两边一起改 */
.side-toggle {
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
  /* 不写 overflow: hidden——那会把 ::after 撑出来的 88rpx 命中区裁到 64rpx 里。
     ::before 用 inset:0 就铺满，本来也不会溢出 */
  isolation: isolate;
}

/* 按下时底色从中心涨满（MicroKit 的 dot-fill）。它和图标滑出、圆环滑入
   在同一条时间线上一起发生，所以 80ms 就够「有反应」，不必等动画播完 */
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

/* 双向箭头用 CSS 画，不用字符 ⇋（U+21CB）：那个字形手机字体里没有，
   回退字体画出来是两条断开、错位的横线，对不准中线。
   这里改成「两页纸叠在一起」——它说的是「有两份账」，比双向箭头只说「切」更具体，
   也和「展示账本是镜像副本」的语义对得上 */
.side-toggle-icon {
  position: relative;
  z-index: 1;
  display: block;
  width: 34rpx;
  height: 32rpx;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease-out;
}

/* 图标向左滑出并淡掉，和 MicroKit 里「原文字 translate-x + opacity 0」同一手法 */
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

/* 后面那页只描边、压暗，撑出层次。往外错 2rpx 让它在小尺寸下也露得出来
   （34rpx 的图标里，两页各 22rpx，重叠太多就只剩一个色块了） */
.side-sheet.is-back {
  top: -2rpx;
  right: -2rpx;
  border: 3rpx solid currentColor;
  opacity: 0.55;
}

/* 前面那页实心，视线落在它上面 */
.side-sheet.is-front {
  left: 0;
  bottom: 0;
  background: currentColor;
}

/* 点下去按钮里转圈，直到页面切完。它说明的不是「你按到了」，
   而是「正在过去」——和底色涨满、图标滑出同步发生，三样一起动才够有反应 */
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
  /* 旋转必须用独立的 rotate 属性，不能写进 transform：
     关键帧里的 transform 会盖掉这里做位移的那条，圆环就卡在原地不转了 */
  animation: sideSpin 380ms linear infinite;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease-out;
}

/* 从右侧滑入，比图标晚 50ms 起步，交接时两个元素不会挤在中间 */
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

/* 转圈时不要缩放，圆环会被压扁 */
.side-toggle.is-switching {
  transform: none;
  color: var(--on-accent);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.text-action,
.round-action {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  border-radius: var(--r-md);
  background: var(--surface);
  /* 内描边代替 border + 外阴影：MicroKit 的按钮就是这一层 1px 描边，
     外面不挂影子。border 会参与布局、还会在某些 DPR 下虚成两条 */
  box-shadow: inset 0 0 0 1rpx var(--line);
  color: var(--text);
}

.text-action {
  min-width: 84rpx;
  padding: 0 var(--sp-4);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.text-action.active {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent-deep);
}

.round-action {
  width: 64rpx;
  font-size: var(--fs-md);
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--sp-5);
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
}

.month-sub {
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-pill);
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
}

.summary-panel {
  margin-top: var(--sp-6);
  padding: var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow);
  /* 这里原来挂了 blur(20px) saturate(180%) 的毛玻璃。MicroKit 全站不用毛玻璃：
     卡片就靠 1px 描边 + 一层紧影立起来。去掉之后字更实、滚动也不再每帧重做模糊 */
}

.summary-label {
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.summary-amount {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

/* 超支/剩余靠右，跟 hero 金额同一条基线 */
.summary-balance {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  white-space: nowrap;
}

.summary-balance.is-left {
  color: var(--positive-text);
}

.summary-balance.is-over {
  color: var(--danger-text);
}

.summary-income {
  margin-top: var(--sp-4);
}

.summary-currency.is-income,
.summary-number.is-income {
  color: var(--positive-text);
}

.summary-number.is-income {
  font-size: var(--fs-xl);
}

.summary-currency {
  color: var(--accent-deep);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heavy);
}

.summary-number {
  color: var(--text-strong);
  font-size: var(--fs-hero);
  font-weight: var(--fw-black);
  line-height: 1.1;
  letter-spacing: -0.02em;
  /* hero 是展示数字不是表格列：等宽字面会把「1」撑进整格，出现空洞，这里单独回到比例字宽 */
  font-variant-numeric: proportional-nums;
}

/* 摘要里的笔数/日均用分隔线分栏，不再套一层小卡片 */
.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: var(--sp-5);
  padding-top: var(--sp-4);
  border-top: 1rpx solid var(--line);
}

.metric-item {
  display: flex;
  align-items: baseline;
  min-width: 0;
  gap: var(--sp-2);
}

.metric-item + .metric-item {
  padding-left: var(--sp-5);
  border-left: 1rpx solid var(--line);
}

.metric-label {
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
}

.metric-value {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
}

.section {
  margin-top: var(--sp-7);
}

.section-heading {
  display: flex;
  /* 以前是 flex-end：标题下面还有一行小字时，靠底对齐正好和右边的分段控件齐平。
     小字去掉后只剩一行标题，flex-end 会把它贴到分段控件底边、显得偏下，
     改回居中才平衡 */
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  margin-bottom: var(--sp-4);
}

.section-title {
  display: block;
  color: var(--text-strong);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heavy);
}

.section-sub {
  display: block;
  margin-top: var(--sp-1);
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-body);
}

.segment {
  position: relative;
  display: flex;
  padding: var(--sp-1);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  /* gap 必须是 0：高亮块按段数等分来算宽，有 gap 就对不齐（按钮没底色，看不出区别） */
  gap: 0;
}

.segment.wide {
  width: 100%;
  box-sizing: border-box;
}

/* 高亮块自己会滑：切换年/月/日、支出/收入时左右平移，不再整块跳。
   参考 MicroKit 的分段控件——指示器是品牌色实心块，文字在块上转白；
   原来是白块 + 阴影，和底槽的对比只有一点点，看起来像「没选中」 */
.segment-thumb {
  position: absolute;
  top: var(--sp-1);
  bottom: var(--sp-1);
  left: var(--sp-1);
  border-radius: var(--r-sm);
  background: var(--btn-to);
  box-shadow: 0 2rpx 6rpx rgba(103, 65, 81, 0.18);
  pointer-events: none;
  transition: transform 280ms var(--ease-out);
}

.segment-button {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 62rpx;
  /* 视觉高度 48rpx（≈31px，iPhone 分段控件的尺寸）。44px 触摸硬线改由下面的
     ::after 纵向撑出来——段与段之间 gap=0，只能纵向撑，横向撑会串到隔壁那一段 */
  min-height: 48rpx;
  padding: 0 var(--sp-4);
  border-radius: var(--r-sm);
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
}

/* 命中区只上下扩：左右各占各段，不越界。上下各溢出 12rpx 左右，落在
   section-heading 的 16rpx 间距和 trend-panel 的 24rpx 内边距里，
   碰不到上面的小标题，也碰不到下面的折线图 */
.segment-button::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 88rpx;
  transform: translateY(-50%);
}

.segment-button.active {
  color: var(--on-accent);
  font-weight: var(--fw-heavy);
  transition: color 200ms var(--ease-soft);
}

.trend-panel,
.distribution-panel {
  position: relative;
  padding: var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow);
  /* 这两个面板处在页面的原生滚动流里，加 backdrop-filter 会让每一帧滚动都重做一次
     全宽模糊。明细卡片当初就是为了这个没加，规则得一致——材料只给真正浮在内容之上的层
     （遮罩、抽屉、批量栏）和唯一那个摘要面板 */
}

.trend-chart-wrap,
.pie-chart-wrap {
  position: relative;
  width: 100%;
  overflow: visible;
}

/* 临时探针，验完就删 */
/* 手势命中层：透明、只盖住圆盘。border-radius 让椭圆外的矩形角落不吃触摸，
   WebView 的命中测试认这个 */
.pie-hit {
  position: absolute;
  z-index: 2;
  border-radius: 50%;
}

.trend-chart-svg,
.pie-chart-svg {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* 切换年/月/日：折线从 x 轴那条线往上「揭开」，文字和圆点随后淡入。
   注意只能用 clip-path，不能用 transform: scaleY(0)——后者会改变
   boundingClientRect 量到的高度，绘制前的 height > 0 守卫会把整张图跳过，
   画布就永远是空的（切换时切到后台还会把它永久卡在收起状态）。 */
.trend-chart-svg {
  transition: clip-path 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.trend-chart-wrap.is-rising .trend-chart-svg {
  transition: none;
}

.trend-point-marker,
.trend-point-label,
.trend-axis-value {
  /* 「线先起、点后跟」这个层次要留，但和 0.28s 的揭开叠加后不能超过 300ms，
     所以延迟压到 80ms、淡入压到 200ms */
  transition: opacity 0.2s ease-out 0.08s;
}

.trend-chart-wrap.is-rising .trend-point-marker,
.trend-chart-wrap.is-rising .trend-point-label,
.trend-chart-wrap.is-rising .trend-axis-value {
  opacity: 0;
  transition: none;
}

.trend-point-marker {
  position: absolute;
  z-index: var(--z-point);
  width: 16rpx;
  height: 16rpx;
  border: 3rpx solid var(--surface-strong);
  border-radius: 50%;
  background: var(--accent);
  box-sizing: border-box;
  transform: translate(-50%, -50%);
}

.trend-point-marker.active {
  width: 24rpx;
  height: 24rpx;
  background: var(--accent-deep);
  /* 先写不透明兜底：color-mix() 需要 Chrome 111+，不支持时整条声明被丢弃、这圈环会消失 */
  box-shadow: 0 0 0 5rpx var(--accent-soft);
  box-shadow: 0 0 0 5rpx color-mix(in srgb, var(--accent) 22%, transparent);
}

/* 手指正在指的那个点：比「今天」那个活动点再大一圈，一眼分得清哪个是被选中的 */
.trend-point-marker.is-tip {
  width: 26rpx;
  height: 26rpx;
  background: var(--accent-deep);
  box-shadow: 0 0 0 6rpx var(--accent-soft);
  box-shadow: 0 0 0 6rpx color-mix(in srgb, var(--accent) 26%, transparent);
}

/* 触摸点的竖线，只画绘图区那一段，不穿到下面的日期标签上 */
.trend-tip-guide {
  position: absolute;
  z-index: var(--z-point);
  width: 1rpx;
  background: var(--accent);
  opacity: 0.35;
  transform: translateX(-50%);
}

.trend-tip {
  position: absolute;
  z-index: var(--z-label);
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--surface-strong);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow);
  white-space: nowrap;
  /* nowrap 够不到内部的 <text>（uni-text 自带 white-space，直接声明胜过继承），
     所以还得自己定宽：绝对定位元素的 shrink-to-fit 会按「图宽 − left」算可用宽，
     浮标贴右半边时被压到 min-content、明细折行 */
  width: max-content;
  max-width: 100%;
}

.trend-tip-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}

.trend-tip-date {
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

.trend-tip-value {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
}

.trend-tip-detail {
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

.trend-point-label {
  position: absolute;
  z-index: var(--z-label);
  white-space: nowrap;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.trend-point-label.active {
  color: var(--accent-deep);
  font-weight: var(--fw-bold);
}

.trend-point-label {
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-body);
}

/* Y 轴刻度：数值直接标在轴上，不给每个点单标（点数最多 30 个，逐点标必叠） */
.trend-axis-value {
  position: absolute;
  z-index: var(--z-label);
  color: var(--text-soft);
  font-size: var(--fs-2xs);
  font-weight: var(--fw-body);
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
}

.pie-legend-row {
  position: absolute;
  right: 1%;
  /* 56% 而不是 52%：饼图放大到半径 96 后最右（含选中块外弹 14）到 200，这里从 202 开始。
     再往左一行字就放不下「分类名 + 百分比 + 金额」三样，名字会被省略成 … */
  left: 56%;
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--sp-2);
  transform: translateY(-50%);
  transform-origin: left center;
  white-space: nowrap;
  /* 每一行的倾斜和纵向压扁由 JS 按它在圆盘平面上的角度算好，写在行内 style 里 */
  /* top 每帧都在跟着手指改，这里绝不能给 transition——160ms 的过渡会让整列
     追不上饼的旋转，看起来像拖着一串残影。只有淡入淡出还是软的 */
  transition: opacity 140ms ease-out;
}

/* 转到 3 点方向的那一项：加粗、深色，并且是唯一显示百分比和金额的 */
.pie-legend-row.is-selected .pie-label-name {
  color: var(--text-strong);
  font-weight: var(--fw-heavy);
  font-size: var(--fs-sm);
}

.pie-legend-dot {
  flex: 0 0 auto;
  width: 15rpx;
  height: 15rpx;
  border-radius: 50%;
  box-shadow: inset 0 -3rpx 0 rgba(0, 0, 0, 0.14);
}

.pie-label-name {
  /* 别写 flex: 1：那样它会被压到 0 宽、名字直接变成「…」。
     名字是这一行的主信息，缩也是最后才缩它 */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-overflow: ellipsis;
  /* 必须显式写：uni-app 的 <text> 自带 white-space，继承不到父容器的 nowrap，
     导致中文在字与字之间断行（金额一长「约会」就折成两行）。同 .bill-title 的写法 */
  white-space: nowrap;
}

/* 小块只留名字：字小一号、颜色退一档，右侧不再出现百分比和金额，
   视觉上自然把注意力让给上面那几块大的 */
.pie-legend-row.is-minor .pie-label-name {
  color: var(--text-soft);
  font-size: var(--fs-2xs);
  font-weight: var(--fw-medium);
}

.pie-legend-row.is-minor .pie-legend-dot {
  opacity: 0.7;
}

.pie-label-meta {
  flex: 0 0 auto;
  color: var(--text-soft);
  font-size: var(--fs-2xs);
  font-weight: var(--fw-medium);
}

.pie-label-amount {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-strong);
  font-size: var(--fs-xs);
  font-weight: var(--fw-heavy);
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-7) var(--sp-6);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx dashed var(--line);
  flex-direction: column;
  text-align: center;
}

.empty-title {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
}

.empty-sub {
  margin-top: var(--sp-2);
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-body);
}

.bill-heading {
  margin-bottom: var(--sp-3);
}

.text-button {
  padding: var(--sp-3) 0 var(--sp-1) var(--sp-4);
  color: var(--accent-deep);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

/* 一天一张卡，组内每笔之间用分隔线，不再逐笔描边成卡片 */
.bill-groups {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.bill-group {
  overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1rpx solid var(--line);
  box-shadow: var(--shadow);
}

.group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  background: var(--surface-soft);
  border-bottom: 1rpx solid var(--line);
}

.group-date {
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.group-total {
  color: var(--accent-deep);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.group-total.is-income {
  color: var(--positive-text);
}

.bill-item {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 96rpx;
  /* 上下从 sp-4 收到 sp-3：一行账单本来就靠图标和文字撑高，
     16rpx 的上下内距只会让列表变松。右侧留 74rpx 给删除按钮 */
  padding: var(--sp-3) 74rpx var(--sp-3) var(--sp-4);
  transition: background-color 0.15s ease;
}

.bill-item + .bill-item {
  border-top: 1rpx solid var(--line);
}

.bill-item:active {
  background: var(--surface-soft);
  /* 高亮瞬间就位；基类那条 150ms 只负责松手时慢慢褪掉 */
  transition: none;
}

.bill-item.selected {
  background: var(--accent-soft-2);
}

.select-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42rpx;
  height: 42rpx;
  margin-right: var(--sp-4);
  border-radius: 50%;
  border: 2rpx solid var(--line);
  color: transparent;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.select-dot.active {
  border-color: var(--btn-from);
  background: var(--btn-from);
  color: var(--on-accent);
}

.bill-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  flex: 0 0 72rpx;
  border-radius: var(--r-md);
  font-size: var(--fs-lg);
}

.bill-main {
  display: flex;
  flex: 1;
  min-width: 0;
  margin-left: var(--sp-4);
  flex-direction: column;
}

.bill-title {
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bill-meta {
  margin-top: var(--sp-2);
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-body);
}

.bill-amount-wrap {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  flex-shrink: 0;
}

.bill-amount {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
}

.bill-amount.is-income {
  color: var(--positive-text);
}

.bill-amount.refunded {
  color: var(--text-soft);
  text-decoration: line-through;
}

.refund-tag {
  margin-top: var(--sp-1);
  color: var(--text-soft);
  font-size: var(--fs-2xs);
}

.delete-button {
  position: absolute;
  right: var(--sp-4);
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42rpx;
  height: 42rpx;
  margin-top: -21rpx;
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: var(--fs-md);
  transition: transform 120ms ease-out, background-color 120ms ease-out;
}

/* 删除按钮按下时直接变红：手指一碰就知道「这是会删东西的那颗」，
   比整行缩放更明确，也不会带动旁边金额 */
.delete-button.button-hover {
  background: var(--danger-from);
  color: var(--on-danger);
  transform: scale(0.88);
}

.add-button,
.batch-bar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--sp-6) + env(safe-area-inset-bottom));
  z-index: var(--z-fab);
  max-width: calc(100% - var(--sp-7));
  box-sizing: border-box;
}

/* 注意：不要再写 position: relative。定位来自上面 .add-button, .batch-bar 那条
   共享规则里的 position: fixed——按钮要永远贴在屏幕底部（和展示账本的「新增虚拟账单」
   一样），一写 relative 就退化成「跟着页面流走、停在文档最底下」。
   fixed 本身就会给 ::before 当定位基准，不需要 relative */
.add-button {
  isolation: isolate;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 286rpx;
  height: 92rpx;
  margin-left: -143rpx;
  border-radius: var(--r-pill);
  /* 白底 + 一道内描边：质感和 MicroKit 一致——不用渐变当底，靠描边和留白立起来 */
  background: var(--surface-strong);
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
  letter-spacing: -0.01em;
  box-shadow: inset 0 0 0 1rpx var(--line);
  box-shadow: inset 0 0 0 1rpx var(--line), var(--shadow-xs);
  transition: transform 120ms cubic-bezier(0.34, 1.4, 0.64, 1), color 140ms ease-out;
}

/* 按下：一团品牌色从中心涨满整颗胶囊（MicroKit 的圆点填充手法），文字转白。
   平时是安静的白胶囊，按下才有颜色——这是它和「导入/导出」那种常驻白块的区别 */
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

/* 文字要压在色块之上 */
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

.add-plus {
  margin-right: var(--sp-2);
  font-size: var(--fs-lg);
}

.batch-bar {
  display: grid;
  grid-template-columns: 132rpx minmax(0, 1fr) 216rpx;
  align-items: center;
  width: 700rpx;
  min-height: 100rpx;
  margin-left: -350rpx;
  padding: var(--sp-3);
  border-radius: var(--r-lg);
  /* 批量栏是浮在滚动内容之上的工具栏，正是材料最该出现的地方——后面滚过去的
     明细能隐约透出来。记账主按钮不加，它是实心强调色，见 .add-button。
     同样先写不透明兜底：color-mix() 不被支持时不能变成全透明 */
  background: var(--surface-strong);
  background: color-mix(in srgb, var(--surface-strong) 90%, transparent);
  backdrop-filter: blur(14px);
  border: 1rpx solid var(--line);
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.5), var(--shadow-float);
}

.batch-secondary,
.batch-danger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  height: 76rpx;
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1;
  white-space: nowrap;
  /* 不要过渡 box-shadow：它每帧重绘，批量栏几个按钮同时按下时低端安卓会掉帧，
     而且阴影跟着缩放一起变会让按下看起来「发虚」 */
  transition: transform 140ms ease-out, opacity 140ms ease-out;
}

.batch-secondary:active,
.batch-danger:active {
  transform: scale(0.96);
}

.batch-secondary {
  background: var(--surface);
  border: 1rpx solid var(--line);
  color: var(--text);
  box-shadow: var(--shadow-xs);
}

.batch-danger {
  background: linear-gradient(135deg, var(--danger-from), var(--danger-to));
  color: var(--on-danger);
  box-shadow: var(--shadow-xs);
  box-shadow: 0 9rpx 20rpx color-mix(in srgb, var(--danger-from) 32%, transparent);
}

.batch-count {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-align: center;
  white-space: nowrap;
}

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
  /* 遮罩不是「黑一层」，是把后面那层推到远处：模糊 + 补饱和度才是 iOS 的景深 */
  backdrop-filter: blur(14px);
  /* 遮罩用 animation 而不是 transition：弹层是 v-if 新建出来的，第一帧就已处在
     目标状态，transition 不会触发；keyframe 在元素首次绘制时就会跑 */
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
  max-height: 92vh;
  padding: var(--sp-4) var(--sp-6) calc(var(--sp-6) + env(safe-area-inset-bottom));
  border-radius: var(--r-sheet) var(--r-sheet) 0 0;
  /* 先写不透明兜底再写半透明：color-mix() 要 Chrome 111+，不被支持时整条声明会被
     丢弃而不是退化，那样抽屉会变成全透明、账目直接叠在模糊层上。
     模糊从 16px 收到 12px：材料只留一层，够把下面的内容推开就行 */
  background: var(--surface-strong);
  background: color-mix(in srgb, var(--surface-strong) 92%, transparent);
  backdrop-filter: blur(12px);
  /* 亮上边 = 光打在材料边缘，iOS 抽屉的招牌细节 */
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.5);
  color: var(--text);
  box-sizing: border-box;
  overflow-y: auto;
  /* 抽屉自己滚到顶/底之后，滚动链条默认会交给页面继续滚——把链条掐断 */
  overscroll-behavior: contain;
  animation: sheetIn 0.24s ease-out;
}

@keyframes sheetIn {
  from {
    /* 百分比相对自身高度：抽屉内容多少都刚好完全藏在屏幕外。
       写死 60rpx 的话，小屏和大屏上是两种不同的观感 */
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 出场：原路返回（往下滑出），比进场快、而且加速离开。
   进出走同一条路径是 apple-design 的空间一致性——从下面来就从下面走 */
.modal-mask.is-closing {
  animation: maskOut 200ms ease-out forwards;
}

.modal-mask.is-closing .sheet {
  animation: sheetOut 200ms cubic-bezier(0.4, 0, 1, 1) forwards;
  /* 退场期间抽屉里的控件一律不再接受点击。保存按钮在 saving 复位之后还留在屏上
     （ease-in 前 100ms 只走了三成），再点一次会把同一笔账单插进 SQLite 两遍。
     只关抽屉不关遮罩：遮罩留着继续吸掉点击，别让手指穿到下面的账单行上 */
  pointer-events: none;
}

/* 拖拽退场时抽屉是弹簧在走（约 350ms），遮罩得陪着走完，
   否则抽屉会在「已经不再变暗」的页面上多滑 150ms */
.modal-mask.is-closing.is-dragging {
  animation-duration: 320ms;
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

/* 拖拽中位置由 rAF 逐帧写在行内 transform 上，不能被进场/退场 keyframe 抢走。
   进场动画只跑 240ms，但万一用户在动画没跑完时就抓住把手，也会被这一条立刻让位 */
.modal-mask.is-dragging .sheet {
  animation: none;
}

/* 日期弹层是叠在编辑弹层之上的第二层：把下面那层推后、压暗，
   层级关系才看得出来（apple-design §12：栈层逐级推后） */
.modal-mask.is-stacked .sheet {
  transform: scale(0.94) translateY(-12rpx);
  filter: brightness(0.82);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), filter 240ms ease-out;
}

.sheet-handle {
  position: relative;
  width: 72rpx;
  height: var(--sp-2);
  margin: 0 auto var(--sp-5);
  border-radius: var(--r-pill);
  /* 把手要跟着主题反色，不能写死颜色：夜间主题的抽屉底是 #383641，
     一个深梅色的条压在上面约 1.04:1，等于没有，而它是唯一宣告「可以往下拖」的线索。
     兜底用 --line（每个主题都定义过，只是偏淡），正式值从 --text-soft 调透明度推出来，
     浅色主题上是暖灰、夜间主题上是浅白，两边都看得见 */
  background: var(--line);
  background: color-mix(in srgb, var(--text-soft) 42%, transparent);
}

/* 可见的还是那条 8rpx 细条，命中区照「触摸目标」那套用 ::after 撑开。
   不撑的话只有 4px 高，手指根本压不住，拖拽等于没有。
   ::after 故意偏下：抽屉是 overflow 裁剪的，往上撑的部分会被 sheet 的上内边距切掉 */
.sheet-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 240rpx;
  height: 104rpx;
  transform: translate(-50%, -30%);
}

.sheet-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--sp-6);
}

.sheet-title {
  display: block;
  color: var(--text-strong);
  font-size: var(--fs-xl);
  font-weight: var(--fw-black);
}

.sheet-sub {
  display: block;
  margin-top: var(--sp-1);
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-body);
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: var(--fs-lg);
}

.editor-segment {
  margin-bottom: var(--sp-5);
}

.form-block,
.config-group {
  margin-bottom: var(--sp-5);
}

.form-row {
  display: flex;
  gap: var(--sp-4);
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
  gap: var(--sp-3);
}

.category-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 104rpx;
  padding: var(--sp-3) var(--sp-1);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 2rpx solid transparent;
  flex-direction: column;
}

.category-option.active {
  background: var(--accent-soft-2);
  border-color: var(--accent);
}

.category-option-emoji {
  font-size: var(--fs-lg);
  line-height: 1;
}

.category-option-name {
  width: 100%;
  margin-top: var(--sp-2);
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--fs-2xs);
  font-weight: var(--fw-medium);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-option.active .category-option-name {
  color: var(--accent-deep);
  font-weight: var(--fw-bold);
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  height: 94rpx;
  padding: 0 var(--sp-5);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  border: 2rpx solid transparent;
}

.amount-input-wrap.focused {
  border-color: var(--accent);
  background: var(--accent-soft-2);
}

.amount-prefix {
  color: var(--accent-deep);
  font-size: var(--fs-xl);
  font-weight: var(--fw-heavy);
}

.amount-input {
  flex: 1;
  height: 100%;
  margin-left: var(--sp-3);
  color: var(--text-strong);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-heavy);
}

.field-input,
.picker-field {
  width: 100%;
  height: 82rpx;
  padding: 0 var(--sp-5);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  color: var(--text-strong);
  font-size: var(--fs-md);
  line-height: 82rpx;
  box-sizing: border-box;
}

.note-input {
  height: 108rpx;
  line-height: 108rpx;
}

.date-block {
  flex: 0 0 auto;
}

.date-chip {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 88rpx;
  padding: 0 var(--sp-5);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  box-sizing: border-box;
  /* 按下那一刻要跟手（0ms），松手回弹才需要缓一缓，否则「啪」地弹回显廉价 */
  transition: transform 140ms ease-out;
}

.date-chip:active {
  transform: scale(0.97);
  /* 同上：按下瞬时，140ms 的过渡留给松手回弹 */
  transition: none;
}

.date-chip-text {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
}

.date-chip-caret {
  color: var(--text-soft);
  font-size: var(--fs-xs);
}

.refund-block {
  flex: 1;
  min-width: 0;
}

.date-mask {
  z-index: var(--z-mask-top);
}

.date-sheet {
  padding: var(--sp-5) var(--sp-5) calc(var(--sp-5) + env(safe-area-inset-bottom));
  overflow: hidden;
}

.date-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}

.date-sheet-title {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: var(--fw-heavy);
}

.date-sheet-action {
  padding: var(--sp-3) var(--sp-4);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.date-sheet-action.is-strong {
  color: var(--accent-deep);
}

.date-wheel {
  width: 100%;
  height: 440rpx;
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

.refund-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 82rpx;
  padding: 0 var(--sp-5);
  border-radius: var(--r-md);
  background: var(--surface-soft);
  box-sizing: border-box;
}

.refund-hint {
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
}

.primary-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 94rpx;
  border-radius: var(--r-lg);
  background: linear-gradient(135deg, var(--btn-from), var(--btn-to));
  color: var(--on-accent);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  box-shadow: var(--shadow-xs);
  box-shadow: 0 14rpx 28rpx color-mix(in srgb, var(--accent) 24%, transparent);
}

.primary-button.button-hover {
  transform: translateY(1rpx) scale(0.985);
  box-shadow: 0 6rpx 14rpx color-mix(in srgb, var(--accent) 20%, transparent);
}

/* 保存成功的确认态：按钮原地变成 ✓ 已保存，停半秒再关抽屉。
   成功反馈放在按钮上，比「抽屉啪地关掉 + 弹个 toast」更像确认过的样子 */
.primary-button.is-done {
  background: var(--positive-text);
  box-shadow: 0 6rpx 14rpx color-mix(in srgb, var(--positive-text) 26%, transparent);
}

.save-check {
  margin-right: var(--sp-2);
  font-size: var(--fs-md);
  font-weight: var(--fw-black);
}

.primary-button.compact {
  height: 86rpx;
  padding: 0 var(--sp-5);
  box-shadow: none;
}

.export-sheet {
  padding-bottom: calc(var(--sp-7) + env(safe-area-inset-bottom));
}

.export-scroll {
  max-height: 58vh;
  margin-bottom: var(--sp-5);
}

.export-picker {
  margin-top: var(--sp-4);
  text-align: center;
}

.pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
}

.config-pill {
  /* 一排 6 个，横向撑开会串到隔壁那颗，只能抬高度到 88rpx */
  min-height: 88rpx;
  padding: var(--sp-4) var(--sp-5);
  border-radius: var(--r-pill);
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.config-pill.active {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

/* 设置里的分组摊平成带分隔线的区块，不再在抽屉里再套卡片 */
.settings-card {
  padding-bottom: var(--sp-4);
  border-bottom: 1rpx solid var(--line);
}

.count-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 64rpx;
}

.count-label {
  flex: 0 0 auto;
  width: 2em;
  color: var(--text-soft);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.count-slider {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.count-value {
  flex: 0 0 auto;
  min-width: 4.2em;
  color: var(--text-strong);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-align: right;
}

.theme-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-3);
}

/* 主题选择器就是一行色板：只有色点，没有卡片壳，选中靠色点外圈 */
.theme-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88rpx;
  padding: var(--sp-2) 0;
  background: transparent;
  border: 0;
  color: var(--text-soft);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  flex-direction: column;
  gap: var(--sp-2);
}

.theme-option.active {
  color: var(--accent-deep);
  font-weight: var(--fw-bold);
}

.theme-swatch {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2rpx rgba(255, 255, 255, 0.55);
}

.theme-option.active .theme-swatch {
  box-shadow:
    inset 0 0 0 2rpx rgba(255, 255, 255, 0.55),
    0 0 0 3rpx var(--surface-strong),
    0 0 0 6rpx var(--accent);
}

.settings-actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  margin-top: var(--sp-5);
}

.secondary-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 86rpx;
  padding: 0 var(--sp-4);
  border-radius: var(--r-lg);
  background: var(--surface-soft);
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.secondary-button.accent {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.import-textarea {
  width: 100%;
  height: 360rpx;
  padding: var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--surface-soft);
  color: var(--text-strong);
  font-size: var(--fs-sm);
  line-height: 1.55;
  box-sizing: border-box;
}

.import-hint {
  margin-top: var(--sp-4);
  padding: var(--sp-4);
  border-radius: var(--r-md);
  background: var(--accent-soft-2);
  color: var(--text-soft);
  font-size: var(--fs-sm);
  line-height: 1.55;
}

.import-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
  margin-top: var(--sp-5);
}

/* ---------- 状态：disabled / 行内报错 / 忙碌 ---------- */

/* disabled 只有两套：实心按钮降级为 surface-soft + text-soft（AA 达标），描边控件降不透明度 */
.primary-button.disabled,
.batch-danger.disabled {
  background: var(--surface-soft);
  color: var(--text-soft);
  box-shadow: none;
  /* 这两类是只加 CSS 类、没加 disabled 属性（点击后由 JS 自己拦），
     所以照样会拿到 .button-hover，得在这里把按下反馈一并压掉 */
  transform: none;
  opacity: 1;
}

.batch-danger.disabled:active {
  transform: none;
}

/* 金额非法时的行内提示 */
.amount-input-wrap.invalid {
  border-color: var(--danger-text);
}

.field-error {
  display: block;
  margin-top: var(--sp-2);
  color: var(--danger-text);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

/* 导出/导入进行中：文案之外再给一个明确的忙碌指示 */
.spinner {
  width: 28rpx;
  height: 28rpx;
  margin-right: var(--sp-2);
  border: 3rpx solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  opacity: 0.8;
  /* 转快一点：加载时间一样，但看起来更快。匀速转的东西只能 linear */
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 触摸目标 ---------- */
/* 视觉尺寸不变，用 ::after 把命中区撑到 88rpx（=44px），这是 design-taste 的硬线 */
.sheet-close,
.text-action,
.round-action,
.month-button,
.text-button,
.date-sheet-action,
.batch-secondary,
.batch-danger,
.side-toggle,
.select-dot {
  position: relative;
}

.sheet-close::after,
.text-action::after,
.round-action::after,
.month-button::after,
.text-button::after,
.date-sheet-action::after,
.batch-secondary::after,
.batch-danger::after,
.side-toggle::after,
.select-dot::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 88rpx;
  height: 88rpx;
  transform: translate(-50%, -50%);
}

/* 删除按钮贴着行右缘，88rpx 的命中区会向左探进金额区、上下还多出一截，点金额末尾会误删。
   收到 72rpx：仍比视觉尺寸大一圈，但不越到隔壁行 */
.delete-button::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 72rpx;
  height: 72rpx;
  transform: translate(-50%, -50%);
}

@media (max-width: 380px) {
  .batch-bar {
    width: 664rpx;
    margin-left: -332rpx;
    grid-template-columns: 112rpx minmax(0, 1fr) 194rpx;
  }
}

@media (min-width: 768px) {
  .page {
    padding-top: 24px;
  }

  .shell {
    padding-right: 40rpx;
    padding-left: 40rpx;
  }
}

/* 系统开了「减弱动画」时不是把动效清零，而是去掉位移、留下淡入——
   位移是引起眩晕的部分，淡入和颜色变化是帮助理解状态变化的部分，要保留 */
@media (prefers-reduced-motion: reduce) {
  /* .batch-secondary / .batch-danger 是单类选择器（带 scoped 属性后比 button 那条更高），
     不列进来的话批量栏在减弱动画下照样跑 140ms 的缩放 */
  button,
  .batch-secondary,
  .batch-danger,
  .date-chip,
  .segment-thumb,
  .bill-item {
    transition-duration: 1ms;
  }

  .shell.is-next {
    animation: monthFade 160ms ease-out;
  }

  .shell.is-prev {
    animation: monthFade 160ms ease-out;
  }

  /* 弹层进出都改成纯淡入淡出：去掉上滑/下滑，保留「有个东西来了/走了」的信息。
     注意 sheet 不能直接 animation: none——那就变成硬切了，比淡入更差 */
  .sheet {
    animation: sheetFade 160ms ease-out;
  }

  .modal-mask.is-closing .sheet {
    animation: maskOut 160ms ease-out forwards;
  }

  /* 这条必须排在上面那条后面：两者特异性相同（0,3,0），谁在后面谁生效。
     甩动关闭时位置由弹簧逐帧写在行内 transform 上，一旦让 maskOut 赢下来，
     抽屉会在弹簧还没跑完时就被淡没 */
  .modal-mask.is-dragging .sheet {
    animation: none;
  }

  /* 栈层推后去掉缩放位移，只留压暗，层级关系还是看得出来 */
  .modal-mask.is-stacked .sheet {
    transform: none;
    transition: none;
  }

  /* 折线图的主开关在 JS：setTrendMode 在减弱动画下根本不走「收起再揭开」那套，
     直接换数据。这里关掉过渡是第二层保险——万一将来有别的路径把 trendRising 置真，
     至少不会动起来。两层都留着是有意的 */
  .trend-chart-svg {
    transition: none;
  }

  .trend-point-marker,
  .trend-point-label,
  .trend-axis-value {
    transition: opacity 0.2s ease;
  }

  /* 按下时那团扩散的品牌色：减弱动画下不做膨胀，直接瞬间到位 */
  .add-button::before {
    transition-duration: 1ms;
  }

  /* 转圈不能减速：它不是装饰动画，是「正在过去」的唯一指示。
     之前压到 1.6s 一圈，80ms 里只转 18°，看起来就是静止的 */
  .side-spinner {
    animation-duration: 700ms;
  }
}

/* 减弱透明度：把材料还原成实底、去掉模糊。apple-design §14 把它列为和减弱动画
   并列的独立信号——「不想要毛玻璃」和「不想要动效」是两回事。
   安卓 WebView 对这条的支持不稳定，不支持时整个查询恒假、就是死代码，不会反过来弄坏界面 */
@media (prefers-reduced-transparency: reduce) {
  .sheet,
  .batch-bar,
  .summary-panel {
    background: var(--surface-strong);
    backdrop-filter: none;
  }

  .modal-mask {
    backdrop-filter: none;
  }
}

/* 提高对比度：表面转近实底，用一条明确的描边替代模糊撑起来的层次 */
@media (prefers-contrast: more) {
  .summary-panel,
  .trend-panel,
  .distribution-panel,
  .bill-group,
  .sheet,
  .batch-bar {
    background: var(--surface-strong);
    border-color: var(--text-soft);
  }

  .summary-panel,
  .sheet,
  .batch-bar {
    backdrop-filter: none;
  }
}

@keyframes sheetFade {
  from {
    opacity: 0;
  }
}

@keyframes monthFade {
  from {
    opacity: 0;
  }
}
</style>
