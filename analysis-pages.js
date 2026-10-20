'use strict';
function technicalPreview(m) {
  const t=Technical.analyze(m.history);if(!t.available||t.count<20)return '';
  return `<section class="technical-preview"><div><div class="eyebrow">TECHNICAL SNAPSHOT</div><h2>技术面速览</h2><p>截至 ${esc(t.asof)} · 已完成日线</p></div><div><span>${t.current.close>=t.current.ma20?'MA20 上方':'MA20 下方'}</span><span>RSI ${num(t.current.rsi)}</span><span>MACD ${t.current.hist==null?'样本不足':t.current.hist>=0?'正柱':'负柱'}</span></div><a class="solid-button" href="#/markets/${encodeURIComponent(m.id)}/technical">查看详细技术分析 →</a></section>`;
}
function techLineChart(rows,lines,{height=220,range=null,bars=null,thresholds=[]}={}) {
  const W=780,L=65,R=18,T=20,B=28,H=height,plotW=W-L-R,plotH=H-T-B;
  const values=rows.flatMap(r=>lines.map(l=>l.value(r))).filter(Number.isFinite);
  if(bars)rows.forEach(r=>{const v=bars(r);if(Number.isFinite(v))values.push(v,0);});
  if(!values.length)return '<p class="empty">计算所需样本不足</p>';
  let [lo,hi]=range||[Math.min(...values),Math.max(...values)];if(hi===lo){lo-=1;hi+=1;}const padding=range?0:(hi-lo)*.08;lo-=padding;hi+=padding;
  const x=i=>L+i/Math.max(rows.length-1,1)*plotW,y=v=>T+(hi-v)/(hi-lo)*plotH;
  const ticks=range?[0,30,70,100]:Array.from({length:4},(_,i)=>lo+(hi-lo)*i/3);
  const axisValue=v=>Math.abs(v)>=1e8?(v/1e8).toFixed(1)+'亿':Math.abs(v)>=1e6?(v/1e4).toFixed(0)+'万':num(v);
  const grid=ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e7eeea" stroke-dasharray="3 4"/><text x="${L-9}" y="${y(v)+3}" text-anchor="end" fill="#94a69b" font-size="10">${range?v:axisValue(v)}</text>`).join('');
  const refs=thresholds.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#c2cec7" stroke-dasharray="5 5"/>`).join('');
  const hist=bars?rows.map((r,i)=>{const v=bars(r);if(!Number.isFinite(v))return '';return `<rect x="${x(i)-plotW/rows.length*.28}" y="${Math.min(y(v),y(0))}" width="${Math.max(1,plotW/rows.length*.56)}" height="${Math.max(.7,Math.abs(y(v)-y(0)))}" fill="${v>=0?'#c77970':'#559e8d'}" opacity=".75"><title>${esc(r.date)}：${num(v)}</title></rect>`;}).join(''):'';
  const paths=lines.map(l=>{let d='',valid=false;rows.forEach((r,i)=>{const v=l.value(r);if(!Number.isFinite(v)){valid=false;return;}d+=(valid?' L':' M')+x(i).toFixed(2)+','+y(v).toFixed(2);valid=true;});return `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width||1.7}" ${l.dashed?'stroke-dasharray="5 3"':''}/>`;}).join('');
  const title=lines.map(l=>l.label).join(' / ');
  return `<svg class="tech-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title||'柱状数据')}，${esc(rows[0].date)}至${esc(rows.at(-1).date)}">${grid}${refs}${hist}${paths}<text x="${L}" y="${H-5}" fill="#97a89e" font-size="10">${esc(rows[0].date)}</text><text x="${W-R}" y="${H-5}" text-anchor="end" fill="#97a89e" font-size="10">${esc(rows.at(-1).date)}</text></svg><div class="chart-legend">${lines.map(l=>`<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join('')}</div>`;
}
function technicalPage(m) {
 const t=Technical.analyze(m.history);
 if(!t.available||t.count<20)return '<div class="chart-empty"><h3>技术分析样本不足</h3><p>至少需要 20 根已完成日线。当前来源尚未提供足够历史，不生成推测指标。</p></div>';
 const c=t.current,rows=t.series.slice(-techPeriod),pct=v=>v==null?'—':(v>0?'+':'')+v.toFixed(2)+'%';
 const priceLines=[{label:'收盘',value:r=>r.close,color:'#325d54',width:2.2}];
 if(techOverlay==='ma')priceLines.push({label:'MA5',value:r=>r.ma5,color:'#c6a05d'},{label:'MA20',value:r=>r.ma20,color:'#8c7bb1'},{label:'MA60',value:r=>r.ma60,color:'#6893b1'});
 else priceLines.push({label:'BOLL 中轨',value:r=>r.bb?.mid,color:'#c6a05d'},{label:'上轨',value:r=>r.bb?.upper,color:'#b89b94',dashed:true},{label:'下轨',value:r=>r.bb?.lower,color:'#7ea89b',dashed:true});
 const macd=techLineChart(rows,[{label:'DIF',value:r=>r.dif,color:'#c6a05d'},{label:'DEA',value:r=>r.dea,color:'#8c7bb1'}],{height:150,bars:r=>r.hist,thresholds:[0]});
 const rsi=techLineChart(rows,[{label:'RSI(14)',value:r=>r.rsi,color:'#6b92a4'}],{height:135,range:[0,100],thresholds:[30,70]});
 const volume=rows.some(r=>Number.isFinite(r.volume))?techLineChart(rows,[],{height:120,bars:r=>r.volume}):'<p class="empty">没有可核实的量能数据</p>';
 const metric=(label,value,caption,cls='')=>`<div class="technical-metric"><small>${label}</small><strong class="${cls}">${value}</strong><p>${caption}</p></div>`;
 return `<div class="technical-intro"><div class="eyebrow">TREND · MOMENTUM · VOLATILITY</div><h2>技术面观察</h2><p>计算截至 <b>${esc(t.asof)}</b>，共 ${t.count} 根已完成日线。来源 ${esc(m.history_source||'待更新')}，采集 ${esc(fmt(m.history_fetched_at))}。${t.partialExcluded?'当前盘中日线已排除。':''}${m.history_status==='stale'?' 历史来源刷新失败，使用已有历史。':''}</p></div>
 <nav class="technical-jumpbar" aria-label="技术分析章节"><button data-scroll-section="tech-context">结构背景</button><button data-scroll-section="tech-price">价格图表</button><button data-scroll-section="tech-macd">动能指标</button><button data-scroll-section="tech-values">关键数值</button></nav>
 ${technicalContextPanel(m)}
 <div class="technical-metrics">${metric('20 日涨跌',pct(t.returns[20]),'与 20 个交易日前收盘比较',direction(t.returns[20]))}${metric('RSI(14)',num(c.rsi),c.rsi>=70?'高于 70 · 强势区':c.rsi<=30?'低于 30 · 弱势区':'30–70 · 中间区域')}${metric('MACD 柱值',num(c.hist),'2 × (DIF − DEA)',direction(c.hist))}${metric('相对活动量',t.volumeRatio==null?'—':t.volumeRatio.toFixed(2)+'×','最新日线 / 此前 20 日均值')}</div>
 <div class="tech-controls"><div class="period-buttons">${[60,120,200].map(p=>`<button data-tech-period="${p}" class="${p===techPeriod?'selected':''}">${p}交易日</button>`).join('')}</div><div class="period-buttons"><button data-tech-overlay="ma" class="${techOverlay==='ma'?'selected':''}">均线叠加</button><button data-tech-overlay="boll" class="${techOverlay==='boll'?'selected':''}">布林带叠加</button></div></div>
 <section class="technical-plot" id="tech-price" tabindex="-1"><h3>价格与${techOverlay==='ma'?'均线':'布林带'}</h3>${techLineChart(rows,priceLines)}</section><section class="technical-plot" id="tech-macd" tabindex="-1"><h3>MACD(12, 26, 9)</h3>${macd}</section><section class="technical-plot"><h3>RSI(14) <small>30 / 70 参考线</small></h3>${rsi}</section><section class="technical-plot"><h3>量能 <small>源端原始单位，仅在同一指数内比较</small></h3>${volume}</section>
 <section class="technical-observations"><h2>这些数据说明了什么</h2><p class="chart-caption">由固定规则解释已发生的行情，不是 AI 预测或买卖评分。</p><div>${t.observations.map(o=>`<article><h3>${esc(o.title)}</h3><p>${esc(o.text)}</p></article>`).join('')}</div></section>
 <section class="indicator-table-section" id="tech-values" tabindex="-1"><h2>关键数值与区间</h2><div class="table-wrap"><table class="history-table"><thead><tr><th>指标</th><th>数值</th><th>口径</th></tr></thead><tbody>${[...[5,10,20,60,120].map(p=>['MA'+p,num(c['ma'+p]),p+' 根日线收盘简单均值']),['DIF / DEA',num(c.dif)+' / '+num(c.dea),'EMA12 − EMA26 / DIF 的 EMA9'],['BOLL 上 / 中 / 下',c.bb?[c.bb.upper,c.bb.mid,c.bb.lower].map(num).join(' / '):'—','20 日均值 ± 2 倍总体标准差'],['ATR(14)',num(c.atr),'14 日 Wilder 平滑真实波幅'],['20 日年化波动率',t.volatility==null?'—':t.volatility.toFixed(2)+'%','20 个对数日收益，样本标准差 × √252'],['距 60 日最高收盘',pct(t.drawdown60),'当前完整日线收盘相对区间高点'],['20 日收盘范围',num(t.low20)+' – '+num(t.high20),'历史区间，不等于预测支撑/压力位']].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div></section>
 <details class="indicator-methods"><summary>查看计算方法与数据边界</summary><p>MA 为简单移动均值；MACD 的 EMA 以首个周期简单均值初始化，使用 12/26/9 参数，柱值按国内常见口径乘 2。RSI 使用 Wilder 的 14 周期平滑；完全横盘时本站定义为 50。BOLL 使用 20 周期总体标准差。ATR 使用真实波幅的 14 周期 Wilder 平滑。不同软件的初始化、历史长度和数据源可能导致小幅差异。</p><p>当前日线未完成时从技术计算中排除；顶部报价仍可能是盘中数据。量能采用供应商原始字段，未统一各市场单位，因此只展示同指数内的相对量能，不作跨市场对比。缺失指标显示 —。</p><p>方法参考：<a href="https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi" target="_blank" rel="noopener noreferrer">Wilder RSI ↗</a> · <a href="https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/macd-moving-average-convergence-divergence-oscillator" target="_blank" rel="noopener noreferrer">MACD ↗</a></p></details>`;
}
