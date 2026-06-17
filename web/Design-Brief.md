# AI Token Manager Dashboard — 当前设计状态文档

> 生成日期：2026-06-05
> 用途：供 AI/设计师分析当前 UI 设计状态，提出优化建议
> 框架：Next.js 16 + React + TypeScript + Tailwind CSS v4 + Recharts

---

## 1. 产品概述

AI Token Manager 是一个企业级 AI Token 用量管理与费用监控系统。支持多渠道 API Key 管理、按部门/员工的用量追踪、费用分析、配额管理、告警通知等功能。

**角色体系**：admin（管理员）、finance（财务）、dept_manager（部门经理）、member（普通成员），不同角色看到不同导航和功能。

---

## 2. 整体布局结构

```
┌─────────────────────────────────────────────────┐
│  Sidebar (w-56 fixed)  │  Header (h-14 sticky)  │
│  ┌──────────────────┐  │  ┌──────────────────┐  │
│  │ Logo             │  │  │ 页面标题  用户头像 │  │
│  │ ──────────────── │  │  └──────────────────┘  │
│  │ Nav Item (active)│  │  ┌──────────────────┐  │
│  │ Nav Item         │  │  │                  │  │
│  │ Nav Item         │  │  │  Main Content    │  │
│  │ Nav Item         │  │  │  (flex-1 p-6)    │  │
│  │ ...              │  │  │                  │  │
│  │ ──────────────── │  │  │                  │  │
│  │ Role Badge       │  │  │                  │  │
│  └──────────────────┘  │  └──────────────────┘  │
└─────────────────────────────────────────────────┘
```

- **Sidebar**：固定左侧，224px 宽，glass-panel 样式（白色渐变 + 右侧阴影分界线）
- **Header**：固定顶部，56px 高，glass-header 样式（半透明白色 + 底部边线）
- **Main Content**：`flex-1 p-6 overflow-auto`，左侧偏移 `ml-56`

---

## 3. 当前设计语言 — Glass Morphism（浅色毛玻璃）

### 3.1 页面背景

```css
body {
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f8fafc 100%) fixed;
}
```
从 slate-50 到 indigo-50 的微妙渐变，固定定位。

### 3.2 设计令牌（CSS 自定义属性）

```css
:root {
  --glass-bg: #ffffffb8;           /* 卡片基础背景 — 72% 白色 */
  --glass-bg-hover: #ffffffd9;     /* 悬停背景 — 85% 白色 */
  --glass-bg-solid: #ffffffe0;     /* 静态卡片背景 — 88% 白色 */
  --glass-border: #0000000a;       /* 边框 — 4% 黑色 */
  --glass-border-focus: #6366f166; /* 聚焦边框 — 40% indigo */
  --glass-shadow: 0 1px 3px #0000000a;
  --glass-shadow-md: 0 2px 12px #0000000d;
  --glass-shadow-lg: 0 4px 24px #0000000f;
  --glass-blur: 12px;
  --glass-radius: 16px;
  --glass-radius-sm: 12px;
  --glass-radius-xs: 8px;
}
```

### 3.3 核心组件样式

#### `.glass-card`（交互卡片 — 可点击）
- 背景：`#ffffffe0`（88% 白色）
- 边框：`1px solid #0000000a`（极淡）
- 圆角：`16px`
- 内发光：`inset 0 1px 1px rgba(255,255,255,0.8)`
- 顶部高光线：`linear-gradient(90deg, transparent, rgba(99,102,241,0.15), transparent)`
- **Hover**：背景变亮 → `#ffffffd9`，上移 2px，阴影加深，边框变 indigo
- **Active**：`scale(0.99)`

#### `.glass-card-static`（静态卡片 — 不可点击，使用最频繁，50+ 处）
- 与 glass-card 相同的背景/边框/圆角
- **无 hover/active 效果**

#### `.glass-panel`（侧边栏）
- `background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.96) 100%)`
- `box-shadow: 2px 0 16px rgba(0,0,0,0.03)`
- `border-right: 1px solid rgba(0,0,0,0.04)`

#### `.glass-header`（顶部栏）
- `background: rgba(255,255,255,0.97)`
- `box-shadow: 0 1px 4px rgba(0,0,0,0.03)`
- `border-bottom: 1px solid rgba(0,0,0,0.04)`

