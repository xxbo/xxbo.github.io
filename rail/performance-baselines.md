# Rust 迁移性能对照约定

从 MAP56 起，每个迁移批次同时报告相对上一版的增量收益，以及相对固定未 Rust 基线的累计收益。正负变化都保留，规则迁移、吞吐提升、内存变化和主线程隔离分开验收。

## 固定未 Rust 基线

完整 JavaScript 版本固定为 `498c5cd2af607e60dd1c75a8ba5863c08ac5d4fa`，即首次 Rust 寻路迁移 MAP41 的父提交。基线工作树要求跟踪文件无修改，运行子进程检查没有加载 Rust 适配器；不以“上一版仍有部分 JS”代替纯 JS 基线。

当前累计基准覆盖连续运营核心：相同序列化世界和需求预测输入、同一 0.1 游戏分钟步长、30 分钟预热与 5 × 30 分钟测量。对纯 JS、当前同步 Rust 和当前 Rust Worker 分别启动独立进程，第二轮逆序运行；完整世界及运行快照必须严格一致，不删除字段后才比较。

本项不计预测生成、专项寻路、建设、地图和 DOM 渲染，所以结果只代表连续运营核心。未来迁移预测、城市或建设时，应另用同一原始提交中的对应模块建立可核验的同输入对照；若功能无法等价，明确标注缺失对照，先补齐基准。

## 每批必须列出的口径

- 上一版 → 本版：相同完整结果下的批次耗时、进程 CPU、传输量和请求数，及内存变化。
- 固定纯 JS → 本版：纯 JS、同步 Rust、Worker 三种运行方式的耗时与内存；传输的纯 JS 基线为零，只列新增字节/请求，不计算除零百分比。
- 内存分列 GC 后保留 JS 堆、WASM 线性内存和进程峰值 RSS。RSS 含线程栈、JIT、模块等，不能直接等同于浏览器页面占用。
- 以 1 ms 采样测 Node 主事件循环最大延迟，作为线程隔离实验指标；不据此推断浏览器 FPS。
- 用 `(本版 / 基线 - 1) × 100%` 表示耗时/占用变化：负数为减少，正数为增加。算法一致性、工作负载、版本、环境和随机/遍历顺序同时记录。
- 出现负收益时说明瓶颈和下一步动作；不使用 Rust 文件数量或迁移比例代替性能证据。

## 复现

```sh
git worktree add --detach /tmp/rail-js-baseline 498c5cd2af607e60dd1c75a8ba5863c08ac5d4fa
RAIL_JS_BASELINE=/tmp/rail-js-baseline node scripts/benchmark_rail_cumulative.cjs 5
RAIL_JS_BASELINE=/tmp/rail-js-baseline node scripts/benchmark_rail_cumulative.cjs 7
node --expose-gc scripts/benchmark_rail_worker56.cjs 5
node --expose-gc scripts/benchmark_rail_worker56.cjs 7
```

计时基准按需运行，不进入 CI 的性能阈值判定；精确状态回归继续作为 CI 门槛。MAP56 的当前结果、限制与后续工作见 [实施报告](rust-wasm-map56.md)。

## MAP59 / P1 四单元验收

新增 `benchmark_rail_p1.cjs` 同时比较固定纯JS、MAP57 Worker、本版同步与Worker；不同模式只加载各自的预测表示。`benchmark_rail_p1_cold.cjs` 分别比较结构迁移、城市tick和完整预测。大预测每进程使用一次冷构建，传入 `RAIL_FORECAST_SAMPLES=1`，避免连续多份大预测的峰值干扰。完整参数、正负结果及数据见 [MAP59](rust-wasm-map59.md)。
