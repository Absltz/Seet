# 见数 Seet · AI 数据分析工作台

通过自然语言、表格或语音描述数据，使用 AI 完成筛选、分组、统计和绘图，并生成可预览、可导出的 PDF 分析报告。

本仓库包含完整 React 前端、Node.js 后端、自动测试、依赖锁文件和配置模板。GitHub 用于托管源码；运行作品需要启动 Node.js 服务。

## 比赛与团队

| 项目 | 信息 |
| --- | --- |
| 赛事 | 2026 第九届传智杯全国大学生数智创新与 AI 应用大赛 |
| 赛道 | AI WEB 网页开发挑战赛 |
| 参赛形式 | 团队赛 |
| 组别 | B 组 |
| 团队名称 | 放石一马 |
| 团队编号 | 42657 |
| 所属院校 | 周口师范学院 |
| 团队成员 | 刘鹏洋、李文浩、张博睿 |
| 仓库维护 | [@Absltz](https://github.com/Absltz) |

## 功能

- 导入 XLSX、CSV、TSV、JSON、TXT，或用自然语言录入数据。
- 千问 Agent 执行单值或多值筛选、日期汇总、统计及图表切换，展示实际工具执行过程。
- 文件先交由 AI 识别字段含义、标识与指标，再调用工具选择统计口径和图表；原始单元格保留。
- 点击图形可连续选择分类，拖动时间滑块可调整范围；原始明细同步筛选，时间轨道保留基础条件下的完整范围。
- 数据集库集中管理数据与对应分析；数据表格支持编辑、分类和文字筛选，可下载最初原文件及修改版本。
- 分析看板保存多张图表；密集分类名称可横向滚动，超大折线保留首尾及各段极值并说明抽稀范围。
- 语音识别结果先填回输入框，用户核对后发送。
- 按账号隔离保存数据、对话、图表和已生成 PDF；关联删除后整组进入回收站，可在七天内恢复，也可确认后永久删除。
- 报告主体分析整份数据；AI 归纳该数据下全部已保存的用户输入，在一至两页问题专题中回应。支持 PDF 预览、缩放、翻页和下载。

图表和统计由程序计算，AI 负责理解指令、调用工具和组织解读。报告校验不通过时会修订；仍失败则显示错误，用户也可主动选择程序统计报告，页面会注明其为统计报告。

## 技术架构

| 层次 | 技术与职责 |
| --- | --- |
| 前端 | React、Vite、Recharts、Lucide、react-markdown |
| 数据 | 共享 JavaScript 计算模块、Papa Parse、read-excel-file |
| 后端 | Node.js、Express，提供认证、记录、Agent、语音和报告接口 |
| AI | 千问、Vercel AI SDK、Zod 校验 |
| 报告 | PDFKit 生成，PDF.js 预览；附带 Noto CJK 字体及 OFL 许可 |
| 存储 | 服务端 JSON 文件，随机盐与 scrypt 密码哈希，HttpOnly 会话 Cookie |
| 测试 | Node.js 测试运行器、模拟供应商接口、临时账号目录 |

浏览器请求本站后端，由后端调用千问。对话、数据提取和报告使用 Qwen3.8-Flash，语音使用 Qwen-Audio-3.1-ASR-Flash；密钥不注入前端构建。详见 [架构说明](docs/architecture.md)。

## 安装与运行

需要 **Node.js 22.12 或以上版本**及 npm。调用 AI 时需要能访问千问 API。

```bash
git clone https://github.com/Absltz/Seet.git
cd Seet
npm ci
cp .env.example .env
# 编辑 .env，填写 AI_API_KEY
npm run build
npm start
```

打开 [http://127.0.0.1:4373/](http://127.0.0.1:4373/)，首次使用注册自己的账号后登录。

Windows 配置好 `.env` 后，也可双击 **启动见数.cmd**，自动检查运行环境、安装缺少的依赖、构建并启动服务，终端会显示阶段和实时日志。保持终端窗口开启。不要直接双击 `index.html`，它是源码入口，需要构建和 HTTP 服务。

### AI 配置

当前源码不附带 API 密钥。[`.env.example`](.env.example) 提供空白配置模板，复制为 `.env` 后填写自己的千问密钥。后端读取该文件，前端构建不包含密钥；`.env` 已加入 Git 忽略规则。未配置密钥时仍可启动网站，AI 功能需要完成配置后使用。

```dotenv
AI_API_KEY=填写自己的千问密钥
AI_PROVIDER=qwen
AI_BASE_URL=https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1
AI_MODEL=qwen3.8-flash
AI_FALLBACK_MODELS=qwen3.7-flash,qwen3.8-max
AI_ASR_MODEL=qwen-audio-3.1-asr-flash
AI_ASR_BASE_URL=https://maas.qianwenaiapi.com/api/v1
PORT=4373
```

文字任务首选 Qwen3.8-Flash，模型不可用时依次尝试 Qwen3.7-Flash、Qwen3.8-Max。助手标题和报告会显示实际调用的型号；语音使用独立配置。密钥认证失败、用户取消或数据校验失败不触发模型切换。

完整变量、可选设置和数据目录见 [环境配置](docs/configuration.md)。AI 是否可用取决于密钥有效性、额度与网络。

## 开发与检查

```bash
# 终端一：后端（首次先执行 npm run build）
npm start
# 终端二：前端开发服务位于 5373，/api 自动代理到 4373
npm run dev
# 自动测试和生产构建
npm test
npm run build
```

`npm test` 会先自动构建前端，再执行测试。测试使用模拟 AI 响应和临时数据目录，不消耗真实模型额度；随附 XLSX 在测试中读取，不依赖开发者电脑路径。

## 评审体验

1. 启动服务，注册并登录。
2. 上传自己的表格，或直接输入带数字的自然语言。
3. 提出筛选、对比、日期汇总或图表切换需求，展开执行过程核对结果。
4. 查看图表及筛选明细，或导出 CSV。
5. 生成报告，查看整体分析与问题专题，再预览、翻页、导出 PDF。
6. 从“数据集库”重新打开分析或原始数据，从“报告中心”预览已保存的 PDF。

## 目录

```text
src/                 前端页面、组件、共享计算与样式
server/              Express、认证、记录、Agent 和语音接口
server/report/       报告范围、证据、AI 撰写、PDF 和保存校验
scripts/             Windows 启动辅助脚本
tests/               数据、认证、隔离、工具和报告回归测试
samples/             自动测试读取的输入文件，不在网站中提供示例入口
assets/fonts/        中文字体及许可证
public/              网站图标
docs/                架构、配置、开发历史与开源参考
.env                 本地运行配置，自行创建，不提交 Git
.env.example         不含凭据的变量模板
package-lock.json    依赖锁文件
启动见数.cmd         Windows 启动入口
```

## 数据与运行边界

- 文件上限为 20 MB、50000 行、32 个指标、24 个分类字段。XLSX 读取首张工作表，公式结果和百分比格式需核对。
- 账号与记录首次运行时写入 `.data/`，该目录不纳入仓库，评审运行时需注册新账号。
- 聊天区展示最近记录，用户输入另行完整保存用于报告归纳。过长历史超出单次报告预算时会明确提示拆分，不静默省略中间消息；旧记录此前未保存的文字无法补回。
- 数据保存在运行服务的磁盘；迁移时备份 `.data/`。服务重启后需要重新登录。
- 不提交依赖目录、构建产物、临时文件、导出报告、截图和内部调试资料。克隆后通过 `npm ci` 与 `npm run build` 重建。
- 仓库包含后端源码，GitHub Pages 本身不能运行 Node.js。评审可按本 README 本地运行完整作品。

## Git 历史与参考

项目早期在本地开发，未使用 Git 记录。我们于 2026-10-28 将源码入库，此后的修改均保留提交记录。早期开发范围见 [开发历史说明](docs/development-history.md)。

第三方架构参考与采用范围见 [开源参考](docs/open-source-references.md)。字体许可位于 `assets/fonts/LICENSE.txt`，npm 依赖遵循各自许可证。
