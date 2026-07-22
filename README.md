# 亿方听力大师（InspireWorks ListextEditor）

由曾经创造了现象级教学工具 **《亿方教材助手》** 的 **亿方运维开发组** 开发的跨平台听力材料编辑与合成工具，**新项目，新起点，风华依旧**。  

具有 **一起作业听力材料制作工具** 的 100% 功能，并且更**现代化、可视化、智能化、自主可控。** **支持小语种听力制作，满足新高考需求。**

支持Win/Mac/Linux（信创）三端系统，无论是2027年全面换信创、单位强制用信创、还是智慧黑板拿信创当卖点、或者是处理器只能用信创、甚至是手机平板用容器运行Linux，本项目都能用。**信创之路再艰难，只要你敢用，我就能用。**

支持纯键盘代码编辑、积木式编辑、代码/积木左右分屏实时同步、音效管理、角色管理、项目打包（`.lstx`）与多平台构建等。

---

## 1. 项目简介

亿方听力大师是一个基于 Electron 的听力制作工具，目标是让 K12相关人员 可以高效率地通过以下功能制作英语听力：

- 编排听力文本与结构（朗读、停顿、重复、分节、分割线）
- 管理音效（分组、导入、试听、删除、重命名）
- 管理角色与发音人（EdgeTTS / 系统TTS）
- 将项目保存为可迁移的 `lstx` 打包文件

---

## 2. 核心特性

### 编辑能力
- 三种编辑模式：积木模式 / 代码模式 / **分屏模式**（左右分屏，双向实时渲染）
- 支持类HTML标签，如：`say`、`pause`、`repeat`、`fx`、`divider`、`section`、`role`
- 分节导航与关键字搜索定位
- 多选积木块拖拽移动，折叠效果仅在拖拽时触发

### 音效管理
- 默认音效与用户音效目录隔离
- 分组管理（默认分组 + 自定义分组）
- 默认分组：
  - 开场音乐
  - 常见音效
  - 环境音
- 默认自带音效不支持删除，用户导入音效可删除

### 项目打包
- 仅支持 `.lstx` 项目格式
- `.lstx` 是 zip 打包，包含：
  - `project.json`（标题、内容、角色、音效配置）
  - `sounds/`（项目引用的全部音效文件，自包含，不依赖系统内置音效库）

### 主页
- Banner 展示区（支持在线图片，通过 CSS 变量动态设置）
- 最近工程列表（自动记录打开/保存的项目，支持删除记录或删除文件）
- 工具栏居中/靠左切换（偏好自动保存）

### 跨平台 TTS 策略
- Windows：支持 EdgeTTS + 系统TTS
- Linux / macOS：由于系统架构复杂，无法调用系统TTS，需要改用 EdgeTTS

### 快捷键（积木模式，文本编辑时部分禁用）

所有快捷键均可在「设置 → 快捷键」中自定义。

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + 1~6` | 新增 朗读/停顿/重复/分节/音效/分割线 块（Shift 控制插入位置） |
| `↑ / ↓` | 选中上一个/下一个积木块 |
| `Ctrl + ↑ / ↓` | 上移/下移当前选中块 |
| `Enter` | 编辑当前选中块 |
| `Delete / Backspace` | 删除选中块 |
| `Space` | 预览播放 |
| `Ctrl + Z / Ctrl + Shift + Z` | 撤销 / 重做 |
| `Ctrl + C / X / V / A` | 复制 / 剪切 / 粘贴 / 全选 |
| `Ctrl + S` | 保存项目 |
| `Ctrl + M` | 切换积木/代码/分屏模式 |
| `Ctrl + N` | 新建标签页 |
| `Ctrl + Shift + E` | 打开音效管理器 |
| `F5`（可自定义） | 预览播放 |
| `Esc` | 停止播放并关闭弹窗 |

### 代码模式快捷键
| 快捷键 | 功能 |
|--------|------|
| `Ctrl + 1~6` | 插入对应标签模板 |
| `Tab` | 缩进 / 取消缩进（有选区时） |
| `Ctrl + Z / X / C / V / A` | 原生文本编辑器行为 |

---

## 3. 目录说明

```text
ListextEditor/
├─ assets/
│  └─ default-sounds/         # 默认自带音效（只读来源）
├─ pages/
│  ├─ index.html              # 主页面
│  └─ settings.html           # 设置页面
├─ src/
│  ├─ main/                   # 主进程逻辑
│  │  ├─ api-client.js        # API 客户端
│  │  ├─ config-handler.js    # 配置管理
│  │  ├─ file-locker.js       # 文件锁定
│  │  ├─ ipc-handler.js       # IPC 通信处理
│  │  ├─ sound-handler.js     # 音效处理
│  │  ├─ utils.js             # 工具函数
│  │  └─ window-manager.js    # 窗口管理
│  ├─ app.js                  # 渲染进程入口
│  ├─ block-renderer.js       # 积木块渲染
│  ├─ code-editor.js          # 代码编辑器
│  ├─ listext-parser.js       # 文本解析器
│  ├─ tts-engine.js           # TTS 引擎
│  ├─ tts-renderer.js         # TTS 渲染
│  ├─ ui-manager.js           # UI 管理
│  ├─ tab-manager.js          # 标签页管理
│  ├─ file-manager.js         # 文件管理
│  ├─ settings.js             # 设置逻辑
│  ├─ role-manager-page.js    # 角色管理
│  ├─ export-handler.js       # 导出处理
│  ├─ play-queue.js           # 播放队列
│  ├─ entitlement.js          # 授权管理
│  ├─ shortcut-defaults.js     # 默认快捷键
│  ├─ auth-manager.js         # 认证管理
│  └─ role-replace-dialog.js  # 角色替换对话框
├─ styles/
│  ├─ fonts/                  # 字体文件
│  └─ main.css                # 主样式文件
├─ main.js                    # Electron 主进程入口
├─ preload.js                 # 预加载脚本
└─ package.json
```

---

## 4. 本地开发

### 依赖安装

```bash
npm install
```

### 启动开发版

```bash
npm start
```

---

## 5. 构建脚本（Win / macOS / Linux / 信创）

> 以下命令已在 `package.json` 中定义。

### Windows

```bash
npm run build:win:x64
```

### macOS

```bash
npm run build:mac
```
macOS 构建同时输出 x64 和 arm64 两套安装包。

### Linux （传统 + 信创）

```bash
npm run build:linux:x64 #对应 传统Intel/AMD架构、兆芯 世纪大道 架构（ZHAOXIN/CentaurHauls），海光 C86 架构（HygonGeneiue）的处理器
npm run build:linux:arm64 #对应 传统 ARMV8 架构、飞腾 ARMV8 架构等ARM64架构的处理器
npm run build:linux:loong64 #对应 龙芯处理器 LoongArch 架构的处理器
```

### 信创（Linux x64 + ARM64 + Loong64）

```bash
npm run build:xinchuang
```

### 全平台串行构建

```bash
npm run build:all
```

---

## 6. 音效与配置文件策略

- 默认音效：打包资源中携带（`assets/default-sounds`）
- 用户音效：运行时写入用户目录（`userData/sounds-user`）
- 用户配置：运行时写入 `userData`，避免污染代码仓库

`.gitignore` 已配置用户态缓存与本地数据忽略项。

---

## 7. 免责声明

本工具面向教学与听力材料制作场景，建议在受控环境中使用并定期备份项目文件。本工具使用了国内可访问的合法AI模型，用户使用本工具制作的任何内容与本项目无关，不代表本项目立场。项目中提供的素材文件系网络搜集制作，禁止用于商业化场景，如有侵权请联系删除。
