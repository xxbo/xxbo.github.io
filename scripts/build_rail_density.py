"""Rebuild the bundled regional grid. Requires rasterio, numpy, pyshp.
Sources: WorldPop 2020 UN-adjusted 30-arcsecond population estimates (CC BY 4.0)
and MLIT L03-b-u 2021 land-use classification (CC BY 4.0). Download only 6 named
regional source archives. No runtime analytics API is required by the game.
"""
import argparse,base64,gzip,hashlib,io,json,math,struct,urllib.request,zipfile
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import from_bounds,Window
import shapefile
ROOT=Path(__file__).resolve().parents[1]
POP='https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/JPN/jpn_ppp_2020_1km_Aggregated_UNadj.tif'
LAND='https://nlftp.mlit.go.jp/ksj/gml/data/L03-b-u/L03-b-u-21/'
p=argparse.ArgumentParser();p.add_argument('--cache',default='/tmp/rail-landuse');args=p.parse_args();cache=Path(args.cache);cache.mkdir(exist_ok=True,parents=True)
def download(url,path):
 if not path.exists():
  with urllib.request.urlopen(url,timeout=60) as r:path.write_bytes(r.read())
 return hashlib.sha256(path.read_bytes()).hexdigest()
pop=cache/'jpn_population_2020.tif'
if Path('/tmp/jpn_population_2020.tif').exists() and not pop.exists():pop.write_bytes(Path('/tmp/jpn_population_2020.tif').read_bytes())
popsha=download(POP,pop)
# Cover the whole 2900 x 2100 map; edges are the outermost native raster pixels.
bounds=(139.11,36.04-(2100-60)/2470,139.15+(2900-80)/2000,36.04+60/2470)
with rasterio.open(pop) as src:
 win=from_bounds(*bounds,transform=src.transform);r0=math.floor(win.row_off);c0=math.floor(win.col_off);rows=math.ceil(win.row_off+win.height)-r0;cols=math.ceil(win.col_off+win.width)-c0;arr=src.read(1,window=Window(c0,r0,cols,rows));tf=src.window_transform(Window(c0,r0,cols,rows));valid=(arr!=src.nodata)&np.isfinite(arr)&(arr>=0)
 print('grid',rows,cols,flush=True)
# Fractions: surveyed land, high-rise, factory, low-rise residential, park/public.
areas=np.zeros((rows,cols,6),dtype=np.float64);source_files=[];classified=0
for mesh in ['5239','5240','5339','5340','5439','5440']:
 name=f'L03-b-u-21_{mesh}-jgd2011_GML.zip';path=cache/name;sha=download(LAND+name,path);source_files.append({'url':LAND+name,'sha256':sha})
 with zipfile.ZipFile(path) as z:
  dbf=next(n for n in z.namelist() if n.endswith('.dbf'));reader=shapefile.Reader(dbf=io.BytesIO(z.read(dbf)),encoding='cp932')
  for rec in reader.iterRecords():
   s,code=rec[0],rec[1]
   if len(s)!=10 or not s.isdigit() or code in ['0000','9999']:continue
   lat=int(s[:2])*2/3+int(s[4])/12+int(s[6])/120+int(s[8])/1200
   lon=100+int(s[2:4])+int(s[5])/8+int(s[7])/80+int(s[9])/800
   h=1/1200;w=1/800
   if lon+w<tf.c or lon>tf.c+cols*tf.a or lat+h<tf.f+rows*tf.e or lat>tf.f:continue
   # Exact rectangle overlap in geographic coordinates, then fractions of the native population cell.
   x0=max(0,int(math.floor((lon-tf.c)/tf.a)));x1=min(cols-1,int(math.floor((lon+w-tf.c)/tf.a)))
   y0=max(0,int(math.floor((tf.f-lat-h)/(-tf.e))));y1=min(rows-1,int(math.floor((tf.f-lat)/(-tf.e))))
   for y in range(y0,y1+1):
    bottom=tf.f+(y+1)*tf.e;top=tf.f+y*tf.e;dy=max(0,min(top,lat+h)-max(bottom,lat))
    for x in range(x0,x1+1):
     dx=max(0,min(tf.c+(x+1)*tf.a,lon+w)-max(tf.c+x*tf.a,lon));fraction=dx*dy/(tf.a*(-tf.e));areas[y,x,0]+=fraction
     if code=='0701':areas[y,x,1]+=fraction
     elif code=='0702':areas[y,x,2]+=fraction
     elif code in ['0703','0704']:areas[y,x,3]+=fraction
     elif code=='1003':areas[y,x,4]+=fraction
     elif code=='1001':areas[y,x,5]+=fraction
   classified+=1
 print('land',mesh,classified,flush=True)
assert np.max(np.where(valid,arr,0)) < 65535, 'Population count exceeds UInt16 range'
values=np.rint(np.where(valid,arr,0)).clip(0,65535).astype(np.uint16);fractions=np.rint(areas.clip(0,1)*255).astype(np.uint8)
raw=bytearray()
for y in range(rows):
 for x in range(cols):raw.extend(struct.pack('<HB6B',int(values[y,x]),int(valid[y,x]),*map(int,fractions[y,x])))
meta={'schema':1,'populationYear':2020,'landUseYear':2021,'populationKind':'WorldPop UN-adjusted model estimate','populationUrl':'https://hub.worldpop.org/geodata/summary?id=36979','populationDownload':POP,'populationSha256':popsha,'landUseUrl':'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L03-b-u-2021.html','landUseCodes':'https://nlftp.mlit.go.jp/ksj/gml/codelist/LandUseCd-09-u.html','license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','rows':rows,'cols':cols,'lon0':tf.c+tf.a/2,'lat0':tf.f+tf.e/2,'stepLon':tf.a,'stepLat':tf.e,'recordBytes':9,'fields':['populationCountUInt16','populationValidUInt8','urbanSurveyFractionUInt8','highRiseFractionUInt8','factoryFractionUInt8','lowRiseFractionUInt8','parkFractionUInt8','publicFractionUInt8'],'populationSum':int(values.sum()),'validPopulationCells':int(valid.sum()),'urbanSurveyCells':int((fractions[:,:,0]>=3).sum()),'sourceFiles':source_files,'notes':['Population is an estimate for 2020, not current census or building counts.','Urban land-use data covers designated urban regions; unclassified locations are missing, not zero factories.','Commercial opportunities and employment are game-model estimates derived from population and land-use, not observed business statistics.']}
b64=base64.b64encode(gzip.compress(bytes(raw),mtime=0)).decode()
js='''/* Regional real-data extract. Attribution and processing: density-sources.md and build_rail_density.py. */
(function(root){'use strict';const metadata=META;const packed='PACKED';
if(typeof module!=='undefined'&&module.exports){module.exports={...metadata,raw:new Uint8Array(require('node:zlib').gunzipSync(Buffer.from(packed,'base64')))};}
else root.RailDataReady=(async()=>{const bytes=Uint8Array.from(atob(packed),c=>c.charCodeAt(0)),stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),raw=new Uint8Array(await new Response(stream).arrayBuffer());if(raw.length!==metadata.rows*metadata.cols*metadata.recordBytes)throw Error('人口数据长度不匹配');root.RailCityData={...metadata,raw};})();
})(typeof globalThis!=='undefined'?globalThis:this);
'''.replace('META',json.dumps(meta,ensure_ascii=False,separators=(',',':'))).replace('PACKED',b64)
(ROOT/'rail'/'tokyo-data.js').write_text(js)
print('output',len(js),'bytes; population',values.sum(),'valid',valid.sum(),'land',int((fractions[:,:,0]>=3).sum()),flush=True)
