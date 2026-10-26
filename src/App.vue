<script>
import { initLedger } from './services/ledger'

// 窗口底色。pages.json 里的 globalStyle.backgroundColor 是静态的，改不了，
// 所以冷启动那一下用中性浅色兜底，进入 App 后立刻按主题覆盖。
// 这三个值要和 index.vue 里 --page-bg 渐变的中段色保持一致。
const WINDOW_BG = {
  sakura: '#fff2f4',
  mint: '#eef8f7',
  amber: '#fff5e8',
  night: '#292731'
}

function applyWindowBg() {
  const saved = uni.getStorageSync('jianji_theme') || 'sakura'
  if (typeof uni.setBackgroundColor === 'function') {
    uni.setBackgroundColor({ backgroundColor: WINDOW_BG[saved] || WINDOW_BG.sakura })
  }
}

export default {
  async onLaunch() {
    applyWindowBg()
    try {
      await initLedger()
    } catch (error) {
      console.error('本地账本初始化失败', error)
    }
  },
  onShow() {
    applyWindowBg()
  }
}
</script>

<style>
/* overscroll-behavior 挡住安卓 12+ WebView 的「拉到底还能拽」拉伸回弹 */
page {
  min-height: 100%;
  background: #f8f5f5;
  color: #34252b;
  overscroll-behavior: none;
  font-family: -apple-system, BlinkMacSystemFont, 'HarmonyOS Sans SC', 'MiSans',
    'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

html,
body {
  overscroll-behavior: none;
}

button {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  line-height: inherit;
  /* 放开框架 uni-button 自带的 overflow:hidden。否则按钮上用来撑大命中区的
     ::after（88rpx 触摸目标）会被裁到 padding box，44px 触摸硬线等于没生效 */
  overflow: visible;
}

button::after {
  border: 0;
}

input,
textarea {
  box-sizing: border-box;
}

/* 移动端 WebView 默认在触摸可点元素时刷一层灰/蓝（tap highlight），
   和自绘的按压反馈叠在一起会「闪一下」。全局关掉。
   input/textarea 也一起，否则点输入框同样会闪 */
html,
body,
button,
input,
textarea {
  -webkit-tap-highlight-color: transparent;
}

/* 长按不该选中文字：账单行、展示账本行都是长按进多选，
   少了这条会先冒出一片蓝色选区（长按选中比多选还快） */
button,
input,
textarea {
  -webkit-user-select: none;
  user-select: none;
}

/* ---------- 主题令牌 ---------- */

/* 从 pages/index/index.vue 搬过来的：展示账本是独立页面，scoped 样式过不去，
   令牌必须放在全局。值是原样搬的，一个都没改——scripts/check-contrast.mjs
   复验的就是这一份，改色先改脚本里的 THEMES 再跑一遍。
   色值经 WCAG 实测：正文/小字 ≥4.5:1，按钮文字 ≥4.5:1。
   --accent 只用于图表与装饰，按钮一律走 --btn-from/--btn-to，两者不要混用。 */
.page {
  /* 字阶 8 级。比例约 1.2 而非技能默认的 1.25：363px 宽的手机上 1.25 跨度过粗，中文小字会掉到不可读 */
  --fs-2xs: 18rpx;
  --fs-xs: 20rpx;
  --fs-sm: 24rpx;
  --fs-md: 28rpx;
  --fs-lg: 34rpx;
  --fs-xl: 40rpx;
  --fs-2xl: 48rpx;
  --fs-hero: 72rpx;
  /* 间距 8 级，基数 8rpx */
  --sp-1: 4rpx;
  --sp-2: 8rpx;
  --sp-3: 12rpx;
  --sp-4: 16rpx;
  --sp-5: 24rpx;
  --sp-6: 32rpx;
  --sp-7: 48rpx;
  --sp-8: 64rpx;
  /* 圆角：小控件 14 / 控件 20 / 卡片与大按钮 28 / 胶囊 / 抽屉顶 38 */
  --r-sm: 14rpx;
  --r-md: 20rpx;
  /* 卡片 24rpx（≈12px）：MicroKit 的卡片就在 10–12px 这一档，
     再大会软，再小会硬 */
  --r-lg: 24rpx;
  --r-pill: 999rpx;
  /* 抽屉顶 28rpx（≈14px）：和卡片同一个圆角家族，38rpx 的「大圆角」在这套更素的界面里显得甜 */
  --r-sheet: 28rpx;
  /* 字重：中文的笔画比拉丁字母密，700 已经很重，800/900 在大字号上会糊成一团黑。
     参考 MicroKit：它整站只用到 500。这里整体降一档，层级靠字号拉开而不是靠加粗 */
  --fw-body: 400;
  --fw-medium: 500;
  --fw-bold: 600;
  --fw-heavy: 700;
  --fw-black: 800;
  /* 动效曲线，和 MicroKit 一致：
     --ease-out  形变（位移、缩放）——起步极快、尾巴很长
     --ease-soft 颜色、阴影、边框这类不该抢戏的属性 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-soft: cubic-bezier(0.22, 1, 0.36, 1);
  /* 层级 5 档 */
  --z-point: 2;
  --z-label: 3;
  --z-fab: 50;
  --z-mask: 100;
  --z-mask-top: 200;
  /* 数字一律等宽，金额/百分比/日期在列表里才竖向对齐。中文不受影响 */
  font-variant-numeric: tabular-nums;
  --page-bg: linear-gradient(180deg, #fff8f3 0%, #fff2f4 46%, #f5fbf7 100%);
  --surface: rgba(255, 255, 255, 0.9);
  --surface-strong: #fffdfe;
  --surface-soft: #faf3f4;
  --text-strong: #34252b;
  --text: #4a3740;
  --text-soft: #816a72;
  --accent: #dc6f8b;
  --accent-deep: #ad4864;
  --accent-soft: #fbe7ed;
  --accent-soft-2: #fff2f5;
  --btn-from: #cf3b61;
  --btn-to: #b82d51;
  --on-accent: #fffaf8;
  --danger-from: #e02530;
  --danger-to: #c94652;
  /* 危险按钮的文字色：底色（--danger-from/to）四主题共用、不随主题变，
     所以文字色也必须是固定的浅色。不能用 --on-accent——夜间主题把它改成了深色 */
  --on-danger: #fffaf8;
  --line: rgba(98, 67, 79, 0.1);
  --scrim: rgba(52, 37, 43, 0.34);
  /* 阴影收紧（原来 14/36、20/54 铺得太散，像一层雾）。
     参考 MicroKit：卡片靠 1px 描边立起来，影子只负责「离开页面一点点」 */
  --shadow: 0 8rpx 22rpx rgba(103, 65, 81, 0.08);
  --shadow-xs: 0 3rpx 10rpx rgba(103, 65, 81, 0.06);
  --shadow-float: 0 14rpx 34rpx rgba(103, 65, 81, 0.18);
  --danger-text: #d3202b;
  /* 收入与「剩余」用的正色。实测在 surface / surface-strong / 页面底 / surface-soft 上 4.83–5.34:1 */
  --positive-text: #17795a;
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--text);
  /* 两个轴都掐掉回弹：原来只写了 -y，横向还能被拽出去一截、露出底色白边。
     这条不创建滚动容器，不影响展示页顶栏的 sticky */
  overscroll-behavior: none;
  /* 横轴裁掉：页面本来不该左右滚，任何一个渗出右边界的绝对定位元素
     （趋势图贴右的日期标签、浮点提示）都不该把整页拖出一条白边。
     用 clip 而不是 hidden——clip 不产生滚动容器，sticky 照旧有效 */
  overflow-x: clip;
  transition: background 0.25s ease, color 0.25s ease;
}

.page.theme-mint {
  --page-bg: linear-gradient(180deg, #f4fcf9 0%, #eef8f7 48%, #f9f6ef 100%);
  --surface: rgba(255, 255, 255, 0.9);
  --surface-strong: #fdfffe;
  --surface-soft: #edf8f4;
  --text-strong: #203c35;
  --text: #36534a;
  --text-soft: #5b766d;
  --accent: #3eaf92;
  --accent-deep: #207a65;
  --accent-soft: #dcf5ed;
  --accent-soft-2: #effaf6;
  --btn-from: #2e816c;
  --btn-to: #286f5d;
  --line: rgba(44, 107, 88, 0.1);
  --scrim: rgba(20, 58, 48, 0.34);
  --shadow: 0 8rpx 22rpx rgba(42, 102, 83, 0.07);
  --shadow-xs: 0 3rpx 10rpx rgba(42, 102, 83, 0.05);
  --shadow-float: 0 14rpx 34rpx rgba(42, 102, 83, 0.16);
}

.page.theme-amber {
  --page-bg: linear-gradient(180deg, #fff9ef 0%, #fff5e8 46%, #f7fbf7 100%);
  --surface: rgba(255, 255, 255, 0.91);
  --surface-strong: #fffdf9;
  --surface-soft: #fbf2e4;
  --text-strong: #402f1f;
  --text: #5a4635;
  --text-soft: #816b54;
  --accent: #d99342;
  --accent-deep: #975e1c;
  --accent-soft: #faebd3;
  --accent-soft-2: #fdf5e9;
  --btn-from: #a36621;
  --btn-to: #8c581c;
  --line: rgba(120, 84, 41, 0.1);
  --scrim: rgba(64, 47, 31, 0.34);
  --shadow: 0 8rpx 22rpx rgba(112, 76, 36, 0.08);
  --shadow-xs: 0 3rpx 10rpx rgba(112, 76, 36, 0.06);
  --shadow-float: 0 14rpx 34rpx rgba(112, 76, 36, 0.18);
}

.page.theme-night {
  --page-bg: linear-gradient(180deg, #20212b 0%, #292731 52%, #1b2221 100%);
  --surface: rgba(47, 45, 55, 0.94);
  --surface-strong: #383641;
  --surface-soft: #3a3741;
  --text-strong: #fff8f2;
  --text: #eee5e8;
  --text-soft: #b7a7ae;
  --accent: #df8eaa;
  --accent-deep: #f3b4c8;
  --accent-soft: rgba(223, 142, 170, 0.18);
  --accent-soft-2: rgba(223, 142, 170, 0.1);
  /* 夜间底是浅粉，按钮文字改用深色，6.70:1 */
  --btn-from: #df8eaa;
  --btn-to: #f3b4c8;
  --on-accent: #2b1b21;
  --line: rgba(255, 255, 255, 0.1);
  --scrim: rgba(8, 8, 12, 0.5);
  --shadow: 0 8rpx 26rpx rgba(0, 0, 0, 0.2);
  --shadow-xs: 0 3rpx 10rpx rgba(0, 0, 0, 0.22);
  --shadow-float: 0 14rpx 34rpx rgba(0, 0, 0, 0.36);
  --danger-text: #ff9aa2;
  --positive-text: #7ed9a6;
}
</style>
