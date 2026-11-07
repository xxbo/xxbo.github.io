# MAP49：队列经营事务、原生状态复用与需求增量同步

## 已完成

1. `engine.rs`在同一原生事务内执行列车运动/队列、事件统计和经营结算，财务沿用原先浮点运算与累计顺序。改签续算的中间结果仅投影队列，完成全部改签后才结算一次，避免重复票款/费用。固定成本分摊读取该步最新的分线运行费用；原生统计同步分摊结果，移除管理热路径下一步重复回传的财务日志。
2. 原生持有余额、经营累计、贷款与分线权重。JS保留存档兼容镜像，通过可复用小型快照识别借还款、建设、外部修改、切换世界和内存重建，按需重载；不依赖不可追踪的版本号。结算时准备下一次常用0.1分钟请求的时钟，连续运行省去独立开始时钟调用。正常稳态的“开始时钟 + 队列 + 经营”由3次调用变成1次`engine_step`，分钟满意度/配车/需求采样仍有各自批次。
3. `simulation.rs`新增op9，原生持有日需求，JS扫描直接修改并只发送差异。15.1万条档案、1条线路的稳态输入由约1.21MB变为144字节，修改两条时为176字节；首次载入、目录更换或原生回收才发送全量。计算、RNG和乘客分配顺序不变。
4. 编码器直接构造合并输入，去掉一份队列整包复制；财务快照复用缓冲区。设置中的内存诊断新增合并事务计数与ABI，主页/需求Worker/诊断Worker一起更新资源版本。

## 验证

- 16项Rust单元测试；语法检查及49组回归全部通过。
- MAP49新增288个完整MAP48对照检查点，逐字段与JSON属性顺序一致；覆盖整数/加权到达、直接修改日需求、旧模型、外部统计、借还款、跨日/贷款到期切分、停运与原生强制重建。
- 另有450个管理链完整对照及145次改签续算；删站/删线、重算、车厢与队列、费用和票款均连续一致。
- 稳态40次0.1分钟UI请求对应40次合并事务，零次独立开始/结束经营调用；分钟反馈仍独立计算。
- 浏览器加载MAP48时期的IndexedDB测试存档，调整平峰投放并运行，2列车恢复、完成出行4→6；保存与刷新后保留2列车、20:25及完成出行6。
- 12游戏小时、12次重算、12次存档往返，守恒成立；最终生成6168、完成6044。

## 端到端计时

同机隔离子进程、版本顺序每轮交替，4轮；每进程预热30分钟，再测5段120游戏分钟，每段通过1200次0.1分钟请求推进。表中是各版本20个样本的中位数；所有轮次完整状态SHA256一致。测试期间不跑其他基准或测试，游戏页面暂停。Node计算耗时不等同浏览器FPS。

| 规模 | MAP48 | MAP49 | 耗时变化 | 进程RSS峰值旧/新 |
| --- | ---: | ---: | ---: | ---: |
| 10线/25站 | 212.902 ms | 199.528 ms | -6.28% | 183.75 / 178.02 MiB |
| 14线/49站 | 386.875 ms | 388.852 ms | +0.51% | 331.53 / 320.37 MiB |

10线有小幅收益，14线基本持平，未观察到大规模端到端显著加速。跨语言次数/输入字节减少已由断言验证，但其余调度、编码、投影和宿主计算仍占用时间。RSS为进程峰值，含预测构建/JIT/native，不作为长期泄漏结论。

12小时压力测试耗时7780ms，采样JS堆峰值23.91MiB、进程RSS峰值258.12MiB。op9额外持有每档案8字节日需求：151056条约1.15MiB原生内存，换取反复整包传输的消除；宿主保留相同量级的日需求比较缓存及分组索引。现有回收预算与256MiB原生上限保留。

## 资源

`rail/wasm/rail-core-v9.wasm`：431685字节；SHA256 `9e2aaf9ea40b3a224d14ff0d4f680d3c1116e1e787c6ac669412eab43daeb509`。保留v1—v8兼容历史资源，默认仅加载v9。

## 下一步边界

本版完成第一批第2步的一部分：队列/统计/经营事务及持久状态。完整长区间原生循环尚待完成：调度、到达、满意度仍由JS触发；城市生长、运营诊断、归档及视图镜像也仍在宿主。下一步继续收拢这些调用，按分钟/贷款/城市回调/编辑和时间预算设置返回点，再考虑独立仿真Worker。现有UI推进预算和旧存档格式保留。