#### `.glass-btn`（按钮）
- 背景：`linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.04))`（indigo 微渐变）
- 文字：`#4338ca`（深 indigo）
- 圆角：`12px`
- 内发光：`inset 0 1px 0 rgba(255,255,255,0.6)`
- **Hover**：indigo 渐变加深 + 上移 1px + 阴影增强 + 顶部高光线显现
- **Active**：`scale(0.98)`

#### `.glass-input`（输入框）
- 背景：`rgba(255,255,255,0.85)`
- 边框：`1px solid rgba(0,0,0,0.06)`
- 圆角：`8px`
- **Focus**：边框变 indigo + `0 0 0 3px rgba(99,102,241,0.08)` 外环

#### `.glass-table`（数据表格）
- 容器：`glass-card-static` 样式（白底 + 圆角 16px + 阴影）
- 表头：`#f9fafbcc` 背景（96% 白色 + 80% 透明度）
- 表头文字：12px 大写 + 0.05em 字间距 + `#6b7280` 灰色
- 行悬停：`rgba(99,102,241,0.03)`（极淡 indigo）
- 行间线：`rgba(0,0,0,0.03)`

#### `.glass-skeleton`（骨架屏）
- 白色背景 + shimmer 动画（从左到右光泽扫过，播放 3 次后停止）

#### `.glass-badge`（标签/徽章）
- 白色半透明背景 + 圆角 pill + 极淡边框
- 12px 文字 + 500 字重

#### `.animate-glass-fade-in`（入场动画）
- 从 `opacity: 0; translateY(8px)` → `opacity: 1; translateY(0)`
- 0.5s ease-out

#### `.podium-bar`（排名领奖台）
- 第1名：金色渐变 `#fef3c7 → #fde68a → #fcd34d` + 阴影发光
- 第2名：银色渐变 `#f1f5f9 → #e2e8f0 → #cbd5e1`
- 第3名：铜色渐变 `#fff7ed → #fed7aa → #fdba74`
- 冠军光晕：径向渐变脉冲动画 `crown-glow`（2.5s 循环 3 次）

---

## 4. 色彩体系

### 4.1 主色板

| 角色 | 色名 | Hex | 使用场景 |
|------|------|-----|---------|
| **Primary** | Indigo-500 | `#625fff` | 按钮主色、图表主色、激活态 |
| **Primary Dark** | Indigo-600 | `#4f39f6` | 按钮 hover、激活文字 |
| **Primary Deep** | Indigo-700 | `#432dd7` | 导航激活文字 |
| **Secondary** | Emerald-500 | `#00bb7f` | Token 指标、成功状态 |
| **Warning** | Amber-400 | `#fcbb00` | 警告强调 |
| **Danger** | Red-500 | `#fb2c36` | 危险/错误 |
| **Text Primary** | Gray-900 | `#101828` | 标题文字 |
| **Text Body** | Gray-600 | `#4a5565` | 正文文字 |
| **Text Secondary** | Gray-400 | `#99a1af` | 辅助文字、非激活图标 |

### 4.2 语义配色方案

| 语义 | 背景 | 文字 | 场景 |
|------|------|------|------|
| 激活/选中 | `bg-indigo-50` | `text-indigo-700` | 导航项、Tab 激活态 |
| 成功 | `bg-green-50` | `text-green-600` | 启用状态、CNY 货币 |
| 警告 | `bg-amber-50` | `text-amber-600` | 余额不足、注意提示 |
| 危险 | `bg-red-50` | `text-red-600` | 错误、余额告急 |
| 禁用 | `bg-gray-100` | `text-gray-400` | 停用状态 |
| 信息 | `bg-sky-50` | `text-sky-600` | USD 货币 |
| 品牌 | `bg-purple-50` | `text-purple-600` | Provider 标签 |

### 4.3 图表色板（18 色）

```
#6366f1  #ec4899  #14b8a6  #f59e0b  #8b5cf6  #06b6d4
#ef4444  #84cc16  #d946ef  #0ea5e9  #eab308  #a855f7
#10b981  #f97316  #3b82f6  #22c55e  #c026d3  #64748b
```

