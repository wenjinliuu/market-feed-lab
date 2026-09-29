# TradeAlpha 抓取可行性实验

私有仓库中的一次性验证，不设高频或定时抓取。`api-probe.js` 使用 GitHub Secrets 中的 `TA_USERNAME`（手机号）和 `TA_PASSWORD`，直接登录网页使用的 API；修改该文件并推送会触发工作流。`results/latest.json` 是经过筛选的结果，登录凭据、Token、正文、PDF URL 和 PDF 文件不会写入结果或日志。

## 2026-09-29 已验证

- GitHub Actions：`POST /api/v1/auth/login/password`（`phone`、`password`）返回 `access_token`；Bearer 调用 `GET /api/v1/auth/member` 返回 200。
- Bearer 调用 `POST /api/v1/news/search`（`page`、`page_size`）返回快讯列表与分页；单页验证 15 条，字段包含 `id`、`datetime`、`created_at`、`level`、`source`、`category`、`content`、`impact_summary`。
- Bearer 调用 `POST /api/v1/research-reports/search` 返回研报列表与分页，报告项含 `file_cn`、`file_en` 等字段。
- 从报告文件地址读取文件头：HTTP 206、`application/pdf`、`%PDF-`。未测试完整下载、链接过期或大量下载。
- 第二次快讯测试的前几条时间为 2026-09-29 16:25（北京时间）；第一次测试第一条出现异常旧时间，因此正式采集须用 ID 去重，并监测时间字段异常。

下一步是低频持续测试 Token 过期、重新登录、异常恢复、重复数据和服务端限流，再决定部署到腾讯云开发还是常驻服务器。GitHub Actions 仅作验证，不适合 5 秒调度。

`ta-network-shape.user.js` 是供 iPhone Safari Tampermonkey 使用的本地请求结构诊断脚本；旧 `probe.js` 是早期浏览器实验，现行工作流不再运行它。
