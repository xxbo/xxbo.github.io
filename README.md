# 轨道都市 · Rail City

轻量城市轨道经营模拟：规划东京圈/粤港澳大湾区线网、配置交路和车库投放、发展城市，并持续结算客流、满意度与财务。浏览器静态应用，Rust/WASM计算内核。

- 游戏：https://xxbo.github.io/rail-city/
- 原资讯站：https://xxbo.github.io/
- 原游戏地址 `/rail/` 在新仓发布成功后改为同域跳转；IndexedDB数据库与本地键保持原样，现有存档和偏好沿用。

## 开发

`rail/` 保存游戏源代码、地图与WASM；`rust/rail-routing/` 保存原生内核；`scripts/` 仅保存游戏构建、测试、冻结基线和基准脚本。保留迁移前共享仓库的原提交历史，不重写历史SHA；迁移后的开发和CI独立于资讯站。

从仓库根目录启动静态HTTP服务，打开 `/rail/`。运行检查：

```sh
node scripts/run_rail_tests.cjs
node scripts/build_rail_wasm.cjs --check
```

Rust固定为 `rust/rail-routing/rust-toolchain.toml` 所指定的1.99.1，需安装 `wasm32-unknown-unknown` 目标。无npm依赖。

## 独立CI与发布

`.github/workflows/game.yml` 对PR、main提交与手动运行执行固定Rust构建/字节核对、全部游戏回归和静态发布检查。验证后将 `rail/` 内容直接作为项目Pages根目录发布；PR只验证，不部署。部署下载本次验证生成的同一份 `rail-city-public` 产物，不重新选择另一仓库或另一版本的游戏。

新仓Pages的Source设为 **GitHub Actions**。无需跨仓令牌、资讯采集、Python新闻测试或资讯快照。`deployment.json` 记录本仓源码SHA和运行ID。流水线部署权限仅授予依赖验证成功的main部署任务。

## Rust迁移状态与基准

P0、P1、P2-1与P2-2完成；继续P2-3运营诊断与P2-4存档兼容。

- [当前盘点](rail/core-rust-inventory.md)
- [MAP63验收与双基线测量](rail/rust-wasm-map63.md)
- [迁移审计](rail/rust-migration-audit.md)

纯JS固定提交 `498c5cd2af607e60dd1c75a8ba5863c08ac5d4fa` 保留于迁移前历史，性能脚本继续支持 `RAIL_JS_BASELINE` 与 `RAIL_PREVIOUS_ROOT` 指向独立干净工作树。分仓不修改模拟规则、存档格式或WASM字节，预期收益是仓库职责和CI隔离，运行性能沿用MAP63实测。