按 indigo → 粉 → 青 → 琥珀 → 紫 → 天蓝 → 红 → 黄绿 → 品红 循环。

---

## 5. 字体排版

| 层级 | 大小 | 字重 | 颜色 | 使用场景 |
|------|------|------|------|---------|
| 页面标题 | 20px (`text-xl`) | 600 | gray-900 | "全局概览"、"费用账单" |
| 区块标题 | 16px | 600 | gray-900 | 卡片内的 h3 标题 |
| 统计数值 | 24px (`text-2xl`) | 700 | gray-900 | 大数字（费用、Token 数） |
| 总计数值 | 30px (`text-3xl`) | 700 | gray-900 | 最重要的单一数字 |
| 正文 | 14px (`text-sm`) | 400 | gray-600 | 表格内容、描述文字 |
| 标签/辅助 | 12px (`text-xs`) | 400–500 | gray-400–500 | 表头、副标题、提示 |
| 表头 | 12px | 600 | gray-500 | 大写 + 0.05em 字间距 |
| 超小标注 | 10px (`text-[10px]`) | 400 | gray-400 | USD 换算价格 |

**字体族**：Tailwind v4 默认（系统字体栈），无自定义字体。
**数字**：所有数据列使用 `tabular-nums` 等宽数字，避免对齐跳动。

---

## 6. 图标系统

- **风格**：Lucide 风格，内联 SVG
- **尺寸**：18×18px（viewBox 24×24）
- **笔画**：2px，round cap/join
- **颜色**：通过 `text-indigo-500`（激活）或 `text-gray-400`（非激活）控制
- **无 icon 组件库**：所有图标直接写在 layout.tsx 中（12 个导航图标）
- **部分页面使用 emoji**：统计卡片的 💰🔑👥📊 等（非 SVG）

---

## 7. 页面详细结构

### 7.1 用户仪表盘 (`/dashboard`)

**标题**："我的用量"

| 区域 | 组件 | 样式 |
|------|------|------|
| 时间筛选 | TimeRangeFilter | `rounded-xl bg-indigo-50/30 border-indigo-100` 容器 |
| 统计卡片 | SummaryCards × 4 | `glass-card p-5 animate-glass-fade-in`，4 列网格 |
| 趋势图 | UsageChart (LineChart) | `glass-card-static p-5` 容器，indigo + emerald 双线 |
| 模型分布 | ModelBreakdown (表格) | `glass-card-static p-5`，颜色圆点 + 模型名 |
| 配额进度 | QuotaProgress (进度条) | `bg-indigo-100/30` 轨道，indigo/orange/red 三色 |

**SummaryCards 细节**：
- 4 色：blue-600、emerald-600、purple-600、orange-600
- 加载态使用 `glass-skeleton`
- 入场动画 80ms 间隔递增

**UsageChart 细节**：
- 网格线：`rgba(99,102,241,0.08)` 虚线
- Tooltip：毛玻璃 `rgba(255,255,255,0.85)` + `backdrop-filter: blur(12px)`
- Token 线：`#6366f1`，费用线：`#10b981`
- strokeWidth 2.5，无静态圆点，激活圆点 r=4 + 白色描边

### 7.2 API Key 管理 (`/dashboard/key`)

- KeyManager 组件
- Key 显示区：深色主题 `rgba(15,12,41,0.85)` 背景 + `#6ee7b7` 绿色代码文字
- 重置按钮：`bg-red-50/50 text-red-600 border-red-200`

### 7.3 管理员全局概览 (`/dashboard/admin`)

**标题**："全局概览" + 副标题 "Token 用量与费用实时监控"

| 区域 | 内容 | 样式 |
|------|------|------|
| 余额告警 | BalanceSummarySection | danger=`bg-red-50 border-red-200`，warning=`bg-amber-50 border-amber-200` |
| 统计卡片 × 4 | 费用/Token/用户/调用 | `glass-card-static p-5`，indigo/emerald/violet/amber 背景 + emoji |
| 费用趋势 | LineChart | `glass-card-static p-6`，indigo-500 + emerald-500 双线，strokeWidth 2.5 |
| 渠道汇总 | PieChart + 表格 | `glass-card-static p-6`，双列网格，饼图 innerRadius 55 outerRadius 90 |
| 模型明细 | 表格 | `glass-card-static p-6`，glass-table + 颜色圆点 |

