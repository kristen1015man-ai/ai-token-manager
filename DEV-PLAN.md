# Development Plan — ASIN 智能分类系统

> 本文件记录项目的开发阶段划分、当前进度和剩余工作。
> 新 session 启动时应首先阅读此文件，了解项目状态后再继续开发。

---

## Phase 1: 后端骨架 + 数据库

**交付内容**：
- 搭建 Python + FastAPI 后端项目结构，配置 CORS、环境变量、日志
- 创建 SQLite 数据库初始化脚本，建好全部 6 张表（projects、categories、asins、classifications、samples、noise_words）
- 初始化 ChromaDB 向量数据库连接
- 实现项目 CRUD API（创建/读取/更新/删除项目）
- 编写 docker-compose.yml 和 .env.example

**关键文件**：
- `backend/app/main.py` — FastAPI 入口，CORS 配置，路由注册
- `backend/app/config.py` — 环境变量管理（API keys、数据库路径、阈值默认值）
- `backend/app/db/database.py` — SQLite 连接管理（aiosqlite 异步）
- `backend/app/db/chroma.py` — ChromaDB 客户端初始化
- `backend/app/db/migrations.py` — 建表 SQL（6 张表全部在此创建）
- `backend/app/api/projects.py` — 项目 CRUD 路由（GET /projects, POST /projects, DELETE /projects/{id}）
- `backend/app/models/schemas.py` — Pydantic 数据模型（Project, ProjectCreate）
- `backend/app/services/project_service.py` — 项目业务逻辑
- `backend/requirements.txt` — Python 依赖清单
- `docker-compose.yml` — 前后端编排
- `.env.example` — 环境变量模板

**验收标准**：
- `pip install -r requirements.txt` 无报错
- `uvicorn app.main:app` 启动成功，访问 http://localhost:8000/docs 看到 Swagger 文档
- 调用 POST /projects 创建项目，GET /projects 返回项目列表
- SQLite 数据库文件自动创建，包含 6 张空表
- ChromaDB 数据目录自动创建

---

## Phase 2: 前端骨架 + 项目管理页面

**交付内容**：
- 搭建 Next.js + TailwindCSS 前端项目结构
- 创建根布局：顶部导航栏（系统名称 + 项目切换 + 设置按钮）
- 实现项目管理首页：项目卡片网格（名称、ASIN 数量、样本充分度进度条、最近运行时间）
- 创建项目弹窗（输入名称和描述）
- 封装后端 API 客户端（统一错误处理、base URL 配置）

**关键文件**：
- `frontend/src/app/layout.tsx` — 根布局，引入导航栏和全局样式
- `frontend/src/app/page.tsx` — 项目管理首页
- `frontend/src/app/globals.css` — Tailwind 全局样式 + 语义色彩变量
- `frontend/src/components/layout/navbar.tsx` — 顶部导航栏
- `frontend/src/components/projects/project-card.tsx` — 项目卡片组件
- `frontend/src/components/projects/create-project-dialog.tsx` — 创建项目弹窗
- `frontend/src/lib/api.ts` — 后端 API 客户端（fetch 封装，base URL 从环境变量读取）
- `frontend/src/lib/types.ts` — TypeScript 类型定义（Project, Category, ASIN 等）
- `frontend/package.json` — 前端依赖清单
- `frontend/next.config.js` — Next.js 配置
- `frontend/tailwind.config.ts` — Tailwind 配置

**验收标准**：
- `npm run dev` 启动成功，访问 http://localhost:3000 显示项目列表页
- 点击"创建新项目"弹出弹窗，输入名称后项目出现在列表中
- 项目卡片显示名称、空统计数据、创建时间
- 导航栏正确显示系统名称

---

## Phase 3: 数据导入 + 文本降噪

**交付内容**：
- 实现后端 Excel/CSV 文件上传解析（支持 xlsx、csv 格式，自动识别列映射：ASIN/SKU/Title/Attributes/Image_URL）
- 实现文本降噪管道：通用噪声词黑名单过滤 → 属性信息优先拼接 → 清洗后文本输出
- 实现噪声词自动提取：从导入数据中统计高频词，生成项目专属噪声词候选列表
- 实现前端数据导入页面：文件拖拽上传区 + ASIN 列表粘贴框 + 数据预览表格（前 20 行）
- 实现前端确认导入流程：预览数据 → 确认 → 入库 → 跳转标注页

