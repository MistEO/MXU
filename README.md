# MXU

**MXU** 是一个基于 [MaaFramework PI V2](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md) 协议的通用 GUI 客户端，使用 Tauri + React + TypeScript 构建。

它可以解析任何符合 PI V2 标准的 `interface.json` 文件，为 MaaFramework 生态中的自动化项目提供开箱即用的图形界面。

## ✨ 特性

> [!TIP]
>
> MXU 已支持最新最潮的 PI v2.4.0 协议！

- 📋 **任务管理** - 可视化配置任务列表，支持拖拽排序
- 🔧 **多实例支持** - 同时管理多个独立运行的实例（标签页多开）
- 🎮 **多控制器类型** - 支持 Adb、Win32、PlayCover、Gamepad
- 🌍 **国际化** - 界面内置多种语言，自动加载 `interface.json` 中的翻译
- 🎨 **明暗主题** - 支持 Light/Dark 主题切换
- 📱 **实时截图** - 显示设备实时画面，可自定义帧率
- 📝 **运行日志** - 查看任务执行日志和 Agent 输出
- ⏰ **定时任务** - 支持配置定时执行策略
- 🔄 **自动更新** - 支持 MirrorChyan 和 GitHub 自动下载更新
- 🤖 **Agent 支持** - 支持 MaaAgentClient 实现自定义识别器和动作

## 🚀 快速开始

### 依赖文件

[MXU Releases](https://github.com/MistEO/MXU/releases) 中提供了单可执行文件（Windows 为 `mxu.exe`，Linux/macOS 为 `mxu`），您需要配置以下依赖：

- [MaaFramework](https://github.com/MaaXYZ/MaaFramework/releases) 运行库 ( >= `v5.5.0-beta.1` ) ，将压缩包中的 `bin` 文件夹内容解压到 `maafw` 文件夹中
- [interface.json](https://github.com/MaaXYZ/MaaFramework/blob/main/sample/interface.json) 及相关资源文件，请参考 [PI 协议文档](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md) 编写

目录结构如下

```text
your-project/
├── mxu.exe (或 mxu)
├── maafw/
│   ├── MaaFramework.dll (Windows)
│   ├── MaaToolkit.dll
│   └── ... 其他依赖库
├── interface.json
└── resource/
```

随后运行 `mxu.exe`（Windows）或 `./mxu`（Linux/macOS）即可！~

### 用户文件

用户配置保存在 `config` 文件夹中，调试日志保存在 `debug` 文件夹中。亦可在 设置 - 调试 中直接打开文件夹。

## 📖 开发调试

### 安装依赖

**Node.js** (>= 18)

```bash
# macOS (Homebrew)
brew install node

# Windows (winget)
winget install OpenJS.NodeJS
```

**pnpm** (>= 8)

```bash
npm install -g pnpm
```

**Rust** (>= 1.70)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

<!-- markdownlint-disable MD036 -->

**项目依赖**

<!-- markdownlint-enable MD036 -->

```bash
pnpm install
```

### 开发调试

```bash
pnpm tauri dev
```

启动前端开发服务器和 Tauri 桌面应用，支持热重载。

### 生产构建

```bash
pnpm tauri build
```

构建产物位于 `src-tauri/target/release/` 目录。

## 🔧 技术栈

| 类别     | 技术                                                |
| -------- | --------------------------------------------------- |
| 桌面框架 | [Tauri](https://tauri.app/) v2                      |
| 后端语言 | [Rust](https://www.rust-lang.org/) 1.70+            |
| 前端框架 | [React](https://react.dev/) 19                      |
| 类型系统 | [TypeScript](https://www.typescriptlang.org/) 5.8   |
| 样式方案 | [Tailwind CSS](https://tailwindcss.com/) 4          |
| 状态管理 | [Zustand](https://zustand-demo.pmnd.rs/)            |
| 国际化   | [i18next](https://www.i18next.com/) + react-i18next |
| 拖拽排序 | [@dnd-kit](https://dndkit.com/)                     |
| 图标     | [Lucide React](https://lucide.dev/)                 |
| 构建工具 | [Vite](https://vitejs.dev/) 7                       |

## 🤝 相关项目

- [MaaFramework](https://github.com/MaaXYZ/MaaFramework) - 基于图像识别的自动化黑盒测试框架

## 📄 License

[GNU Affero General Public License v3.0](LICENSE)

## ❤️ 鸣谢

感谢以下开发者对 MXU 作出的贡献：

[![贡献者](https://contrib.rocks/image?repo=MistEO/MXU&max=1000)](https://github.com/MistEO/MXU/graphs/contributors)

## ☕ 赞助

<!-- markdownlint-disable MD033 MD045 -->
<a href="https://afdian.com/a/misteo">
  <img width="200" src="https://pic1.afdiancdn.com/static/img/welcome/button-sponsorme.png">
</a>
<!-- markdownlint-enable MD033 MD045 -->
