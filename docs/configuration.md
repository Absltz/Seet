# 环境配置与评审运行

## 环境要求

- Node.js 22.12 或以上版本、npm。
- 支持现代 JavaScript 的浏览器；语音需要麦克风权限及 localhost 或 HTTPS。
- 使用 AI 时可访问配置的模型服务。测试和构建不需要真实 AI 额度。

## 配置文件

后端从项目根目录 `.env` 加载变量。当前仓库不附带密钥；先复制 `.env.example` 为 `.env`，再填写自己的配置。`.env` 和账号数据均不提交 Git。

| 变量 | 默认值 / 示例 | 用途 |
| --- | --- | --- |
| `AI_API_KEY` | 空，需自行填写 | 千问 API 密钥，文字、Agent、报告及语音共享 |
| `AI_PROVIDER` | `qwen` | 当前模型供应商 |
| `AI_BASE_URL` | `https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1` | 模型服务基础地址 |
| `AI_MODEL` | `qwen3.8-flash` | 文字、Agent 与报告模型 |
| `AI_FALLBACK_MODELS` | `qwen3.7-flash,qwen3.8-max` | 主模型不可用时依序尝试，空值关闭回退；每个新任务重新首选主模型 |
| `PORT` | `4373` | 本副本 Express 端口 |
| `HOST` | `127.0.0.1` | 可选，监听地址，默认仅本机 |
| `AI_ASR_MODEL` | `qwen-audio-3.1-asr-flash` | 可选，语音识别模型 |
| `AI_ASR_BASE_URL` | `https://maas.qianwenaiapi.com/api/v1` | 原生语音服务地址，与文字兼容端点分开 |
| `USER_STORE` | 项目 `.data/users.json` | 可选，账号文件路径 |
| `ANALYSIS_STORE` | 项目 `.data/analyses/` | 可选，分析记录目录 |
| `SEET_EXTRA_FIXTURES` | 不设置 | 可选，仅测试时额外读取该目录中的 XLSX |

存储路径覆盖项应指向可写位置；部署时建议使用绝对路径。没有对应文件时，服务会在首次注册或保存时创建它们。

## 启动

```bash
npm ci
cp .env.example .env
# 填写 .env 中的 AI_API_KEY
npm run build
npm start
```

浏览器访问 `http://127.0.0.1:4373/`。开发前端位于 `http://127.0.0.1:5373/`，API 代理到 4373；如更改后端端口，需同步修改代理。

首次使用需注册账号，账号和分析记录保存在当前运行环境中。Windows 一键入口为 `启动见数.cmd`，会安装缺失依赖并构建，再启动服务和打开网页。

## 运行检查

- `/api/status` 返回服务是否配置 AI、供应商、文字及语音模型名称，不返回密钥。
- `npm test` 先自动构建前端，再使用临时数据目录与模拟供应商执行测试，不依赖现有 `.data`。
- `npm run build` 生成 `dist/`，Express 从该目录提供页面。
- `npm run dev` 只启动前端开发服务，后端仍需另开终端运行。

文本提取和 Agent 关闭思考；报告提纲启用有限预算的思考，正文使用 JSON 输出。报告继续检查统计事实、图表编号与引用，不能因更换模型而跳过校验。语音上传 Base64 WAV，走千问原生同步接口，识别后先填回输入框，由用户确认发送。协议参考[结构化输出](https://platform.qianwenai.com/docs/developer-guides/text-generation/structured-output)与[语音 HTTP 接口](https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-audio-asr/http-api)。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 双击 HTML 无法运行 | 按上面的构建及启动命令，通过 HTTP 地址访问 |
| AI 未配置 | 检查 `.env` 是否存在、密钥是否为空、模型名称是否正确；更改后重启服务 |
| 认证、额度或限流错误 | 查看页面具体提示，核对模型供应商的密钥和余额 |
| 首次生成 PDF 较慢 | 包含 AI 提纲、撰写、校验和排版，请保持连接，可主动取消 |
| 重启后退出登录 | 会话保存在服务内存；账号和已保存记录仍在数据目录，重新登录即可 |
| 换电脑后没有原记录 | 仓库不含账号数据。若需迁移，自行备份和恢复 `.data/` |

## 比赛打包范围

源码、依赖清单和锁文件、字体及许可、模拟数据、文档、环境配置和 Windows 启动脚本均可随源码包交付。排除 `.data/`、`node_modules/`、`dist/`、临时目录、导出的用户报告及截图。

提交源码不等于在线部署；完整后端需在 Node.js 环境运行，不能由 GitHub Pages 执行。
