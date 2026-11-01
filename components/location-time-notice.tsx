export default function LocationTimeNotice({timeBasis}:{timeBasis?:'fresh-request'}){
  return timeBasis?<p className="field-hint" role="status">已启用鸿蒙定位时间兼容：按本次定位请求校验有效期，请取得位置后及时提交。</p>:null;
}
