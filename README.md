# 简记

本地记账，Android，uni-app + Vue 3。数据只存在手机上的 SQLite 里，不联网、没有账号、没有云同步。

## 它做什么

- 记一笔：金额、分类、备注、日期，可标「私人」（不计入展示账本）
- 按天分组列账，按月统计总额 / 笔数 / 日均
- 趋势折线（年 / 月 / 日三种粒度）
- 占比饼图：按分类占比的环形图 + 图例，转到某块时看它的占比和金额
- 展示账本：另开一页，把真实账目按比例放大成一份「能拿给别人看」的假账，支持拖动调整、虚拟账单补足

## 技术栈

- uni-app 3 + Vue 3（`<script setup>`）+ Vite
- App 端用 `plus.sqlite`，H5 端退回 `localStorage`
- 图表全部是 Canvas 2D 手绘（不用 SVG——App 的 WebView 里 SVG 有兼容问题）

## 开发

```bash
npm i
npm run dev:app     # 需要 HBuilderX，连真机跑调试基座
npm run dev:h5      # 浏览器里调 UI
npm run check       # 自检：对比度 54 项 + 展示账本 92 项 + 导入解析 31 项
```

`npm run check` 是纯 Node 脚本，不依赖构建产物，改完样式或统计算法先跑它。

## 目录

| 路径 | 内容 |
|---|---|
| `src/pages/index/index.vue` | 真实账本（主页面，最重的一个文件） |
| `src/pages/display/display.vue` | 展示账本 |
| `src/services/ledger.js` | SQLite / localStorage 读写、统计口径、分类色板 |
| `src/services/displayLedger.js` | 展示账本的放大算法、虚拟账单 |
| `src/App.vue` | 全局 token：字阶、间距、圆角、四套主题（樱花 / 薄荷 / 琥 / 夜） |
| `scripts/check-*.mjs` | 自检脚本 |

## 安装包

见 [Releases](https://github.com/dzy1145/jianji/releases)。

## 分支

- `main` —— 正式版，饼图对应 1.4.6（commit `23c275e`）
- `archive/pie-turntable` —— 废案存档：3D 转盘饼图（拖动旋转、3 点方向放大、离心外扩、
  果冻弹出、侧面标签、弧形图例）。2026-10-24 做完后整体回退，留着以后再看

## 已知的坑（都踩过）

- App 端 canvas 对 `x0 === x1` 的竖向渐变**静默不渲染**（H5 正常），侧壁之类的地方必须用斜向渐变
- App 端 `touch.clientX` 和 `boundingClientRect` 同单位（都是 CSS 像素），不要按 dpr 换算
- uni 只对带 `.prevent` 修饰符的监听器注册成非被动，手写 `event.preventDefault()` 是空调用
