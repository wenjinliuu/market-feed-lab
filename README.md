# TradeAlpha GitHub Actions 诊断

仅用于一次性验证登录、快讯数据通道和一篇研报 PDF 下载；不会开启定时任务，也不会写入数据库。

1. 将仓库可见性设为 **Private**，并将文件放到对应路径。公开仓库会被工作流第一步拒绝运行。
2. 在仓库 Settings → Secrets and variables → Actions 新建两个 Repository secrets：`TA_USERNAME` 和 `TA_PASSWORD`。不要把密码写进代码、Issue 或聊天。
3. Actions → TradeAlpha one-time probe → Run workflow。
4. 下载运行结果里的 `tradealpha-probe` artifact。只分享其中的 `report.json`；不要分享登录凭据。JSON 可能含会员快讯正文，按私人资料保管。

若登录有验证码、额外设备确认、网站拒绝 GitHub runner，程序会停止并给出错误阶段。GitHub runner 是临时机器，不保存浏览器登录状态；此方案每次运行都需要密码登录。是否适合 5 秒抓取，需要依据第一次结果再定。
