# DSAgent 绿色版 使用说明

## 一、怎么用（三步）

1. **解压**：把 `DSAgent-Portable.zip` 解压到任意目录（桌面、D 盘、U 盘都行）。
   > ⚠️ 必须在压缩包里先「解压全部」，不能直接双击压缩包里的文件运行。

2. **启动**：双击目录里的 **`启动 DSAgent.cmd`**。

3. **等待**：首次启动需要初始化，约 10–30 秒，之后会自动打开浏览器。
   如果浏览器没弹出，手动访问命令行窗口里显示的地址（默认 `http://127.0.0.1:7788`）。

**更新**：双击 **`更新.cmd`** —— 自动从 GitHub 拉取最新技能与插件代码，不用重新下载整个包。
你的账号和会话不会被动到。

**停止**：关闭那个黑色命令行窗口即可。

**卸载**：直接删掉整个目录，不留任何残留（不写注册表、不装系统里的东西）。

---

## 二、环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11（64 位） |
| Node.js | **不需要**（已内置） |
| Python | **不需要**（已内置并预装依赖） |
| DSH Desktop | **不需要**（已内置） |
| 浏览器 | 系统自带的 Edge 即可 |
| 网络 | 更新功能需要能访问 GitHub；不联网也能正常用，只是更新会跳过 |

> 登录淘宝、抖音等平台时会调用 **本机已安装的 Chrome / Edge** 完成扫码。
> 若要用「发布」类技能，建议先装好 Chrome。

---

## 三、目录结构

```
DSAgent-Portable/
├─ 启动 DSAgent.cmd        ← 双击这个
├─ 更新.cmd                ← 想更新时双击这个
├─ launch.ps1              启动逻辑（路径无关化、环境注入）
├─ update.ps1              更新逻辑（拉取 + 用包内工具链自行编译）
├─ 使用说明.md             本文件
├─ app/                    DSH 运行环境（约 638 MB，内置 Node + 编译工具链）
├─ python/                 便携 Python + 已装技能依赖（约 294 MB）
├─ plugin/                 DSAgent 插件本体 + 66 个技能（约 41 MB）
├─ data/                   ★ 你的数据都在这（会话、账号、配置）
│   ├─ dsh-home/           DSH 的数据根（DSH_HOME）
│   └─ dsagent-accounts.json  账号登录凭证
├─ build-info.json         版本信息（更新时用它判断是否需要升级）
└─ *.patch.yml             运行时自动生成的配置（含当前路径）
```

**`data/` 是唯一需要备份的目录。** 换电脑时把它一起拷走，账号和会话都在。

> 说明：`data/` 在首次启动前并不存在，启动器会自动创建 —— 这是正常的。

---

## 四、常见问题

### 0. 怎么更新到最新版？
双击 **`更新.cmd`** 即可。它会：
- 查 GitHub 上的最新版本，与本地 `build-info.json` 比对
- 有新版本就下载源码（约 3 MB）并同步技能
- **并用包内自带的编译工具链重新构建插件代码**，所以工具与页面也会一起更新
- 更新前自动备份旧版本到 `backup-<时间戳>/`，确认没问题后可自行删除

你的 `data/`（账号、会话）**全程不受影响**。

只检查不更新：
```powershell
pwsh -File update.ps1 -Check
```
强制重新同步（修复被改坏的文件）：
```powershell
pwsh -File update.ps1 -Force
```

### 1. 双击后窗口一闪而过
右键 `启动 DSAgent.cmd` → 以管理员身份运行，或先在窗口里看报错。
若提示「无法加载文件，因为在此系统上禁止运行脚本」，说明 PowerShell 执行策略受限——
本包的启动器已用 `-ExecutionPolicy Bypass` 处理，正常不会遇到；
若仍遇到，手动运行：
```powershell
powershell -ExecutionPolicy Bypass -File .\launch.ps1
```

### 2. 端口被占用（提示 address in use）
改用其它端口：
```powershell
pwsh -File launch.ps1 -Port 8899
```
或让系统自动挑：
```powershell
pwsh -File launch.ps1 -Port 0
```

### 3. 想重新开始（清空账号和会话）
```powershell
pwsh -File launch.ps1 -Reset
```

### 4. 某些技能提示缺少 Python 模块
说明该技能用了未预装的库。安装方法：
```powershell
.\python\python.exe -m pip install --target .\python\Lib\site-packages 模块名 -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 5. 能拷到别的电脑 / U 盘用吗？
**可以。** 包内所有路径都是启动时按实际位置现算的，换盘符、换目录、换电脑都能直接跑。
可以把它放在 U 盘里随身带。

### 6. 能和电脑上已装的 DSH Desktop 同时用吗？
**可以，互不干扰。** 绿色版走独立的 `DSH_HOME`（在包内 `data/`），
不读写 `%APPDATA%\dsh-desktop`，也不受 DSH Desktop 单实例锁影响。

---

## 五、安全提示

- `data/` 里存着各平台的**登录凭证**。分享这个目录 = 分享你的账号，请勿外传。
- 本包不含任何后台服务，不写注册表，不随开机启动。
- 想彻底清除：删除整个目录即可。
