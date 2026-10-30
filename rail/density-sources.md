# 城市密度数据与模型边界

MAP 07 的密度不再由铁路或预置车站生成。默认地图覆盖范围由固定地理栅格填充，建设、删除线路不改变底层人口或土地分类。

## 人口

来源：[WorldPop Japan 2020, UN-adjusted population counts](https://hub.worldpop.org/geodata/summary?id=36979)，DOI: 10.5258/SOTON/WP00671。WorldPop / University of Southampton，CC BY 4.0。

这是 2020 年人口分布**模型估算**，不是当前人口普查或实时人数。原始分辨率为 30 弧秒，约 1 km；保留原生网格，提取地图范围并四舍五入为整数。地图共 18,025 格，15,313 格有人口有效值，人口合计 36,328,266。海域或原始无数据格保留缺失标记，不能解读为零人口。范围为地图矩形，并非东京都行政范围。

## 工厂用地

来源：日本国土交通省 [国土数值信息・都市地域土地利用细分网格 2021](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L03-b-u-2021.html)，[官方分类代码](https://nlftp.mlit.go.jp/ksj/gml/codelist/LandUseCd-09-u.html)，CC BY 4.0。

使用 5239、5240、5339、5340、5439、5440 六个二次网格档案。原始分类为约 100 m 网格，以面积重叠汇总至人口网格；0702 类为工厂。地图显示工厂用地占格内面积的比例，非工人数量或工业产值。调查仅涵盖指定都市地域，**缺测区域用灰色显示，不补成零**。其他已分类非工厂用地可为零。网格边界按日本标准地域网格坐标恢复，未使用铁路点位。

## 推算项目

高层建筑类包含住宅和商用，无法直接当成商铺清单。岗位、商业机会、休闲机会、每个人口组的目的地及出行量均为游戏模型：由人口、工厂、高层建筑、公共设施、公园面积推算，并明确标记。它们不代表官方就业或商户统计。

人口的步行覆盖沿用网格中心至车站的直线距离 ×1.25、最大 800 m 的近似计算；约 1 km 的人口数据不足以表达街道或楼宇精度。放大地图不会增加人口统计分辨率。

## 构建与署名

`python scripts/build_rail_density.py` 下载、校验并生成 `rail/tokyo-data.js`。需要 Python 的 numpy、rasterio、pyshp。生成包内嵌来源 URL、SHA-256、年份、许可、缺失标记和压缩栅格；网页直接读取该离线包，无人口 API 请求。下载资料由 WorldPop 和日本国土交通省提供，提取、汇总和游戏机会模型由本项目处理。

许可：[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)。街道底图的国土地理院或 OpenStreetMap 署名独立显示。