**BalanceSummarySection**：
- 4 个 mini 卡片：CNY=`bg-green-50/50 border-green-100`，USD=`bg-sky-50/50`，warnings=`bg-amber-50/50`，channels=`bg-indigo-50/50`

### 7.4 费用账单 (`/dashboard/admin/billing`)

- 总费用：`text-3xl font-bold text-gray-900`
- 导出按钮：`glass-btn`
- 三维度分析：部门（饼图+柱状图）、渠道（饼图+表格）、模型（表格）
- DeptCharts：grid 1/2 列，PieChart innerRadius 65 outerRadius 105

### 7.5 渠道管理 (`/dashboard/admin/channels`)

- 模型标签：`px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs`
- 货币标签：CNY=`bg-green-50 text-green-600`，USD=`bg-sky-50 text-sky-600`
- Provider：`bg-purple-50 text-purple-600`
- 余额状态：danger=`text-red-600`，warning=`text-amber-600`，ok=`text-green-600`
- 启用/停用：active=`bg-green-50 text-green-600`，disabled=`bg-gray-100 text-gray-400`
- 表单：2×3 网格布局

### 7.6 部门管理 (`/dashboard/admin/departments`)

- TOP 3 领奖台：`podium-bar-1/2/3` 金/银/铜渐变
- 冠军光晕动画
- 14 色部门色池

### 7.7 员工管理 (`/dashboard/admin/employees`)

- TOP 3 领奖台 + Avatar 组件
- Avatar：8 色（blue/green/purple/pink/indigo/yellow/red/teal-500）
- 4 尺寸：sm(24px)/md(32px)/lg(56px)/xl(80px)
- 18 色部门色池

### 7.8 审计日志 (`/dashboard/admin/logs`)

- 可展开详情面板，展开行 `bg-indigo-50/30`
- 9 种操作类型颜色
- 13 种目标类型颜色
- 分页：`bg-white rounded-xl border-gray-200`

### 7.9 模型统计 (`/dashboard/admin/models`)

- 双列网格：饼图 + 表格
- 饼图 innerRadius 55，outerRadius 100，paddingAngle 2
- 表格带合计行（tfoot）

### 7.10 价格管理 (`/dashboard/admin/prices`)

- 汇率栏：`bg-amber-50/60 border-amber-200`
- 状态：deprecated=`bg-amber-50 text-amber-600`，synced=`bg-green-50 text-green-600`，manual=`bg-indigo-50 text-indigo-600`
- 价格单元格：USD 换算 `text-[10px] text-gray-400`

### 7.11 配额管理 (`/dashboard/admin/quotas`)

- 公司/个人 Tab：active=`font-medium bg-indigo-50 text-indigo-700`
- 批量操作栏：`bg-amber-50/30 border-amber-200`
- 编辑行：`bg-indigo-50/30`
- 确认弹窗：`fixed inset-0 bg-black/20`
- 批量按钮：`bg-amber-500`

### 7.12 权限管理 (`/dashboard/admin/permissions`)

- 3 角色组：admin=red-700/red-50/red-200，finance=emerald-700/emerald-50/emerald-200，dept_manager=amber-700/amber-50/amber-200
- 内联搜索：`glass-input`

### 7.13 告警设置 (`/dashboard/admin/alerts`)

- 3 Tab：active=`bg-indigo-600 text-white shadow-sm`
- Tab 容器：`bg-white border-gray-100 p-1 rounded-xl`
- 飞书开关：on=`bg-indigo-600`，off=`bg-gray-300`，旋钮 `w-5 h-5 bg-white rounded-full shadow`
- Toast：ok=`bg-emerald-50 border-emerald-200 text-emerald-700`，err=`bg-red-50 border-red-200 text-red-700`

---

## 8. 侧边栏导航

### 8.1 导航项样式

```
非激活态：flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm
          text-gray-600 hover:bg-gray-50 hover:text-gray-900
          图标 text-gray-400

激活态：  bg-indigo-50 text-indigo-700 font-semibold
          图标 text-indigo-500
```

### 8.2 导航图标（内联 SVG，12 个）