**关键文件**：
- `backend/app/api/asins.py` — ASIN 数据路由（POST /projects/{id}/import, GET /projects/{id}/asins）
- `backend/app/services/import_service.py` — 文件解析逻辑（openpyxl 读 xlsx，csv 模块读 csv，列映射识别）
- `backend/app/services/denoise_service.py` — 降噪管道（黑名单过滤、属性提取、文本拼接）
- `backend/app/models/schemas.py` — 新增 ASIN 相关 Pydantic 模型（ASINImport, ASINRow, DenoiseResult）
- `frontend/src/app/projects/[id]/import/page.tsx` — 数据导入页面
- `frontend/src/components/import/file-upload.tsx` — 文件上传组件（拖拽 + 点击）
- `frontend/src/components/import/data-preview-table.tsx` — 数据预览表格组件

**验收标准**：
- 上传包含 ASIN/SKU/Title/Attributes/Image 列的 Excel 文件，解析成功并展示预览
- 预览表格显示前 20 行，列标题正确映射
- 粘贴 ASIN 列表（逗号或换行分隔）也能正确解析
- 点击"确认导入"后数据写入 SQLite，页面跳转到标注页
- 降噪管道输出的文本明显比原始标题更干净（黑名单词已移除）

---

## Phase 4: 类别定义 + 样本标注

**交付内容**：
- 实现类别 CRUD API（创建/重命名/删除类别）
- 实现样本标注 API（为指定 ASIN 标注类别和正反例标记）
- 实现前端标注页面：左侧类别管理面板（40%宽）+ 右侧商品卡片浏览区（60%宽）
- 商品卡片展示主图预览 + 标题 + 属性，下方按钮组选择类别
- 支持快捷键标注（1-9 对应类别，0 标为反例）
- 底部显示样本统计（每类正例/反例数量）+ "开始分类"入口

**关键文件**：
- `backend/app/api/categories.py` — 类别路由（POST/GET/DELETE /projects/{id}/categories）
- `backend/app/api/labeling.py` — 标注路由（POST /projects/{id}/samples, GET /projects/{id}/samples）
- `backend/app/services/labeling_service.py` — 标注业务逻辑（添加/移除样本，统计）
- `backend/app/models/schemas.py` — 新增 Category, Sample 相关模型
- `frontend/src/app/projects/[id]/labeling/page.tsx` — 标注页面
- `frontend/src/components/labeling/category-panel.tsx` — 左侧类别管理面板（添加类别、查看已标样本数）
- `frontend/src/components/labeling/product-card.tsx` — 商品卡片（图片+标题+属性+类别按钮组）
- `frontend/src/hooks/use-labeling.ts` — 标注状态管理 hook（翻页、标注、统计）

**验收标准**：
- 能添加/删除类别，类别列表实时更新
- 浏览商品时能正确显示主图（加载图片 URL）、标题、属性
- 点击类别按钮或按快捷键完成标注，标注后自动翻到下一个未标注商品
- 底部统计正确显示每类正例/反例数量
- 标注数据持久化，刷新页面不丢失

---

## Phase 5: 特征提取（Embedding 管线）

**交付内容**：
- 集成 OpenAI text-embedding-3-small API，对降噪后文本生成 1536 维向量
- 集成 CLIP ViT-B/32 模型（通过 Replicate 云端 API），对主图 URL 生成 512 维向量
- 实现特征融合：文本向量(60%) + 图片向量(40%) 加权拼接为综合特征向量
- 将融合向量存入 ChromaDB（按项目分 collection）
- 实现异步批量 Embedding 处理（后台任务，支持进度查询）
- 数据导入后自动触发 Embedding 提取（或手动触发）

**关键文件**：
- `backend/app/services/embedding_service.py` — Embedding 统一调度（文本+图片+融合+存储）
- `backend/app/ml/clip_embedding.py` — CLIP 图片 Embedding（调用 Replicate API）
- `backend/app/ml/vector_utils.py` — 向量操作工具（余弦相似度、加权融合、归一化）
- `backend/app/api/asins.py` — 新增路由 POST /projects/{id}/embed（触发 Embedding）和 GET /projects/{id}/embed/status（查询进度）
- `backend/app/db/chroma.py` — 新增向量写入和查询方法

**验收标准**：
- 调用 POST /projects/{id}/embed 触发 Embedding 提取，后台任务开始执行
- 进度 API 返回已完成数/总数
- 文本 Embedding 正确调用 OpenAI API 并获得 1536 维向量
- 图片 Embedding 正确调用 Replicate CLIP 并获得 512 维向量
- 融合向量正确存入 ChromaDB 对应项目的 collection
- 已标注样本和未标注 ASIN 都能正确生成向量

---

