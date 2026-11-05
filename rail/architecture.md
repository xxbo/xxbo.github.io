# 轨道都市代码维护指南（MAP38）

这是分批重构的第一轮。保留无构建步骤的 GitHub Pages 发布方式、现有全局 API、游戏版本7、存档格式1和两个地图的独立存档键。没有更换框架、修改需求公式、计费规则、模拟步长或随机数顺序。

## 模块职责

| 层 | 主要文件 | 约束 |
| --- | --- | --- |
| 城市与需求 | city-development、urban-growth、city、demand-model、connection-model | 地理约束、活动供给和目的地需求；不引用DOM |
| 线网与规则 | engine、network、service-plan、fleet | 编辑校验、轨道几何、交路、车型；不引用DOM |
| 连续模拟 | operations、passengers、demand-rates、ridership、management | 列车、乘客、满意度、财务与游戏时钟；不使用墙钟推动游戏 |
| 只读统计 | **network-stats**、metrics、insights、operations-center、operations-review | 观察已有数据，不生成乘客、不扣钱、不推进随机数 |
| 后台通信 | **worker-client**、demand-worker、operations-worker、save-worker | RPC超时、失效线程隔离；operations-worker另有预测版本缓存协议 |
| 诊断传输 | **diagnostic-snapshot** | 显式字段投影；不发送城市栅格、成就历史、效果记录和资金流水 |
| 本地存档 | save-store、local-save | 排队写入；编码/事务失败保留上次成功存档；JSON导入校验 |
| 展示与交互 | ui、shell-ui、console-ui、**review-view** | ui目前仍是主协调器；review-view只生成HTML，不接触DOM与存储 |
| 地图 | street-map、vector-map、view、map-detail、density-field | 图层与显示分级，不改变客流计算 |

`index.html` 的 defer脚本按依赖排序。`network-stats.js` 必须先于 network；worker-client先于save-store；review-view与diagnostic-snapshot先于ui。operations-worker也必须加载network-stats。新增模块须同时检查页面与Worker入口。

## 数据所有权与缓存

- `s` 保存持久化的游戏状态；`traffic` 是实时运行状态；`forecast` 是一次完整预测。
- 改动仍通过已有 `commit → Management.change → reconcile → 后台预测 → rebase` 流程。不要通过展示模块修改它们。
- `Network.stats` 保留旧API；列表改用 `Network.allStats`，单次遍历汇总所有线路。遍历中对同一线路的累加顺序与MAP37一致，跨线轨道的重复计费片段不重复计人。
- 统计汇总不做跨帧缓存：线路、票价、满意度都可能原地修改，仅凭对象引用缓存会返回旧数据。每次调用只共享当次的汇总与交路展开。
- 后台任务用单调ID匹配回包。单个计算错误只拒绝该任务；崩溃/超时回收线程并清理待处理任务；旧线程迟到回调不干扰新线程。postMessage同步抛错必须清理自己的定时器。
- 存档队列顺序不变。无Worker时仍在请求写入时同步序列化，避免等待期间 `s` 继续变化导致状态和运行快照错位。

## 本轮性能改动的边界

原运营中心/财务列表对每条线路重新遍历全部预测OD，并重新展开整张交路表。现改为一次预测遍历与一次展开；线网里程查找改用当次轨道索引。诊断传输改为白名单字段，不复制无关的大型历史数据。

这主要减少统计与后台诊断开销，**不能据此宣称整个游戏达到相同倍数的提速**。真实帧率还受列车数、站点、地图、设备和浏览器影响。

运行可复现的合成统计基准：

```sh
node scripts/benchmark_rail.cjs
```

场景为24条线、6万条预测出行，预热后5轮中位数，先断言与MAP37公式完全一致。本轮本机测量为179.07ms→37.61ms（约4.76倍），仅代表该合成统计任务。它不启动网页、不测量浏览器FPS。基准不放入CI速度门槛，避免硬件波动产生误报。

## 验证与发布

```sh
node scripts/run_rail_tests.cjs
```

该入口检查rail下所有JS语法，并自动发现全部 `scripts/test_rail*.cjs`，任何失败立即停止。工作流使用同一入口，新增测试不会漏加到CI。

MAP38新增：旧公式的冻结测试对照（普通/快车/跨线/环线/旧版）、原地修改后无过期结果、一次OD遍历、诊断瘦身前后输出一致、只读与转义、RPC并发/超时/崩溃/复制失败/迟到回调/备用与恢复。既有乘客守恒、9MB存档、Worker协议和效果观察测试全部保留。

手工验收：运行中打开运营中心、财务、线路/车站详情、调整效果；编辑并应用计划；确认输入焦点和候车连续；导出、导入、重载后恢复；东京/大湾区都启动。不要把测试存档或QA页面发布。

## 后续重构方向

ui仍包含地图编辑、导航、表单和多个长模板；本轮没有一次性重写。后续适合依次抽出线路编辑器、地图视图控制器和存档界面，并为每次提取保留行为对照。性能优化应以测量为准，避免把持久化格式改造、玩法改动和代码搬迁混进同一批。
