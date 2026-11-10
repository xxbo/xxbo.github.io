# 游戏独立仓迁移与切换

源版本：`4bd2017487229621be0a960b6160c6a6591c6fdf`（MAP63 / P2-2）。目标仓：`xxbo/rail-city`。

## 文件归属

| 目标 | 保留内容 |
|---|---|
| rail-city | `rail/`全部游戏源文件/地图/WASM/性能报告、`rust/`、`scripts/*rail*`、`scripts/fixtures/rail-*`、独立游戏README及`game.yml` |
| xxbo.github.io | 资讯站页面/采集/快照/测试，资讯验证与发布；`rail/index.html`仅为兼容跳转 |

游戏发布将源仓 `rail/` 内容部署到新项目根目录 `/rail-city/`。相对脚本、Worker、gzip地图和WASM路径保持一致；源文件字节不修改。原 `/rail/` 与新 `/rail-city/` 共用 `https://xxbo.github.io` origin；IndexedDB `guanchao-rail-checkpoints` 和现有localStorage键均不变。切换保留查询参数和hash，导出/导入JSON格式保持原样。

## 切换顺序

1. 建立公开的 `xxbo/rail-city`，导入原仓Git历史；将游戏独立分支作为新仓main。保留原始历史SHA，便于纯JS/迁移阶段基线复现。
2. 新仓Pages Source设为GitHub Actions。`Rail City CI and Pages`须通过固定Rust/WASM核验、全部游戏回归、独立发布资源检查，再部署同一次验证的产物。
3. 确认新站 `/rail-city/` 加载成功，Worker/WASM路径在项目子路径下正确，部署来源SHA与新仓提交匹配。
4. 再合入资讯站清理PR，移除游戏源代码与游戏CI，更新两个游戏入口并部署旧地址桥接页。
5. 资讯流水线从新schemaVersion 2的资讯快照发布；过期/缺失/旧格式artifact拒绝发布，保留已有线上站点。

切换前保持原仓main和线上完整游戏；准备分支不触发生产部署。新站失败时不合入资讯清理PR。切换后如需回滚，可revert清理提交恢复原版本，不重写Git历史。

## 验收与性能

游戏新增独立发布资源/同源检查；原83个模拟套件和固定Rust/WASM检查继续运行。资讯端执行全部JS/Python测试和资讯专用发布契约。发布包内游戏入口、Worker、WASM逐字节对照。

分仓不改变Rust/WASM、客流或财务算法，运行性能沿用MAP63基线。新增收益是依赖、故障和发布权限隔离：游戏CI不采集新闻；资讯CI不安装Rust或运行游戏测试；两仓独立部署且不需要跨仓写入凭据。
