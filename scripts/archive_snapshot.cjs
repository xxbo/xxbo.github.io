// Run before collection (preserve previous published state) and after (archive new state).
const fs=require('node:fs'),path=require('node:path'),Desk=require('../desk.js'),Technical=require('../technical.js'),MarketContext=require('../market-context.js'),Brief=require('../brief.js');
const file=path.join(__dirname,'../data/dashboard.json');
if(fs.existsSync(file)){
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(Desk.day(data.generated_at)){
  data.desk_history=Desk.archive(data.desk_history,Desk.capture(data,Technical,MarketContext,Brief));
  data.desk_history_policy={days:45,timezone:'Asia/Shanghai',snapshot:'每天最后一次成功发布快照；逐市场保留原始时间和来源状态'};
  fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(file+'.tmp',file);
  console.log(`Daily archive: ${data.desk_history.length} observed dates`);
 }
}
