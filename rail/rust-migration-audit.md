# 核心 Rust 迁移审计与后续顺序

审计基线：MAP51，代码提交 `e13ebd90f64b357c1bc7ec72d352d018c151580d`。本报告逐项对照实际入口、宿主适配器和原生实现；不使用文件数量或代码行占比表示完成率。本轮只调整 CI/发布及文档，保持游戏算法与存档格式。

## 结论

寻路、整段需求分配、到达采样、运行/信号、队列/上下车、事件统计、满意度和经营/借贷已有 Rust 计算。下一步收益更可能来自减少状态复制、控制权往返和重复派生，而不是再把已经原生化的算法迁一次。

默认调用链：`ui.js` → `performance.runAsync` → `management.advanceBudgetAsync` → `passengers.prepareTick` → `queue-runtime.cycle/continueRun` → `simulation-client` → `simulation-worker` → `cycle.rs::engine_cycle / engine.rs::engine_continue`。事件边界之间是原生多步；跨分钟、发车、城市和诊断边界仍返回宿主准备下一帧。Worker 只持有原生内核，JS 世界对象和界面镜像仍在主线程。

## 待迁移清单

| 优先级 | 仍在 JS 的逻辑与入口 | 已在 Rust 的部分 | 建议迁移单元与验收 |
| --- | --- | --- | --- |
| P0-1 | `management.js::interval/advanceBudgetAsync`、`queue-runtime.js::continueRun` 计算宿主事件边界；`passengers.js::prepareTick` 触发每分钟配车；`simulation-wasm.js::dispatchFrame` 提供发车元数据；`service-plan.js::duration/headway/loopDwell` 计算派生运行参数 | `temporal.rs` 配车分配/服务刷新，`simulation.rs` 调度与运动，`operations.rs` 贷款切分和分钟门控，`engine.rs` 有界多步 | 原生持有服务时长、运营窗、发车计划和事件日历；由一个入口跨分钟推进。只在用户编辑、预算、外部数据或 UI 查询时让出；对照高峰/末班/还款/环线及余量，分别统计调用次数和 CPU。 |
| P0-2 | `queue-runtime.js::pose/projectCommands/trainView` 写列车、车厢、站台/站外/换乘镜像；`passengers.js::materialize/compactDefinitions/snapshot/restore/reconcile` 维护目录、重编号与运行副本；`simulation-wasm.js::timedFrame` 每次扫描全目录检查日需求差异 | 原生已持有运动、队列、实际出行 ID、统计、经济状态；采样日需求已支持差量输入 | Rust 作为运行状态的唯一权威源，UI 返回可见列车/分线/分站摘要，保存由原生生成快照；需求目录用修订号/明确修改集合替代全量扫描。保留完整 JSON 导入兼容、乘客守恒及暂停/编辑原子性，验收 JS 堆、传输字节和主线程长任务。 |
| P1-1 | `ridership.js::ensureDay/step`、`flow-history.js` 日切、30 日归档、分时窗口、滚动小时裁剪；`insights.js::records/daily` 里程/收入等里程碑汇总 | `statistics.rs` 日/线/站事件、周转量、分时累计与客流纪录 | 把归档和纪录规则与原生统计生命周期合并，避免分钟重载统计帧；逐字段对照 07:00/跨日、缺失与零值、历史截断、成就去重。HTML/图表仍在前端。 |
| P1-2 | `passengers.js::reroute` 接住原生改签请求，在 JS 组织寻路、重建出行定义、沿用旧票价并注册新 ID；`reconcile` 安排旧几何列车退役与档案 | 搜索、路径票价及换乘在 `lib.rs`，队列事件和改签请求在 `queues.rs` | 原生端完成失效后缀、续程、继承票价与新 ID 的整段事务；宿主只发送线网修订。保持原先候车/车内人数、旧票价、退役列车和找不到路径时的取消语义。 |
| P1-3 | `urban-growth.js::autoFacilities/context/zone/candidates/step/advance/city` 设施选址、覆盖、开发阈值/升级和人口就业变化；`city-development.js::phase/potential/score/budgets/allocate` 阶段释放与住宅/商业/工业预算 | `world.rs/demand.rs` 对给定城市的客流预测；原生反馈覆盖缓存不等于城市生长已迁移 | 一次城市 tick 返回变更地块、设施、人口/岗位总量和需求修订；固定随机/遍历顺序，对照东京/大湾区、土地约束、分阶段预算、空白开局及增长上限。 |
| P1-4 | `demand-snapshot.js::capture` 预测输入快照，`demand-world.js::encode/readForecast` 数值拼装与完整 flows/path 对象重建，`demand-model.js::evaluate` 之后调用 `connection-model.js::summarize` 派生分线连接摘要 | 整段 OD、接驳/枢纽、方式和容量分配已经在 `world.rs/demand.rs`，无需重复重写 | 统一预测/运行的线网与城市修订，原生保留紧凑预测目录，按需输出诊断和显示摘要；核对既有预测、枢纽总量、路径/票价与缓存预算，减少大量 JS 对象构造及跨 Worker 快照。 |
| P2-1 | `network.js::addLine/addStation/removeStation/removeLine/configure/mergeNearby`；`service-plan.js::compile/expand/network/validate` 交路展开、服务图构建、共享站点/跨线校验和运营规则；几何平滑还影响实际里程 | 原生寻路消费服务图，原生运动消费轨道及停站表 | 原生建设/配置命令统一校验并产出受影响范围、服务修订和几何；按线路与交路稳定 ID 增量更新。验证环线、折返、快慢/直达/跨线、规格锁定、合并站、失败回滚及撤销。SVG/拾取保留 JS。 |
| P2-2 | `management.js::quote/preview/change/init` 建设报价、回收、克隆事务和版本返还；`fleet.js::purchase/free/reserved/validate/configure/value` 车型库存、预留、规格约束和车辆资产价值 | `operations.rs` 已负责余额、经营成本、利息、借还款和欠费 | 报价、库存变更、资产差额和扣款在同一原生命令内提交；预览与实际使用相同规则，余额不足和无效交路无副作用。经营财务无需重写。 |
| P2-3 | `operations-center.js::analyze/preview` 加减车/交路建议，`operations-review.js::sample/baseline/record/observe` 调整效果，`network-stats.js::aggregate/finish` 专业指标，`alerts.js::evaluate` 拥挤报警 | 原生有实时统计原料；诊断 Worker 只是把 JS 分析换线程 | 从原生状态一次查询断面、负载、等待和经营摘要，再批量生成证据/建议；按面板频率查询，保留“不足样本”与实际观察窗口，不改客流算法。卡片和建议文案留 JS。 |
| P2-4 | `local-save.js::numbers/validateRidership/parse`、`management.signature`、`passengers.restore`、`network.validate`、`urban-growth.validate` 等结构与关联校验；旧模型 `legacyTick` 与旧运行/需求路径 | 默认模型的多数计算在 Rust，原生状态尚非完整存档模型 | 原生版本化快照、关联校验与迁移；先覆盖现有存档再删除旧模型桥接。JSON 文件选择/下载、IndexedDB、错误提示仍在浏览器。 |

P0-1 与 P0-2 建议交替推进：持久状态不足时，只加原生循环会继续为编码/镜像付费。P1-1、P1-2 补齐连续运行生命周期；城市与建设是独立大批次，随后再合并为更长的自主循环。

## 保留在浏览器的职责

地图瓦片/网络访问、缩放/拖拽/命中交互、DOM/CSS/SVG/Canvas、主题、输入表单、图表、文件 API、IndexedDB 和 Worker 调度继续使用 JS。`operations.js::position` 等几何插值服务于动画，不能只因文件内有数值计算就一并迁走；实际轨道长度/连通校验则属于核心规则。

## 验收标准

1. 同一输入固定随机种子，完整状态与字段顺序对照；覆盖现有 57 项回归与 Rust 单元测试。
2. 主线程任务时间、端到端 CPU、每游戏分钟跨线程/语言次数、编码/传输量、JS 堆和 WASM 线性内存分开测量。
3. 不以降低需求量、跳过乘客、缩减候车或丢失历史换取速度；每一步验证乘客守恒、贷款边界、存档恢复和热编辑连续性。
4. 已有 MAP51 小场景同步 CPU 负收益的证据，优先验证状态/投影优化是否真正改善，不用“Rust 化比例”代替性能结果。
