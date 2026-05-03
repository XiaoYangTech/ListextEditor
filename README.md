# 亿方听力大师（InspireWorks ListextEditor）

由曾经创造了现象级教学工具 **《亿方教材助手》** 的 **亿方运维开发组** 开发的跨平台听力材料编辑与合成工具，**新项目，新起点，风华依旧**。  

具有 **一起作业听力材料制作工具** 的 100% 功能，并且更**现代化、可视化、智能化、自主可控。** **支持小语种听力制作，满足新高考需求。**

支持Win/Mac/Linux（信创）三端系统，无论是2027年全面换信创、单位强制用信创、还是智慧黑板拿信创当卖点、或者是处理器只能用信创、甚至是手机平板用容器运行Linux，本项目都能用。**信创之路再艰难，只要你敢用，我就能用。**

支持纯键盘代码编辑、积木式编辑、音效管理、角色管理、项目打包（`.lstx`）与多平台构建等。

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
- 双模式编辑：积木模式 / 代码模式
- 支持类HTML标签，如：`say`、`pause`、`repeat`、`fx`、`divider`、`section`
- 分节导航与关键字搜索定位

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
  - `project.json`（文本内容、角色信息等）
  - `assets-map.json`
  - `sounds/`（项目引用的音效素材）

### 跨平台 TTS 策略
- Windows：支持 EdgeTTS + 系统TTS
- Linux / macOS：由于系统架构复杂，无法调用系统TTS，需要改用 EdgeTTS

### 积木模式下无需鼠标，键盘直接操作界面（当正在编辑文本时，部分可能会导致误操作的快捷键将会被禁用。）

- Alt + 1：新增 朗读块

- Alt + 2：新增 停顿块

- Alt + 3：新增 重复块

- Alt + 4：新增 分节块

- Alt + 5：新增 音效块

- Alt + 6：新增 分割线块

- ↑ / ↓：选中上一个/下一个积木块

- Ctrl + ↑ / Ctrl + ↓：上移/下移当前选中块

- Enter：编辑当前选中块

- Delete / Backspace：删除选中块

- Space：预览播放

- Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y 撤销重做

- Ctrl + C / X / V / A 复制剪切粘贴全选

- Ctrl + S 保存

- F5 预览

- Esc 停止播放并关闭弹窗

---

## 3. 目录说明

```text
ListextEditor/
├─ assets/
│  └─ default-sounds/         # 默认自带音效（只读来源）
├─ src/
│  ├─ main/                   # 主进程逻辑
│  └─ ...                     # 渲染进程逻辑
├─ styles/
├─ index.html
├─ effects-manager.html
├─ role-manager.html
├─ settings.html
├─ preload.js
├─ main.js
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

### Windows （传统 + 信创）

```bash
npm run build:win:x64 #对应 传统Intel/AMD架构、兆芯 世纪大道 架构（ZHAOXIN/CentaurHauls），海光 C86 架构（HygonGeneiue）的处理器
npm run build:win:arm64 #对应 传统 ARMV8 架构、飞腾 ARMV8 架构等ARM64架构的处理器（本项目不推荐飞腾处理器原生运行Windows，会存在缺少驱动的现象。如有相关需求，请在Linux平台使用本项目，或是安装Windows虚拟机使用。）
```

### macOS

```bash
npm run build:mac:x64 #对应 传统Intel x86架构的处理器
npm run build:mac:arm64 #对应 苹果M系列的处理器
```

### Linux （传统 + 信创）

```bash
npm run build:linux:x64 #对应 传统Intel/AMD架构、兆芯 世纪大道 架构（ZHAOXIN/CentaurHauls），海光 C86 架构（HygonGeneiue）的处理器
npm run build:linux:arm64 #对应 传统 ARMV8 架构、飞腾 ARMV8 架构等ARM64架构的处理器
npm run build:linux:loong64 #对应 龙芯处理器 LoongArch 架构的处理器
```

### 信创（Linux ARM64 + Loong64）

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