| 图标 | 名称 | 用于 |
|------|------|------|
| 📊 chart | 用量总览 | /dashboard |
| 🔑 key | API Key | /dashboard/key |
| 🌐 globe | 全局概览 | /dashboard/admin |
| 🏢 building | 部门管理 | /dashboard/admin/departments |
| 👥 users | 员工管理 | /dashboard/admin/employees |
| 🧾 receipt | 费用账单 | /dashboard/admin/billing |
| 🔀 route | 渠道管理 | /dashboard/admin/channels |
| 🛡️ shield | 权限管理 | /dashboard/admin/permissions |
| 🔔 bell | 告警设置 | /dashboard/admin/alerts |
| 📄 document | 审计日志 | /dashboard/admin/logs |
| 🏷️ pricetag | 价格管理 | /dashboard/admin/prices |
| 🔒 lock | 配额管理 | /dashboard/admin/quotas |

### 8.3 角色徽章（底部）

- 样式：`text-[10px] px-2 py-0.5 rounded-full`
- admin：`bg-red-50 text-red-600`
- finance：`bg-emerald-50 text-emerald-600`
- dept_manager：`bg-amber-50 text-amber-600`
- member：`bg-gray-50 text-gray-600`

---

## 9. 动画系统

| 动画 | 时长 | 缓动 | 触发 |
|------|------|------|------|
| 卡片入场 | 0.5s | ease-out | 页面加载 |
| 按钮悬停上移 | 0.25s | ease | hover |
| 按钮按下 | 0.25s | ease | active (scale 0.98) |
| 骨架屏 shimmer | 1.8s × 3次 | ease-in-out | 加载态 |
| 领奖台悬停 | 0.3s | cubic-bezier(0.4,0,0.2,1) | hover (上移 3px) |
| 冠军光晕脉冲 | 2.5s × 3次 | ease-in-out | 自动播放 |
| 下拉菜单展开 | 0.15s | ease-out | 打开时 (scale 0.98→1 + 淡入) |
| Toast 出现 | 0.3s | ease-out | 自动 |

入场动画使用 80ms 间隔递增（staggered animation）。

---

## 10. 登录页设计（参考）

登录页使用完全不同的深色毛玻璃风格：

- **背景**：`linear-gradient(135deg, #0f0c29, #1a1333, #24243e)`（深紫蓝）
- **浮动光球**：3 个 indigo/violet/purple 径向渐变圆，10-15s 浮动动画
- **登录卡片**：`rgba(30,25,55,0.45)` + `backdrop-filter: blur(32px) saturate(1.5)`
- **边框**：`rgba(255,255,255,0.10)`
- **阴影**：`0 24px 64px rgba(99,102,241,0.20)`
- **Logo 光环**：10s 旋转动画
- **呼吸动画**：8s 循环背景脉冲

Dashboard 使用其浅色镜像版本：白色半透明 + 较弱的 blur + 淡 indigo 色调。

---

## 11. 组件层级关系

```
Dashboard Layout
├── Sidebar (glass-panel)
│   ├── Logo
│   ├── Nav Items × N (with SVG icons)
│   └── Role Badge
├── Header (glass-header)
│   ├── Page Title
│   └── User Info + Logout
└── Main Content
    ├── Page: 我的用量
    │   ├── TimeRangeFilter
    │   ├── SummaryCards × 4 (glass-card)
    │   ├── UsageChart (glass-card-static)
    │   ├── ModelBreakdown (glass-card-static)
    │   └── QuotaProgress (glass-card-static)
    ├── Page: 全局概览
    │   ├── BalanceSummarySection
    │   ├── Stat Cards × 4 (glass-card-static)
    │   ├── Line Chart (glass-card-static)
    │   ├── Channel PieChart + Table (glass-card-static)
    │   └── Model Table (glass-card-static)
    ├── Page: 费用账单
    │   ├── DeptCharts (PieChart + BarChart)
    │   ├── ChannelPie
    │   └── ModelTable
    ├── Page: 渠道管理
    │   ├── Channel Cards × N
    │   └── ChannelForm (glass-input)
    ├── Page: 部门管理
    │   ├── Podium × 3 (podium-bar)
    │   └── Department Table (glass-table)
    ├── Page: 员工管理
    │   ├── Podium × 3 (Avatar)
    │   └── Employee Table (glass-table)
    ├── Page: 审计日志
    │   └── Log Table + DetailPanel (glass-badge)
    ├── Page: 告警设置
    │   ├── Alert Tab (glass-input)
    │   ├── Feishu Tab (Toggle + Leaderboard)
    │   └── Toast Notifications
    └── ...其他管理页面
```

