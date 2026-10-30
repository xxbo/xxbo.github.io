# 底图分层调研与选型

当前 GSI pale 和 OSM PNG 都是栅格成图，无法从图片可靠地拆分建筑、铁路或文字。需要矢量要素。

| 方案 | 可拆分 | 托管条件 | 本次选择 |
|---|---|---|---|
| 国土地理院最適化ベクトルタイル PMTiles | 道路、水域、建筑、铁路、行政界、注记等 | 官方公开数据，无需 API key，需标注出处 | 已接入东京圈；Canvas 2D 绘制 |
| MapLibre GL JS + 矢量瓦片 | 通过样式层 visibility 开关 | 浏览器需要 WebGL；数据服务另选 | 可行，但本次测试浏览器无法创建 WebGL，改用 Canvas |
| Protomaps 区域 PMTiles | OSM 道路、建筑、用地与标签等 | 可自行截取和静态托管；不建议直接热链每日全世界下载文件 | 后续备选，避免当前引入大体积区域文件 |

默认开启道路、水域和行政地名，关闭建筑、现实铁路、行政边界与设施名称。地名按文字后缀归类并做碰撞避让，设施需在更大缩放级别显示。现实铁路是背景参考，与游戏轨道相互独立。所有开关保持在浏览器本地。数据不可达时提示并回退地理院图片底图；图片底图不能拆分图层。

渲染器使用固定版本 pmtiles 3.2.1 浏览器包读取官方 PMTiles 的 HTTP 字节范围；瓦片按视口加载，读取 MVT protobuf 层及几何，Canvas 2D 绘制。无需账户或服务端，不批量下载全国数据。PMTiles JavaScript 包来自 unpkg CDN，数据依赖官方服务可用性。

来源：
- https://github.com/gsi-cyberjapan/optimal_bvmap （官方数据、字段与使用条款）
- https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setlayoutproperty
- https://docs.protomaps.com/basemaps/downloads
- https://github.com/protomaps/PMTiles
