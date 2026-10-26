// 简记主题对比度校验 / 反推
//
//   node scripts/check-contrast.mjs            复验当前色板（应全部 AA）
//   node scripts/check-contrast.mjs --derive   反推达标色值（只压明度、不改色相）
//
// 这里的色值必须和 App.vue 里 .page / .theme-* 的 CSS 令牌一一对应
// （2026-09-30 令牌从 index.vue 搬到了 App.vue 的全局 style，独立页面要共用同一份）。
// 改了主题颜色，先改这里的 THEMES，再跑一遍确认没有掉出 AA。
// 口径：正文与小字 ≥4.5:1，按钮文字 ≥4.5:1。

const hex = (h) => {
  h = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const rgba = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(',').map((v) => parseFloat(v))
  return { c: [p[0], p[1], p[2]], a: p[3] === undefined ? 1 : p[3] }
}
const over = (fg, bg) => fg.c.map((v, i) => v * fg.a + bg[i] * (1 - fg.a))
const lum = (c) => {
  const f = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
const toHex = (c) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const toHsl = (c) => {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}
const toRgb = (hsl) => {
  const [h, s, l] = hsl
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}
// 保持色相与饱和度，只降明度，找到刚好达标的最小压暗量
const darkenUntil = (hexColor, against, target) => {
  const hsl = toHsl(hex(hexColor))
  for (let l = hsl[2]; l >= 0; l -= 0.002) {
    const c = toRgb([hsl[0], hsl[1], l])
    if (ratio(c, hex(against)) >= target) return toHex(c)
  }
  return toHex(toRgb([hsl[0], hsl[1], 0]))
}
const fix = (color, against, target) =>
  ratio(hex(color), hex(against)) >= target ? color : darkenUntil(color, against, target)

const TARGET = 4.52

// 与 index.vue 的 CSS 令牌一一对应
const THEMES = {
  sakura: {
    bg: '#fff2f4', surface: 'rgba(255,255,255,0.9)', soft: '#faf3f4', sheet: '#fffdfe',
    text: '#4a3740', textSoft: '#816a72', strong: '#34252b', dangerText: '#d3202b',
    positiveText: '#17795a',
    accent: '#dc6f8b', accentDeep: '#ad4864', accentSoft: '#fbe7ed',
    btnFrom: '#cf3b61', btnTo: '#b82d51', onAccent: '#fffaf8'
  },
  mint: {
    bg: '#eef8f7', surface: 'rgba(255,255,255,0.9)', soft: '#edf8f4', sheet: '#fdfffe',
    text: '#36534a', textSoft: '#5b766d', strong: '#203c35', dangerText: '#d3202b',
    positiveText: '#17795a',
    accent: '#3eaf92', accentDeep: '#207a65', accentSoft: '#dcf5ed',
    btnFrom: '#2e816c', btnTo: '#286f5d', onAccent: '#fffaf8'
  },
  amber: {
    bg: '#fff5e8', surface: 'rgba(255,255,255,0.91)', soft: '#fbf2e4', sheet: '#fffdf9',
    text: '#5a4635', textSoft: '#816b54', strong: '#402f1f', dangerText: '#d3202b',
    positiveText: '#17795a',
    accent: '#d99342', accentDeep: '#975e1c', accentSoft: '#faebd3',
    btnFrom: '#a36621', btnTo: '#8c581c', onAccent: '#fffaf8'
  },
  night: {
    bg: '#292731', surface: 'rgba(47,45,55,0.94)', soft: '#3a3741', sheet: '#383641',
    text: '#eee5e8', textSoft: '#b7a7ae', strong: '#fff8f2', dangerText: '#ff9aa2',
    positiveText: '#7ed9a6',
    accent: '#df8eaa', accentDeep: '#f3b4c8', accentSoft: 'rgba(223,142,170,0.18)',
    btnFrom: '#df8eaa', btnTo: '#f3b4c8', onAccent: '#2b1b21'
  }
}
// 四个主题共用一套语义色。on 镜像 App.vue 的 --on-danger（危险按钮文字色固定用浅色，
// 不能用 --on-accent —— 夜间主题把 --on-accent 改成了深色，深字压深红底只有 3.49:1）
const DANGER = { from: '#e02530', to: '#c94652', on: '#fffaf8' }

const surfacesOf = (t) => {
  const bg = hex(t.bg)
  const surface = over(rgba(t.surface), bg)
  const soft = t.soft.startsWith('rgba') ? over(rgba(t.soft), surface) : hex(t.soft)
  const accentSoft = t.accentSoft.startsWith('rgba')
    ? over(rgba(t.accentSoft), surface)
    : hex(t.accentSoft)
  return { bg, surface, soft, accentSoft, sheet: hex(t.sheet) }
}

const derive = process.argv.includes('--derive')
let failures = 0
const line = (label, r) => {
  const ok = r >= 4.5 ? 'AA  ' : r >= 3 ? 'AA大' : '不达标'
  if (r < 4.5) failures += 1
  console.log('  ' + r.toFixed(2).padStart(5) + ':1  ' + ok + '  ' + label)
}

console.log(derive ? '=== 反推达标色值（色相不变，只压明度）===' : '=== 当前色板复验 ===')

for (const [name, t] of Object.entries(THEMES)) {
  const { bg, surface, soft, accentSoft, sheet } = surfacesOf(t)
  let textSoft = t.textSoft
  let accentDeep = t.accentDeep
  let btnFrom = t.btnFrom
  let btnTo = t.btnTo

  if (derive) {
    textSoft = fix(textSoft, toHex(soft), TARGET)
    accentDeep = fix(accentDeep, toHex(accentSoft), TARGET)
    accentDeep = fix(accentDeep, toHex(surface), TARGET)
    btnFrom = fix(btnFrom, t.onAccent, TARGET)
    // 夜间是深字配浅底，往深压反而降对比，直接用原色阶
    if (name === 'night') {
      btnTo = t.btnTo
    } else {
      const hsl = toHsl(hex(btnFrom))
      btnTo = toHex(toRgb([hsl[0], hsl[1], Math.max(0, hsl[2] * 0.86)]))
    }
  }

  console.log('\n=== ' + name + ' ===')
  if (derive) {
    console.log('  text-soft     ' + t.textSoft + ' → ' + textSoft)
    console.log('  accent-deep   ' + t.accentDeep + ' → ' + accentDeep)
    console.log('  btn 渐变      ' + btnFrom + ' , ' + btnTo + '   按钮字 ' + t.onAccent)
  }
  line('text-soft on surface-soft  【标签/副标题/图例】', ratio(hex(textSoft), soft))
  line('text-soft on surface', ratio(hex(textSoft), surface))
  line('text-soft on 页面底', ratio(hex(textSoft), bg))
  line('text on surface  【正文】', ratio(hex(t.text), surface))
  line('text-strong on surface  【金额/标题】', ratio(hex(t.strong), surface))
  line('accent-deep on accent-soft  【选中态文字】', ratio(hex(accentDeep), accentSoft))
  line('accent-deep on surface  【夸大的展示金额】', ratio(hex(accentDeep), surface))
  line('按钮字 on 渐变亮端', ratio(hex(t.onAccent), hex(btnFrom)))
  line('按钮字 on 渐变暗端', ratio(hex(t.onAccent), hex(btnTo)))
  line('danger-text on surface-strong  【行内报错】', ratio(hex(t.dangerText), sheet))
  line('danger-text on surface  【标红的最值得调整账目名】', ratio(hex(t.dangerText), surface))
  line('positive-text on surface  【收入/剩余】', ratio(hex(t.positiveText), surface))
  line('positive-text on surface-soft  【收入小计】', ratio(hex(t.positiveText), soft))
}

console.log('\n=== 危险按钮（批量删除，四主题共用）===')
line('按钮字 on 渐变亮端', ratio(hex(DANGER.on), hex(DANGER.from)))
line('按钮字 on 渐变暗端', ratio(hex(DANGER.on), hex(DANGER.to)))

const total = Object.keys(THEMES).length * 13 + 2
console.log('\n' + (failures ? '✗ ' + failures + ' 项不达标（共 ' + total + ' 项）' : '✓ 全部 ' + total + ' 项达 AA'))
process.exit(failures ? 1 : 0)
