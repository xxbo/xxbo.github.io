# MAP50：原生准备批次、覆盖缓存、直接列车行计算与预算推进

## 本版完成的四项

1. **反馈→采样→发车准备批次**：`engine_prepare`在同一次Rust调用中运行满意度/旧模型反馈、整数或加权到达采样、发车判断。按实际线路ID映射，把刚更新的满意度、认知和信任直接用于本次采样；未知/退役线路保留原来的处理。JS只准备数值元数据和投影结果。构造发车元数据可能调用其他原生函数，因此先完成这些调用，再编码采样缓存token，避免内存重建使已编码的增量帧过期。
2. **原生覆盖关系缓存**：`CoverageCache`精确比较节点坐标、设施坐标/规模、线路站序和可连接状态，复用设施覆盖/可达关系。设施升级、原地移动节点、增删站线或平峰/高峰可连接状态变化都会使缓存失效；不依赖对象引用或碰撞概率。仅保留最近一份几何关系。为保持既有浮点舍入，几何距离仍使用宿主`Math.hypot`；缓存跳过了大量重复几何计算及其边界调用。
3. **预算批量推进接入UI**：`advanceBudget`统一初始化和固定成本元数据，按时间、步数或取消信号返回剩余请求。保留MAP49 UI的0.1分钟外层请求分段，包括贷款到期时一个请求内部的切分、分钟门控、城市与诊断回调顺序；到期后的剩余0.065分钟仍按原请求完成。积压请求允许超过一天，但单批最多执行设定步数，剩余时间继续保留。时间预算包含初始化，预算只能在完整的旧请求间让出。
4. **列车运动临时表清理**：原生增量/持久运动内核直接遍历列车行，复用同一个单列车运动函数，去掉每步拼接20字段整表及再次读取它的过程。共享区间优先级、浮点顺序、停站、环线与退役行为保持一致。

运行诊断增加“准备批次 · MAP50 / 覆盖缓存复用”，主界面保持原样。

## 验证

- 17项Rust单元测试、JS语法及52组回归通过。
- 新增288个完整MAP49状态检查点、200个预算/时钟/世界状态检查点、450个队列管理检查点，共938个完整对照；JSON字段顺序同样对照。
- 冻结MAP49代码及其独立v9 WASM实例，避免新旧对照共享更新后的内核。覆盖新旧需求模型、整数/加权乘客、直接改日需求、未知线路、现金/贷款、统计插入顺序、跨日/峰谷、线路编辑、预算暂停/续算、超长积压和强制原生重建。
- 145次新链改签续算与冻结版一致，未提前或重复经营结算。
- 运动内核调整后额外通过1082个连续模拟检查点、1196个采样比较，以及上述三组新增对照。
- 浏览器手动新建东京站—神田—上野站测试线（3站约4.03km），购买/投放2列6B；预算运行至10:29，完成出行2。手动保存并刷新，保留线路、2列车、10:29和完成出行2；继续运行至14:44，完成出行2→5；诊断显示准备批次290、覆盖缓存复用256，在线仍为2列车。
- 12游戏小时预算分批推进，12次重算与12次JSON存档往返：生成6168、完成6044，守恒成立；采样堆在测试后段稳定。

## 实测与限制

冻结MAP49使用独立旧v9内核，MAP50使用v10；共用相同预测输入。版本顺序每轮交替，进程隔离。每进程预热30分钟，测5段120游戏分钟。旧版每段1200次0.1分钟管理调用；新版120次1分钟预算请求，内部保持相同0.1分钟步序。计时阶段无其他基准/测试，页面尚未启动；每一轮最终完整状态SHA256一致。预测工作区在连续阶段前释放，RSS为整个进程峰值（包括初始化、编译和预测），不是纯仿真内存。

| 场景 | 轮数 | MAP49中位数 | MAP50中位数 | 耗时变化 | RSS峰值旧/新 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10线/25站/0设施 | 2 | 177.508ms | 187.071ms | +5.39% | 165.52/174.96MiB |
| 14线/49站/0设施 | 2 | 345.164ms | 324.568ms | -5.97% | 285.46/295.97MiB |
| 14线/49站/48设施 | 4 | 418.093ms | 378.898ms | -9.37% | 324.65/337.55MiB |

