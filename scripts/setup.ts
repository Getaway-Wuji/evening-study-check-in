import { ready,one,run } from '../lib/db';
import { passwordHash } from '../lib/auth';
await ready();
const username=process.env.ADMIN_USERNAME||'teacher',password=process.env.ADMIN_PASSWORD;
if(!password||password.length<14)throw new Error('请先在环境配置中设置至少 14 位的 ADMIN_PASSWORD');
if(await one('SELECT id FROM users WHERE code=?',[username]))console.log('管理员已存在，未覆盖密码。');
else {await run("INSERT INTO users(id,code,name,role,password_hash,created_at) VALUES(?,?,?,'admin',?,?)",[crypto.randomUUID(),username,'班级管理员',await passwordHash(password),Date.now()]);console.log('正式管理员初始化完成。请登录后台设置班级信息、人数上限并导入学生名单。');}
process.exit(0);
