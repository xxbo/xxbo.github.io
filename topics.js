'use strict';
const Topics = (()=>{
 const definitions=[
  {id:'ai',name:'AI 与算力',description:'模型能力、应用落地与算力投入',keywords:['人工智能','大模型','算力','OpenAI','DeepSeek','Anthropic','Claude','ChatGPT','AI','GPU','英伟达','数据中心'],markets:['usIXIC'],watch:'跟踪产品发布、商业化数据与算力投入兑现；报道中的规划与已经发生的结果分开读。'},
  {id:'chips',name:'半导体',description:'芯片、存储与产业供需',keywords:['半导体','芯片','存储','晶圆','台积电','中芯','光刻','DRAM','HBM','英伟达','海力士','三星电子'],markets:['sh000688'],watch:'留意报价、订单、库存与产能的后续披露；单家公司消息不能直接代表整个行业。'},
  {id:'growth',name:'双创',description:'创业板与科创板的市场结构',keywords:['创业板','科创板','科创50','双创','科创综指','科创100'],markets:['sz399006','sh000688'],watch:'把指数完整日线的趋势变化与公司、政策报道交叉查看，新闻热度不等于指数盈利改善。'},
  {id:'hk',name:'港股科技',description:'港股科技指数与重点公司动态',keywords:['恒生科技','恒科','港股科技','腾讯','阿里巴巴','阿里','美团','小米','快手','京东','百度','网易'],markets:['hkHSTECH'],watch:'关注公司业绩与业务披露，同时留意利率环境；公司层面的消息与指数层面的判断分别核对。'},
  {id:'macro',name:'国内宏观政策',description:'政策、增长、通胀与信用环境',keywords:['国务院','财政部','央行','人民银行','发改委','证监会','中国经济','国民经济','降准','LPR','降息','财政政策','货币政策','中国CPI','中国PMI'],markets:['sh000001'],watch:'核对政策原文、实施日期与后续官方数据；公布安排与实际公布结果分开跟踪。'}
 ];
 function byId(id){return definitions.find(t=>t.id===id);}
 function hits(text,keywords){return keywords.filter(word=>{const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return /^[a-z0-9 ]+$/i.test(word)?new RegExp('\\b'+escaped+'\\b','i').test(text):text.toLowerCase().includes(word.toLowerCase());});}
 function match(article,topic){const text=(article.title||'')+' '+(article.summary||'');if(topic.id==='macro'&&/美联储|美国|日本央行|欧洲央行|英国央行|澳洲联储/.test(text)&&!/中国|国内|国务院|中国人民银行|证监会|国家发改委|LPR/.test(text))return {matched:false,terms:[],basis:'标题'};const title=hits(article.title||'',topic.keywords);const summary=hits(article.summary||'',topic.keywords);return {matched:!!(title.length||summary.length),terms:[...new Set([...title,...summary])].slice(0,3),basis:title.length?'标题':'来源摘要'};}
 function entries(data,topic){
  const events=data.events?.length?data.events:(data.news||[]).map(n=>({id:n.event_id||n.id,first_seen:n.first_seen,last_activity:n.updated_at,articles:[n]}));
  const lookup=new Map((data.news||[]).map(n=>[n.id,n]));
  return events.flatMap(event=>{const candidates=event.articles.map(a=>lookup.get(a.id)||a).map(article=>({article,match:match(article,topic)})).filter(x=>x.match.matched).sort((a,b)=>(b.match.basis==='标题')-(a.match.basis==='标题')||(b.article.kind==='headline')-(a.article.kind==='headline')||String(b.article.published_at||'').localeCompare(String(a.article.published_at||'')));
   return candidates.length?[{event,...candidates[0],activity:event.last_activity||candidates[0].article.published_at}]:[];
  }).sort((a,b)=>String(b.activity||'').localeCompare(String(a.activity||'')));
 }
 function changes(rows,since){const time=Date.parse(since);if(!Number.isFinite(time))return null;return {new:rows.filter(x=>Date.parse(x.event.first_seen)>time).length,updated:rows.filter(x=>Date.parse(x.event.first_seen)<=time&&Date.parse(x.event.last_activity)>time).length};}
 function calendarReason(event,topic){
  const text=(event.title||'')+' '+(event.original_title||'');
  const usKey=/Consumer Price|Producer Price|Employment Situation|Personal Income|Gross Domestic|GDP |FOMC|CPI|PCE|非农/i.test(text);
  if(topic.id==='macro'&&event.country==='中国')return '国内官方数据：观察增长、物价与政策背景。';
  if(['growth','hk'].includes(topic.id)&&event.country==='中国'&&/国民经济|采购经理|消费价格|工业生产者|工业经济/.test(text))return '宏观背景：观察国内需求、物价与经营环境。';
  if(['ai','chips','growth','hk'].includes(topic.id)&&event.country==='美国'&&usKey)return '宏观背景：跟踪美国增长、通胀与利率环境，不代表行业影响已确认。';
  return '';
 }
 function upcoming(data,topic,now=Date.now()){
  const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  return (data.calendar||[]).filter(e=>e.scheduled_at?Date.parse(e.scheduled_at)>=now:(e.end_date||e.date)>=new Date(now).toLocaleDateString('sv-SE',{timeZone:e.source_timezone||'America/New_York'})).flatMap(event=>{const reason=calendarReason(event,topic);return reason?[{event,reason}]:[];}).slice(0,3);
 }
 return {definitions,byId,hits,match,entries,changes,calendarReason,upcoming};
})();
if(typeof module!=='undefined')module.exports=Topics;