含设施场景约9.4%收益；普通14线约6%收益，普通10线约5.4%回退。小场景增加了准备批次编码/投影等开销，覆盖缓存对无设施场景收益有限；2轮数据不足以推断所有规模的稳定收益，因此完整保留回退结果。上述是Node计算耗时，浏览器FPS另测；速度收益按场景分别记录。

预算是协作式让出：单个原生事务、城市生长或诊断回调仍可能超过预算；独立仿真Worker与完整原生跨步循环仍是后续任务。客流、票价、满意度和成本平衡参数沿用MAP49。

12小时压力测试：7830ms，采样JS堆峰值24.05MiB，进程RSS峰值270.45MiB。现有64MiB基础回收、按工作集学习至192MiB的回收预算及256MiB原生内存上限保持。

`rail/wasm/rail-core-v10.wasm`：437889字节；SHA256 `dab0e2e9f5e84c7e4d97542249848f3e6cc68739682ea6214847c60321d09a2f`。历史v1—v9保留，默认资源v10。

## 还剩哪些（按原定顺序）

| 批次 | 当前进度 | 剩余内容 |
| --- | --- | --- |
| 1 连续仿真闭环 | 时序规则、准备批次、队列/统计/经营事务已原生；宿主预算推进已接入 | 融合准备与运行两个批次；把建立列车/实际出行对象的边界搬进原生，再做Rust跨多步循环及Worker隔离。 |
| 2 运行状态统一持有 | 队列、车内乘客、运动/财务已持有原生状态 | 精简JS全量镜像，改成变化/摘要查询，减少逐步编码与投影。 |
| 3 城市生长与设施 | JS | 用地倾向、开发升级、人口/就业、设施生成及发展阶段。 |
| 4 线网/交路/车库 | JS | 建设命令、站点合并、曲线、环线/跨线校验、规格与配车规则。 |
| 5 建设资产与交易 | 经营和借贷已Rust，建设仍JS | 建设/回收/购车报价、库存价值、原子扣款与回滚。 |
| 6 运营查询与诊断 | 事件统计已Rust，其余JS | 断面/负载/建议、调整效果、报警、归档、成就与查询。 |
| 7 存档及兼容收尾 | 现有JS兼容格式保持 | 原生快照/恢复校验、版本迁移和容量管理，再清理被替代的生产JS计算。 |

前端地图、DOM/Canvas、主题、文件选择和IndexedDB仍是宿主职责。按能力域计数不等于性能完成率。

## 重现

```sh
node scripts/run_rail_tests.cjs
node scripts/benchmark_rail_operations50.cjs 5 2 ui 0
node scripts/benchmark_rail_operations50.cjs 7 2 ui 0
node scripts/benchmark_rail_operations50.cjs 7 4 ui 48
node --expose-gc --max-old-space-size=512 scripts/stress_rail_memory50.cjs
node scripts/build_rail_wasm.cjs --check
```

## 原始样本