---

## 12. 当前设计的问题与不足

### 12.1 已知视觉问题

1. **背景几乎不可感知**：body 渐变 `#f8fafc → #eef2ff → #f8fafc` 太微妙，在大多数屏幕上看起来就是纯白
2. **卡片层次感弱**：`glass-card-static` 的 `#ffffffe0` 背景 + `#0000000a` 边框，在白色 body 上几乎没有对比
3. **阴影太浅**：`0 1px 3px rgba(0,0,0,0.04)` 在正常显示器上几乎看不到
4. **缺少 backdrop-filter**：glass-panel 和 glass-header 没有 `backdrop-filter: blur()`，无法实现真正的毛玻璃效果（内容滚动时不能透出）
5. **侧边栏太实**：纯白色渐变，与登录页的深色毛玻璃形成巨大落差
6. **emoji 作图标**：统计卡片使用 💰🔑👥📊 emoji，与导航栏的精致 SVG 图标风格不一致
7. **数据密度高但视觉引导少**：管理员概览页一屏内要展示 4 个统计卡 + 趋势图 + 渠道汇总 + 模型明细，缺少视觉层次

### 12.2 设计一致性

| 问题 | 详情 |
|------|------|
| 圆角不统一 | 卡片 16px，按钮 12px，输入框 8px，表格容器 16px — 缺乏系统性 |
| 阴影层级不明 | 只有 shadow / shadow-md / shadow-lg 三级，没有明确的 elevation 映射 |
| 悬停反馈不一致 | glass-card 有上移，glass-btn 有上移，但 glass-table 只有背景色变化 |
| 颜色使用分散 | 各页面直接用 Tailwind 色值（`bg-indigo-50`），没有统一为设计令牌 |

### 12.3 可访问性

- 统计卡片用 emoji 表示图标类别，屏幕阅读器无法理解
- 灰色辅助文字 `text-gray-400` (#99a1af) 在白色背景上对比度约 2.8:1，低于 WCAG AA 4.5:1 要求
- 没有暗色模式支持
- 没有 focus-visible 样式定义（glass-input 有 focus 样式但不是 focus-visible）

---

## 13. 技术栈总结

| 层面 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.x |
| UI 库 | React | 19.x |
| 语言 | TypeScript | strict mode |
| 样式 | Tailwind CSS v4 | via @tailwindcss/postcss |
| 图表 | Recharts | 动态导入 (ssr: false) |
| 图标 | 内联 SVG (Lucide 风格) | 18×18, stroke 2px |
| 认证 | 飞书/Lark OAuth | — |
| 数据获取 | 自定义 fetchApi 封装 | — |
| 状态管理 | React useState + useEffect | 无全局状态库 |

**项目结构**：所有 dashboard 页面在 `src/app/dashboard/` 下，共享组件在 `src/components/`。

---

## 14. 截图参考（当前实际效果描述）

由于无截图工具，以下是当前页面在浏览器中的实际视觉效果描述：

### 管理员概览页 (`/dashboard/admin`)
- 白色/极浅灰背景，几乎看不出渐变
- 4 个白色统计卡片横排，背景微透明但看不出来，边框极淡到几乎不可见
- 下方一个大白色区域包含折线图，indigo 和 emerald 双线
- 再下方是渠道饼图 + 表格的白色卡片
- 最后是模型明细白色表格
- **整体感觉**：干净的白色平面，缺乏层次和质感，卡片之间区分度低

### 侧边栏
- 纯白色底，右侧有极淡阴影分界
- 导航项间距紧凑，激活项有浅 indigo 背景
- 底部有角色标签

### 顶栏
- 纯白色底，底部有极细的灰色线
- 右侧用户头像 + 退出链接
- 滚动时无毛玻璃效果（缺少 backdrop-filter）

---

*以上是 AI Token Manager Dashboard 当前设计的完整状态。所有数据基于源码分析，非截图推测。*