## Phase 6: 分类引擎 + 分类控制台

**交付内容**：
- 实现原型向量计算：每个类别的样本向量加权平均得到原型向量
- 实现余弦相似度分类：计算每个 ASIN 与所有原型向量的相似度，取最高分类别
- 实现三层置信度路由：高置信(>0.85)直接采用、中置信(0.65-0.85)调用大模型、低置信(<0.65)标记待审核
- 集成 GPT-4o-mini / Claude Haiku 做边界案例精判（构造包含类别定义+样例的 prompt）
- 实现分批处理控制：指定处理数量、置信度阈值调整
- 实现前端分类控制台页面：统计卡片 + 分批控制面板 + 进度条 + 实时日志 + 预估成本

**关键文件**：
- `backend/app/services/classify_service.py` — 分类核心引擎（原型计算、相似度分类、置信度路由、批量调度）
- `backend/app/services/llm_service.py` — 大模型精判（prompt 构造、API 调用、结果解析）
- `backend/app/api/classify.py` — 分类路由（POST /projects/{id}/classify, GET /projects/{id}/classify/status）
- `backend/app/models/schemas.py` — 新增 ClassifyRequest, ClassifyResult, ClassifyStatus 模型
- `frontend/src/app/projects/[id]/classify/page.tsx` — 分类控制台页面
- `frontend/src/components/classify/stats-cards.tsx` — 统计卡片（总数/高置信/AI精判/待审核）
- `frontend/src/components/classify/batch-control.tsx` — 分批控制面板（数量输入、阈值滑块、开始按钮、进度条）
- `frontend/src/components/classify/processing-log.tsx` — 实时处理日志组件
- `frontend/src/hooks/use-classify.ts` — 分类状态管理 hook（轮询进度、获取结果）

**验收标准**：
- 在标注了样本的项目中调用"开始分类"，系统正确计算原型向量
- 1 万 ASIN 的分类任务在 30 分钟内完成
- 高置信商品直接标记分类结果（来源=embedding）
- 中置信商品调用大模型获得分类（来源=llm）
- 低置信商品标记为待审核（来源=pending）
- 前端控制台实时显示处理进度和分类统计
- 预估成本正确显示（基于当前批量和阈值）

---

## Phase 7: 分类结果 + 人工复核

**交付内容**：
- 实现结果查询 API：支持按类别/置信度/来源筛选，分页返回
- 实现复核 API：一键确认分类、一键改判（改判结果自动成为新样本并更新原型向量）
- 实现批量操作 API：批量确认、批量改判
- 实现前端结果页面：统计面板（柱状图+饼图）+ 筛选栏 + 结果表格
- 结果表格每行显示缩略图、ASIN、标题、分类结果、置信度、来源标签（彩色）、操作按钮
- 底部固定栏：导出按钮 + 已选中数量 + 批量操作

**关键文件**：
- `backend/app/api/results.py` — 结果路由（GET /projects/{id}/results 带筛选和分页, POST /projects/{id}/results/review 复核操作）
- `backend/app/services/review_service.py` — 复核业务逻辑（确认、改判、自动学习、原型向量更新）
- `backend/app/models/schemas.py` — 新增 ResultsQuery, ReviewAction, ReviewBatch 模型
- `frontend/src/app/projects/[id]/results/page.tsx` — 结果页面
- `frontend/src/components/results/stats-panel.tsx` — 统计面板（各类别数量柱状图、置信度分布、来源分布）
- `frontend/src/components/results/filter-bar.tsx` — 筛选栏（类别下拉、置信度选择、来源选择）
- `frontend/src/components/results/results-table.tsx` — 结果表格（缩略图、数据列、操作按钮）
- `frontend/src/hooks/use-results.ts` — 结果数据管理 hook（筛选、分页、选中状态）

**验收标准**：
- 结果页正确展示所有已分类 ASIN 的统计和列表
- 按类别/置信度/来源筛选正常工作
- 点击"改判"弹出类别选择下拉框，选择后分类结果立即更新
- 改判的 ASIN 自动加入对应类别的样本库
- 批量选择后批量确认/改判正常工作
- 来源标签颜色正确（绿色=embedding、蓝色=llm、橙色=human、红色=pending）

---

## Phase 8: 导出 + 设置 + 样本充分度

**交付内容**：
- 实现 Excel 导出：生成 xlsx 文件包含 ASIN、SKU、分类结果、置信度、来源、原始标题、降噪后文本
- 实现前端设置页面：置信度阈值调整（滑块）、特征融合权重调整（文本/图片比例）、AI 模型选择（下拉框）
- 实现降噪词库管理 UI：查看项目专属噪声词列表、手动添加/删除噪声词
- 实现样本充分度指标：基于样本数量、特征多样性、类别间区分度计算充分度评分，在项目卡片和控制台中展示

