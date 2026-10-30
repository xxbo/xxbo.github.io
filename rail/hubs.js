/* Observed counts are movements/boardings, never unique residents. Model splits are explicit assumptions. */
(function(root){'use strict';
const project=(lat,lon)=>({x:(lon-139.15)*2000+80,y:(36.04-lat)*2470+60});
const sources={east:'https://www.jreast.co.jp/company/data/passenger/2024_shinkansen.html/',central:'https://www.jrta.co.jp/pdf/mediadiv/2026/JRTOKAI_MEDIAGUIDE_2026_web_all.pdf',haneda:'https://www.tokyo-airport-bldg.co.jp/files/sustainability/all_2025.pdf',narita:'https://www.narita-airport.jp/files/9b9205bb414b6ec62db13f3e9162de34eb3ba2da1b0e9162de34eb3ba2da1b0e4d',bus:'https://www.ktr.mlit.go.jp/ktr_content/content/000911158.pdf',port:'https://www.mlit.go.jp/maritime/content/001892914.pdf'};
sources.narita='https://www.narita-airport.jp/en/company/airport-operation/operation/';
const list=[
{id:'haneda',name:'羽田机场',type:'airport',icon:'✈',lat:35.5494,lon:139.7798,observed:87910000,period:'2024 财年',unit:'年旅客吞吐人次',basis:'annual-both',landside:.8,visitor:.65,scope:'国内 6,499 万＋国际 2,292 万；进出港合计。机场整体，不是单座航站楼。',source:sources.haneda},
{id:'narita',name:'成田国际机场',type:'airport',icon:'✈',lat:35.772,lon:140.3929,observed:40770000,period:'2024 财年',unit:'年旅客吞吐人次 · 约数',basis:'annual-both',landside:.85,visitor:.75,scope:'官方年度总量约 4,077 万；包含无需进城的中转，模型另扣除非陆侧需求。',source:sources.narita},
{id:'tokyo',name:'东京站 · 新干线',type:'rail',icon:'↗',lat:35.6812,lon:139.7671,observed:174823,period:'2024 财年',unit:'日均上车人次',basis:'daily-depart',landside:.75,visitor:.6,scope:'JR 东日本 70,323＋JR 东海 104,500。仅新干线上车；未计普通通勤列车。',source:sources.east,extraSource:sources.central},
{id:'ueno',name:'上野站 · 新干线',type:'rail',icon:'↗',lat:35.7138,lon:139.7773,observed:12622,period:'2024 财年',unit:'日均上车人次',basis:'daily-depart',landside:.9,visitor:.55,scope:'JR 东日本新干线上车，不含下车或普通铁路。',source:sources.east},
{id:'omiya',name:'大宫站 · 新干线',type:'rail',icon:'↗',lat:35.9064,lon:139.6239,observed:32143,period:'2024 财年',unit:'日均上车人次',basis:'daily-depart',landside:.8,visitor:.55,scope:'JR 东日本新干线上车；部分旅客在站内转往其他城际铁路。',source:sources.east},
{id:'shinagawa',name:'品川站 · 新干线',type:'rail',icon:'↗',lat:35.6285,lon:139.7388,observed:37200,period:'2024 财年',unit:'日均上车人次',basis:'daily-depart',landside:.85,visitor:.6,scope:'JR 东海新干线上车。下车方向由模型估算，不是观测值。',source:sources.central},
{id:'shinyokohama',name:'新横滨站 · 新干线',type:'rail',icon:'↗',lat:35.5075,lon:139.6177,observed:34100,period:'2024 财年',unit:'日均上车人次',basis:'daily-depart',landside:.85,visitor:.55,scope:'JR 东海新干线上车，不含在来线。',source:sources.central},
{id:'busta',name:'新宿高速巴士总站',type:'bus',icon:'↔',lat:35.6885,lon:139.7008,observed:165629/7,period:'2024-12-08—14 样本周',unit:'样本周日均使用人次',basis:'daily-both',landside:1,visitor:.55,scope:'样本周七天利用人数的均值，不是全年日均。到达/出发按各半估算。',source:sources.bus},
{id:'yokohama-port',name:'横滨港 · 邮轮客运群',type:'port',icon:'⚓',lat:35.451,lon:139.648,observed:400564,period:'2024 年',unit:'年邮轮上下船人次',basis:'annual-both',landside:.95,visitor:.85,scope:'大栈桥、新港、大黑三个码头合计；标记为大栈桥参考位置。年均摊分，非每日实测。',source:sources.port}
].map(h=>Object.freeze({...h,...project(h.lat,h.lon)}));Object.freeze(list);
function daily(h){return h.basis==='daily-depart'?h.observed*2:h.basis==='annual-both'?h.observed/365:h.observed;}
function envelope(h){const total=daily(h)*h.landside;return {movements:daily(h),landside:total,visitorArrivals:total/2*h.visitor,visitorReturns:total/2*h.visitor,localDepartures:total/2*(1-h.visitor),localReturns:total/2*(1-h.visitor)};}
const ACCESS={narita:{railReference:.56,source:'https://www.mlit.go.jp/report/press/content/001893802.pdf',note:'2024年出发旅客铁路分担率56%；参考值，不是玩家地铁保底份额',staff:40000,staffSource:'https://www.narita-airport.jp/ja/company/sustainability/examples/employee-break-room-expansion/'},haneda:{railReference:.55,note:'游戏参考值，非羽田整体观测分担率'},rail:{railReference:.65,note:'城际铁路换乘偏好为游戏假设'},bus:{railReference:.5,note:'巴士接驳偏好为游戏假设'},port:{railReference:.45,note:'港口接驳偏好为游戏假设'}};
function access(h){return ACCESS[h.id]||ACCESS[h.type]||ACCESS.rail;}
function share(h,{minutes,access:walk,fare,km},kind){const a=access(h),employee=kind?.startsWith('staff'),value=employee?40:60,rail=minutes+1.3*walk+fare/value,reference=12+km/30*60+(180+km*12)/value;
 // Reference share is an odds anchor, not a floor. Slow/costly services can approach zero.
 const anchor=employee?.35:a.railReference,logOdds=Math.log(anchor/(1-anchor))+(reference-rail)/12;return 1/(1+Math.exp(Math.max(-60,Math.min(60,-logOdds))));}
const api={access,share,list,daily,envelope,project};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailHubs=api;
})(typeof globalThis!=='undefined'?globalThis:this);