```json
{
  "benchmarks": [
    {
      "workload": "Alternating version order; each isolated process: 30 warmup minutes + 5 x 120 game minutes; full operating/accounting state parity",
      "requestMode": "MAP49: 1200 x .1-minute requests; MAP50: 120 budget batches x 1 minute, same .1-minute quanta",
      "rounds": 2,
      "facilities": 0,
      "summary": [
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 177.50777499999992,
          "maxRssMB": 165.5234375,
          "maxHeapMB": 22.07477569580078,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26"
        },
        {
          "backend": "map50",
          "lines": 10,
          "stations": 25,
          "medianMs": 187.070743,
          "maxRssMB": 174.95703125,
          "maxHeapMB": 21.574241638183594,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26"
        }
      ],
      "results": [
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 179.58481699999993,
          "samplesMs": [
            238.61848999999995,
            179.58481699999993,
            172.42425900000012,
            161.53600800000004,
            204.45301100000006
          ],
          "rssMB": 165.5234375,
          "heapMB": 21.90442657470703,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 1
        },
        {
          "backend": "map50",
          "lines": 10,
          "stations": 25,
          "medianMs": 175.31354499999998,
          "samplesMs": [
            225.45422200000007,
            175.31354499999998,
            163.46945000000005,
            152.4638010000001,
            195.21940300000006
          ],
          "rssMB": 174.95703125,
          "heapMB": 21.574241638183594,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 1
        },
        {
          "backend": "map50",
          "lines": 10,
          "stations": 25,
          "medianMs": 187.32195000000002,
          "samplesMs": [
            237.975685,
            187.32195000000002,
            186.81953599999997,
            169.5782069999998,
            209.491223
          ],
          "rssMB": 165.625,
          "heapMB": 21.445037841796875,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 2
        },
        {
          "backend": "map49",
          "lines": 10,
          "stations": 25,
          "medianMs": 175.43073299999992,
          "samplesMs": [
            228.31420200000002,
            175.43073299999992,
            165.77078499999993,
            158.42172199999982,
            190.63444600000003
          ],
          "rssMB": 158.1171875,
          "heapMB": 22.07477569580078,
          "checksum": "fe0d8f255ede4df9e0208a77a5546a9495ec0b9b77abd1842747faf61706bb26",
          "round": 2
        }
      ]
    },
    {
      "workload": "Alternating version order; each isolated process: 30 warmup minutes + 5 x 120 game minutes; full operating/accounting state parity",
      "requestMode": "MAP49: 1200 x .1-minute requests; MAP50: 120 budget batches x 1 minute, same .1-minute quanta",
      "rounds": 2,
      "facilities": 0,
      "summary": [
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 345.1635204999993,
          "maxRssMB": 285.4609375,
          "maxHeapMB": 57.853248596191406,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99"
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 324.5678390000003,
          "maxRssMB": 295.97265625,
          "maxHeapMB": 57.05094909667969,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99"
        }
      ],
      "results": [
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 367.923909000001,
          "samplesMs": [
            472.18320999999924,
            367.923909000001,
            325.5023919999985,
            294.2809359999992,
            376.78523399999904
          ],
          "rssMB": 285.4609375,
          "heapMB": 57.853248596191406,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 1
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 320.6695099999997,
          "samplesMs": [
            447.42680499999915,
            316.34595699999954,
            320.6695099999997,
            285.8155979999992,
            377.3299229999993
          ],
          "rssMB": 295.97265625,
          "heapMB": 57.04963684082031,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 1
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 328.46616800000083,
          "samplesMs": [
            446.00235800000155,
            328.46616800000083,
            304.54982500000006,
            272.9529739999998,
            373.0278020000005
          ],
          "rssMB": 283.984375,
          "heapMB": 57.05094909667969,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 2
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 310.3389159999988,
          "samplesMs": [
            420.2639139999992,
            310.3389159999988,
            295.8417070000014,
            263.1976130000003,
            364.82464900000014
          ],
          "rssMB": 282.96875,
          "heapMB": 57.73445129394531,
          "checksum": "4c3ebaec53b48ba68b069c124bc5b24c80dc85d667731f96fc634425cea0cb99",
          "round": 2
        }
      ]
    },
    {
      "workload": "Alternating version order; each isolated process: 30 warmup minutes + 5 x 120 game minutes; full operating/accounting state parity",
      "requestMode": "MAP49: 1200 x .1-minute requests; MAP50: 120 budget batches x 1 minute, same .1-minute quanta",
      "rounds": 4,
      "facilities": 48,
      "summary": [
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 418.09286149999843,
          "maxRssMB": 324.6484375,
          "maxHeapMB": 78.62519073486328,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb"
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 378.8977300000006,
          "maxRssMB": 337.5546875,
          "maxHeapMB": 78.01163482666016,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb"
        }
      ],
      "results": [
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 385.54011999999966,
          "samplesMs": [
            464.6763200000005,
            347.67147099999966,
            385.54011999999966,
            322.5315069999997,
            430.4400030000015
          ],
          "rssMB": 320.41796875,
          "heapMB": 78.62519073486328,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 1
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 413.2248440000003,
          "samplesMs": [
            523.1915540000009,
            372.2228209999994,
            413.2248440000003,
            339.65453100000013,
            444.00215800000115
          ],
          "rssMB": 321.5546875,
          "heapMB": 77.92658996582031,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 1
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 410.14309100000173,
          "samplesMs": [
            525.3040620000011,
            358.0397470000007,
            410.14309100000173,
            324.45336399999724,
            417.69682799999646
          ],
          "rssMB": 321.390625,
          "heapMB": 77.92991638183594,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 2
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 427.4774780000007,
          "samplesMs": [
            509.4204180000015,
            375.1334659999993,
            428.5144849999997,
            331.15131700000165,
            427.4774780000007
          ],
          "rssMB": 324.0703125,
          "heapMB": 78.49552154541016,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 2
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 423.31682199999705,
          "samplesMs": [
            546.5474060000015,
            412.8689009999998,
            449.9727819999989,
            361.639710999998,
            423.31682199999705
          ],
          "rssMB": 324.07421875,
          "heapMB": 78.5794906616211,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 3
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 359.69078099999933,
          "samplesMs": [
            441.33251500000006,
            317.949947000001,
            359.69078099999933,
            287.2500300000029,
            385.5726390000018
          ],
          "rssMB": 320.2265625,
          "heapMB": 78.01163482666016,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 3
        },
        {
          "backend": "map50",
          "lines": 14,
          "stations": 49,
          "medianMs": 357.46634500000073,
          "samplesMs": [
            449.02477999999974,
            320.0503259999987,
            357.46634500000073,
            287.7992350000004,
            391.04088500000034
          ],
          "rssMB": 337.5546875,
          "heapMB": 77.93541717529297,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
          "round": 4
        },
        {
          "backend": "map49",
          "lines": 14,
          "stations": 49,
          "medianMs": 400.28380599999946,
          "samplesMs": [
            480.3887310000009,
            352.16303999999946,
            400.28380599999946,
            318.8037039999999,
            435.0947039999992
          ],
          "rssMB": 324.6484375,
          "heapMB": 78.49492645263672,
          "checksum": "9bbd84f293a87ccd841467c4708e108bcd36d6d1a8b7fef7bc0a6601d8f60ebb",
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
    "wallMs": 7830,
    "peakSampledHeapMB": 24.05,
    "peakProcessRSSMB": 270.45,
    "measurements": [
      {
        "hour": 1,
        "heapMB": 23.08,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 2,
        "heapMB": 23.66,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 3,
        "heapMB": 23.92,
        "profiles": 6000,
        "realized": 6000,
        "trains": 74,
        "saveMB": 0.07
      },
      {
        "hour": 4,
        "heapMB": 23.69,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 5,
        "heapMB": 23.7,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 6,
        "heapMB": 23.84,
        "profiles": 6000,
        "realized": 6000,
        "trains": 74,
        "saveMB": 0.07
      },
      {
        "hour": 7,
        "heapMB": 23.7,
        "profiles": 6000,
        "realized": 6000,
        "trains": 74,
        "saveMB": 0.07
      },
      {
        "hour": 8,
        "heapMB": 23.76,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.06
      },
      {
        "hour": 9,
        "heapMB": 23.86,
        "profiles": 6000,
        "realized": 6000,
        "trains": 72,
        "saveMB": 0.07
      },
      {
        "hour": 10,
        "heapMB": 23.91,
        "profiles": 6000,
        "realized": 6000,
        "trains": 76,
        "saveMB": 0.07
      },
      {
        "hour": 11,
        "heapMB": 23.9,
        "profiles": 6000,
        "realized": 6000,
        "trains": 76,
        "saveMB": 0.07
      },
      {
        "hour": 12,
        "heapMB": 24.05,
        "profiles": 6000,
        "realized": 6000,
        "trains": 76,
        "saveMB": 0.07
      }
    ]
  }
}
```
