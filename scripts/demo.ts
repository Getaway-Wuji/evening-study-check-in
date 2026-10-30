import { ready,one,run,transaction,rulesFor,demoMode } from '../lib/db';
import { createSession } from '../lib/service';
import { passwordHash,token } from '../lib/auth';
import { dateCN,addDays } from '../lib/domain';
import { mkdir,writeFile } from 'node:fs/promises';
import { localPath } from '../lib/files';
if(process.env.VERCEL||process.env.DEMO_MODE!=='true'||!/file:/.test(process.env.DATABASE_URL||''))throw new Error('演示数据只能写入本地专用文件数据库');
await ready();
if(await one("SELECT id FROM users WHERE code='demo-admin'")){console.log('本地演示数据已存在，保留已有试用操作。');process.exit(0);}
const password=token().slice(0,20),pw=await passwordHash(password),today=dateCN();
await transaction(async tx=>{
  await run("INSERT INTO users(id,code,name,role,password_hash,created_at) VALUES('demo-admin','demo-admin','班级管理员','admin',?,?)",[pw,Date.now()],tx);
  const students=[];
  for(let i=1;i<=39;i++){
    const code=`2026${String(i).padStart(2,'0')}`;students.push({code,name:`同学 ${String(i).padStart(2,'0')}`});
    await run("INSERT INTO users(id,code,name,role,password_hash,created_at) VALUES(?,?,?,'student',?,?)",[`student-${i}`,code,`同学 ${String(i).padStart(2,'0')}`,i<=36?pw:null,Date.now()],tx);
  }
  await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({className:'我们的班级',capacity:39,adminEmails:[],locationConfigured:false})],tx);
  for(let offset=-6;offset<=28;offset++){
    const date=addDays(today,offset);
    if([0,6].includes(new Date(date).getUTCDay())&&offset!==0)continue;
    const sid=await createSession(date,tx),rules=JSON.stringify(await rulesFor(date,tx));
    if(offset<=0){
      for(let i=2;i<=(offset===0?27:35);i++){
        if(offset===0&&[3,4,5,6,7].includes(i))continue;
        await run('INSERT INTO checkins(id,session_id,user_id,submitted_at,latitude,longitude,accuracy,distance,photo_ids,note,rule_snapshot,rule_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',[crypto.randomUUID(),sid,`student-${i}`,Date.parse(`${date}T17:${String(31+i%20).padStart(2,'0')}:00+08:00`),39.999,116.326,15,12+i,'[]','演示记录',rules],tx);
      }
      if(offset===0){
        for(let i=3;i<=7;i++){
          const id=crypto.randomUUID(),fileId=crypto.randomUUID();
          await mkdir('data/uploads',{recursive:true});
          const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cGZkAAAAASUVORK5CYII=','base64');
          await writeFile(localPath(fileId),png);
          await run('INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,?,?,?,?,?,1,?,?)',[fileId,`student-${i}`,'示例证明.png','image/png',png.length,fileId,'proof',Date.now()],tx);
          await run('INSERT INTO leaves(id,user_id,kind,reason,proof_ids,created_at) VALUES(?,?,?,?,?,?)',[id,`student-${i}`,i%2?'personal':'sick','这是一条演示申请，用于体验审批流程；请用真实材料替换正式申请。',JSON.stringify([fileId]),Date.now()-i*360000],tx);
          await run('INSERT INTO leave_items(id,leave_id,user_id,session_id,status,review_note,reviewed_at) VALUES(?,?,?,?,?,?,?)',[crypto.randomUUID(),id,`student-${i}`,sid,i<=4?'approved':'pending',i<=4?'演示审批通过':null,i<=4?Date.now():null],tx);
          await run("INSERT INTO email_jobs(id,leave_id,status,next_attempt,error,created_at) VALUES(?,?,'blocked',?,?,?)",[crypto.randomUUID(),id,Date.now(),'演示环境未配置邮件，不会发送真实邮件',Date.now()],tx);
        }
      }
    }
  }
  await mkdir('.local',{recursive:true});await writeFile('.local/demo-credentials.json',JSON.stringify({admin:'demo-admin',password,students},null,2));
});
console.log('39 人演示班级已就绪。登录页可一键体验；数据均为虚构，模拟打卡时间为每天 17:45。');
process.exit(0);
