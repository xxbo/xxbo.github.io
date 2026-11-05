# 轨道都市代码维护指南（MAP38–43）

这是分批重构的第一轮。保留无构建步骤的 GitHub Pages 发布方式、现有全局 API、游戏版本7、存档格式1和两个地图的独立存档键。没有更换框架、修改需求公式、计费规则、模拟步长或随机数顺序。

## 模块职责

| 层 | 主要文件 | 约束 |
| --- | --- | --- |
| 城市与需求 | city-development、urban-growth、city、demand-model、connection-model | 地理约束、活动供给和目的地需求；不引用DOM |
| 原生预测 | routing-wasm、demand-world、Rust world/demand核心 | JS仅编码/投影；接驳、枢纽、分组、寻路与分配整段执行 |
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

ui仍包含地图编辑、导航、表单和多个长模板；本轮没有一次性重写。后续适合依次抽出线路编辑交互控制器、地图视图控制器和存档读写控制器，并为每次提取保留行为对照。性能优化应以测量为准，避免把持久化格式改造、玩法改动和代码搬迁混进同一批。

## MAP39：前端展示层重构

页面模板由 `ui.js` 分离为 `ui-line-view`（线路五类标签与交路局部）、`ui-center-view`（运营中心）、`ui-finance-view`（财务模板与实时读模型）、`ui-stations-view`（候车列表读模型与行模板）、`ui-save-view`（存档状态与预览）。它们通过 `create(dependencies)` 接收格式化及领域查询依赖，通过函数参数接收状态，返回HTML或读模型。事件监听、输入读取、操作校验、文件读写和模拟仍归主控制器。原有 `review-view` 继续使用。

`ui-dom` 汇集文字更新、局部补丁、按ID协调列表和焦点保护。线路、成就、效果卡片和车站行都使用原有ID；新增项创建、删去项移除、重排项移动，已有项保留节点身份。详情展开及表单选择由调用方明确指定保留。财务流水、贷款列表、候车表格是控制器维护的子树，更新页面外壳时跳过这些子树，随后单独刷新。报警类名也有明确的保留选项。

候车读模型用一次线网遍历整理站点所属线路；重排时复用行节点，名称或线路名变化也会更新。运营中心排序使用结果数组副本。HUD中相同文字跳过写入。保存和游戏状态结构沿用原格式。

验证：`test_rail_map39.cjs` 对照提取前MAP38源码生成的35组SHA256，覆盖空/非空线网、五个线路标签、快速/跨线/环线、中心筛选、财务与存档预览，要求原始HTML逐字一致；另测只读性、候车排序、换乘归属、改名、搜索和转义。冻结哈希位于 `scripts/fixtures/rail-ui-map38-hashes.json`，固定场景位于 `rail-ui-scenario.cjs`。新增页面应按功能增加明确数据契约与测试，避免通过全局状态回调隐式取数。

浏览器DOM契约位于 `scripts/fixtures/rail-ui-dom.html`。开发预览中复制到静态根目录并将脚本路径指向 `rail/ui-dom.js` 后运行；该QA页面不随游戏发布。验证400行重排复用、空列表双向切换、文字更新、焦点/光标选区、已选金额、展开状态和控制器子树保留，额外覆盖问号说明装饰器插入包装后控件重建的情况。400行重排中，旧整体替换重建400行，协调器创建0行、复用400行。这衡量节点重建数量；浏览器帧率另行测量。

## MAP40：内存与后台任务

专项方法、内存口径、测量数据和复现命令见 [memory-performance-map40.md](memory-performance-map40.md)。`bounded-cache` 管理单轮计算缓存，`save-queue` 在快照编码前施加背压，`demand-snapshot` 投影后台输入，`memory-audit` 保存有界轻量诊断。寻路内部使用边链，公开完整路径保持兼容。压测脚本与冻结MAP39寻路对照均归入scripts；基准与长期运行脚本按需执行，CI自动发现MAP40回归测试。

## MAP41：Rust/WASM第一阶段

寻路核心与旧存档公司票价寻路已迁入 `rust/rail-routing`。`routing-wasm.js`只维护二进制ABI和旧API返回对象，生产JS搜索实现已删除。页面与两个计算Worker必须先加载适配器并等待 `RailRoutingReady`；测试Node入口同步实例化同一提交产物。详细边界、构建/产物核对、基准与后续迁移顺序见 [rust-wasm-map41.md](rust-wasm-map41.md)。修改Rust时同步重建WASM，CI的逐字节核对通过后才发布；旧JS只在scripts测试目录作为冻结对照。

## MAP42：需求数值核

新增Rust `demand`模块与JS `demand-kernels`传输层，将OD/IPF、方式选择、频率策略和容量分配循环迁入同一WASM核心，删除生产DD中的旧算法。详细ABI、标准Math导入、缓冲区所有权、对照与性能取舍见 [rust-wasm-map42.md](rust-wasm-map42.md)。需求模型的接驳/枢纽/分组协调和连续模拟继续按批迁移。页面和demand-worker必须在demand-model前加载demand-kernels；共享实例初始化仍等待RailRoutingReady。当前构建产物为core-v2，CI重建核验；MAP41旧二进制仅兼容缓存中的旧客户端。

完整需求批量迁移、所有权和对照结果见 [MAP43](rust-wasm-map43.md)。
