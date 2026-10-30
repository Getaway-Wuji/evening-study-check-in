// 名单保留姓名原始写法；核对时忽略全半角与意外空白。
export function normalizeStudentName(value:string){return value.normalize('NFKC').replace(/\s+/g,'');}
export function normalizeStudentCode(value:string){return value.normalize('NFKC').trim();}
