# 亿方听力大师（Yifang Listening Master）

由 **亿方运维开发组** 开发的跨平台听力材料编辑与合成工具。  
支持代码编辑、积木式编辑、音效管理、角色管理、项目打包（`.lstx`）与多平台构建。

---

## 1. 项目简介

亿方听力大师是一个基于 Electron 的听力制作工具，目标是让教员/老师可以高效率地：

- 编排听力文本与结构（朗读、停顿、重复、分节、分割线）
- 管理音效（分组、导入、试听、删除、重命名）
- 管理角色与发音人（EdgeTTS / 系统TTS）
- 将项目保存为可迁移的 `lstx` 打包文件（zip）

---

## 2. 核心特性

### 编辑能力
- 双模式编辑：积木模式 / 代码模式
- 支持标签：`say`、`pause`、`repeat`、`fx`、`divider`、`section`
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
- Linux / macOS：禁用系统TTS，提示改用 EdgeTTS

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

### Windows

```bash
npm run build:win:x64
npm run build:win:arm64
```

### macOS

```bash
npm run build:mac:x64
npm run build:mac:arm64
```

### Linux

```bash
npm run build:linux:x64
npm run build:linux:arm64
npm run build:linux:loong64
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

## 7. 项目命名与归属

- 中文名：**亿方听力大师**
- 开发团队：**亿方运维开发组**

---

## 8. 免责声明

本工具面向教学与听力材料制作场景，建议在受控环境中使用并定期备份项目文件。