**关键文件**：
- `backend/app/services/export_service.py` — Excel 导出逻辑（openpyxl 生成 xlsx）
- `backend/app/api/export.py` — 导出路由（GET /projects/{id}/export 返回文件流）
- `backend/app/services/denoise_service.py` — 新增噪声词管理方法（手动添加/删除/统计）
- `backend/app/api/projects.py` — 新增路由 GET /projects/{id}/noise-words, POST /projects/{id}/noise-words
- `backend/app/services/sufficiency_service.py` — 样本充分度计算（数量阈值、多样性评估、区分度评分）
- `backend/app/models/schemas.py` — 新增 NoiseWord, SufficiencyScore 模型
- `frontend/src/app/projects/[id]/settings/page.tsx` — 设置页面
- `frontend/src/components/settings/threshold-slider.tsx` — 置信度阈值滑块组件
- `frontend/src/components/settings/fusion-weight-slider.tsx` — 特征融合权重滑块组件
- `frontend/src/components/settings/noise-word-manager.tsx` — 噪声词管理组件
- `frontend/src/components/settings/model-selector.tsx` — AI 模型选择下拉框
- `frontend/src/components/projects/sufficiency-badge.tsx` — 样本充分度徽章组件

**验收标准**：
- 点击"导出 Excel"下载 xlsx 文件，打开后包含正确的列和数据
- 设置页面的阈值和权重滑块可调整，调整后影响下次分类结果
- 噪声词列表正确显示项目数据中提取的高频词，可手动添加和删除
- 项目卡片上显示样本充分度进度条和评分
- 充分度低时（样本不足）显示提示"建议再标注 X 个样本"

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端框架 | Next.js + React | 15.x | App Router，全栈 React 框架 |
| 前端样式 | TailwindCSS | 4.x | 工具类 CSS，快速开发 UI |
| 前端语言 | TypeScript | 5.x | 类型安全 |
| 后端框架 | FastAPI | 0.136.x | Python 异步 API 框架，AI 生态最好 |
| 后端语言 | Python | 3.12.x | ChromaDB 兼容性要求 ≤3.12 |
| 关系数据库 | SQLite (aiosqlite) | latest | 轻量零配置，异步访问 |
| 向量数据库 | ChromaDB | 1.5.x | 本地嵌入式向量库，免费 |
| 文本 Embedding | OpenAI text-embedding-3-small | latest | $0.02/百万 token，1536 维 |
| 图片 Embedding | CLIP ViT-B/32 via Replicate | latest | 免费模型，云端 GPU 按秒计费 |
| 大模型精判 | GPT-4o-mini / Claude Haiku | latest | 最便宜的可用分类模型 |
| Excel 处理 | openpyxl | latest | 读写 xlsx 文件 |
| 数据分析 | pandas | latest | CSV 解析和数据处理 |
| 容器编排 | Docker Compose | latest | 前后端统一启动 |

## 数据库表

| 表名 | 所属 Phase | 用途 |
|------|-----------|------|
| `projects` | Phase 1 | 项目元数据（名称、描述、设置 JSON） |
| `categories` | Phase 4 | 分类类别定义（关联项目） |
| `asins` | Phase 3 | ASIN 原始数据（SKU、标题、属性、图片 URL、降噪文本） |
| `classifications` | Phase 6 | 分类结果（类别、置信度、来源） |
| `samples` | Phase 4 | 样本标注记录（正例/反例、来源） |
| `noise_words` | Phase 3 | 项目专属噪声词库（词、频率、是否启用） |

ChromaDB Collections（向量存储）：

| Collection | 所属 Phase | 用途 |
|-----------|-----------|------|
| `project_{id}_embeddings` | Phase 5 | 存储每个 ASIN 的融合特征向量 |

## 开发规则

- 每完成一个 Phase 执行四步走：Code Review → 测试完整性 → 编译验证 → 功能测试
- 四步走全部通过后才能 commit
- Commit message 格式：`phase-N: 简要描述`
- 前端包管理器：npm
- 后端包管理器：pip（虚拟环境）
- Python 版本锁定 3.12.x（ChromaDB 兼容性）
- 所有 API Key 通过 .env 文件管理，不硬编码
- 后端 API 统一返回 JSON，错误格式：`{"error": "message"}`
- 前端 API 客户端统一错误处理，网络错误显示提示