## 重现

```sh
node scripts/test_rail_map49.cjs
node scripts/test_rail_map49_queue.cjs
node scripts/run_rail_tests.cjs
node scripts/benchmark_rail_operations49.cjs 5 4 ui
node scripts/benchmark_rail_operations49.cjs 7 4 ui
node --expose-gc --max-old-space-size=512 scripts/stress_rail_memory.cjs
node scripts/build_rail_wasm.cjs --check
```

## 原始样本

```json
{
  "benchmarks": [
    {
      "workload": "Alternating version order; each isolated process: 30 warmup minutes + 5 x 120 game minutes; full operating/accounting state parity",
      "rounds": 4,
      "summary": [
        {
          "backend": "map48",
          "lines": 10,
          "stations": 25,
          "medianMs": 212.902334,
          "maxRssMB": 183.74609375,
          "maxHeapMB": 21.8533935546875,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26"
        },
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 199.52833150000004,
          "maxRssMB": 178.015625,
          "maxHeapMB": 21.54564666748047,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26"
        }
      ],
      "results": [
        {
          "backend": "map48",
          "lines": 10,
          "stations": 25,
          "medianMs": 250.57498899999996,
          "samplesMs": [
            272.11555599999997,
            223.873243,
            250.57498899999996,
            248.87894199999982,
            288.05570699999976
          ],
          "rssMB": 178.140625,
          "heapMB": 21.849815368652344,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 1
        },
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 191.6142040000002,
          "samplesMs": [
            263.6418789999999,
            190.57553800000005,
            189.75144799999998,
            191.6142040000002,
            250.27547800000002
          ],
          "rssMB": 164.5703125,
          "heapMB": 21.54511260986328,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 1
        },
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 211.03707200000008,
          "samplesMs": [
            262.45563300000003,
            211.03707200000008,
            200.14313500000003,
            173.21122200000013,
            237.66001800000026
          ],
          "rssMB": 176.94921875,
          "heapMB": 21.335044860839844,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 2
        },
        {
          "backend": "map48",
          "lines": 10,
          "stations": 25,
          "medianMs": 209.82226100000003,
          "samplesMs": [
            239.689974,
            209.82226100000003,
            194.74965999999995,
            167.57405199999994,
            226.3653069999998
          ],
          "rssMB": 170.75390625,
          "heapMB": 21.8533935546875,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 2
        },
        {
          "backend": "map48",
          "lines": 10,
          "stations": 25,
          "medianMs": 193.911163,
          "samplesMs": [
            254.49088299999994,
            191.55632600000013,
            193.911163,
            164.60854499999982,
            215.38602100000003
          ],
          "rssMB": 177.70703125,
          "heapMB": 21.851181030273438,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 3
        },
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 195.12776600000007,
          "samplesMs": [
            284.8421400000001,
            195.12776600000007,
            182.7938569999999,
            161.00027099999988,
            227.08572300000014
          ],
          "rssMB": 178.015625,
          "heapMB": 21.514915466308594,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 3
        },
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 198.91352800000004,
          "samplesMs": [
            242.2469450000001,
            201.55372899999998,
            185.2298269999999,
            178.04038800000012,
            198.91352800000004
          ],
          "rssMB": 177.8125,
          "heapMB": 21.54564666748047,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 4
        },
        {
          "backend": "map48",
          "lines": 10,
          "stations": 25,
          "medianMs": 208.36291900000015,
          "samplesMs": [
            281.97572,
            208.36291900000015,
            210.41864699999996,
            191.7742360000002,
            200.18604499999992
          ],
          "rssMB": 183.74609375,
          "heapMB": 21.788330078125,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 4
        }
      ]
    },
    {
      "workload": "Alternating version order; each isolated process: 30 warmup minutes + 5 x 120 game minutes; full operating/accounting state parity",
      "rounds": 4,
      "summary": [
        {
          "backend": "map48",
          "lines": 14,
          "stations": 49,
          "medianMs": 386.87500999999975,
          "maxRssMB": 331.52734375,
          "maxHeapMB": 57.55126190185547,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99"
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 388.8516055,
          "maxRssMB": 320.37109375,
          "maxHeapMB": 57.12718963623047,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99"
        }
      ],
      "results": [
        {
          "backend": "map48",
          "lines": 14,
          "stations": 49,
          "medianMs": 366.8369670000011,
          "samplesMs": [
            526.6361209999995,
            366.8369670000011,
            353.3638239999982,
            278.47582800000237,
            383.75129200000083
          ],
          "rssMB": 320.08984375,
          "heapMB": 57.470436096191406,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 1
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 407.1272930000014,
          "samplesMs": [
            681.643449000001,
            389.56220699999903,
            407.1272930000014,
            356.7608289999989,
            472.19476099999883
          ],
          "rssMB": 317.8671875,
          "heapMB": 57.10212707519531,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 1
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 388.96705199999997,
          "samplesMs": [
            519.873963,
            388.96705199999997,
            384.16101999999773,
            321.67028899999787,
            477.86848199999804
          ],
          "rssMB": 320.37109375,
          "heapMB": 57.067176818847656,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 2
        },
        {
          "backend": "map48",
          "lines": 14,
          "stations": 49,
          "medianMs": 389.99872799999866,
          "samplesMs": [
            572.6612820000009,
            389.99872799999866,
            367.5577830000002,
            307.5476430000017,
            416.21822699999757
          ],
          "rssMB": 331.52734375,
          "heapMB": 57.55126190185547,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 2
        },
        {
          "backend": "map48",
          "lines": 14,
          "stations": 49,
          "medianMs": 342.4024190000018,
          "samplesMs": [
            484.71858900000007,
            324.955770999999,
            339.4658620000009,
            342.4024190000018,
            452.7548109999989
          ],
          "rssMB": 318.41796875,
          "heapMB": 57.548614501953125,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 3
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 388.73615900000004,
          "samplesMs": [
            476.57910900000024,
            372.43449599999985,
            388.73615900000004,
            337.4804260000019,
            422.86529900000096
          ],
          "rssMB": 319.1484375,
          "heapMB": 57.100791931152344,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 3
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 346.2493279999999,
          "samplesMs": [
            516.3078409999998,
            346.2493279999999,
            328.22463400000015,
            283.9832000000006,
            382.3282729999992
          ],
          "rssMB": 317.65625,
          "heapMB": 57.12718963623047,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 4
        },
        {
          "backend": "map48",
          "lines": 14,
          "stations": 49,
          "medianMs": 403.07052400000066,
          "samplesMs": [
            532.0358489999999,
            383.5487200000007,
            397.4034329999995,
            403.07052400000066,
            436.15924299999824
          ],
          "rssMB": 329.94921875,
          "heapMB": 57.514404296875,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 4
        }
      ]
    }
  ],
  "stress": {
    "lines": 10,
    "stations": 25,
    "gameHours": 12,
    "recalculations": 12,
    "saveRoundtrips": 12,
    "conservation": true,
    "completed": 6044,
    "generated": 6168,
    "wallMs": 7780,
    "peakSampledHeapMB": 23.91,
    "peakProcessRSSMB": 258.12,
    "measurements": [
      {
        "hour": 1,
        "heapMB": 23.04,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 2,
        "heapMB": 23.61,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 3,
        "heapMB": 23.83,
        "profiles": 6000,
        "realized": 6000,
        "trains": 74,
        "saveMB": 0.07
      },
      {
        "hour": 4,
        "heapMB": 23.71,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 5,
        "heapMB": 23.52,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 6,
        "heapMB": 23.67,
        "profiles": 6000,
        "realized": 6000,
        "trains": 74,
        "saveMB": 0.07
      },
      {
        "hour": 7,
        "heapMB": 23.58,
        "profiles": 6000,
        "realized": 6000,
        "trains": 74,
        "saveMB": 0.07
      },
      {
        "hour": 8,
        "heapMB": 23.62,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.06
      },
      {
        "hour": 9,
        "heapMB": 23.75,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 10,
        "heapMB": 23.75,
        "profiles": 6000,
        "realized": 6000,
        "trains": 76,
        "saveMB": 0.07
      },
      {
        "hour": 11,
        "heapMB": 23.77,
        "profiles": 6000,
        "realized": 6000,
        "trains": 76,
        "saveMB": 0.07
      },
      {
        "hour": 12,
        "heapMB": 23.91,
        "profiles": 6000,
        "realized": 6000,
        "trains": 76,
        "saveMB": 0.07
      }
    ]
  }
}
```
