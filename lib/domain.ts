// 旧记录与首次启用的初始类型；实际可用类型由班级后台配置。
export const leaveKinds:Record<string,string> = { personal: '事假', sick: '病假', free: '无理由请假' };
export type LeaveKind = string;
export interface Rules {
  studyStart: string; open: string; close: string;
  locationName: string; latitude: number; longitude: number; radius: number;
  locationRequired: boolean; accuracyLimit: number; locationMaxAge: number;
  locationConfirmed?: boolean; photoEnabled?: boolean; noteEnabled?: boolean;
  photoRequired: boolean; cameraOnly: boolean; noteRequired: boolean;
  proofRequired: Record<LeaveKind, boolean>;
}
export const defaultRules: Rules = {
  studyStart: '18:00', open: '17:30', close: '18:05',
  locationName: '尚未设置打卡地点', latitude: 0, longitude: 0,
  radius: 100, locationRequired: true, accuracyLimit: 50, locationMaxAge: 60,
  locationConfirmed: false, photoEnabled: false, noteEnabled: false,
  photoRequired: false, cameraOnly: true, noteRequired: false,
  proofRequired: { personal: true, sick: true, free: true },
};
export function dateCN(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function minuteCN(now = Date.now()) { const d = new Date(now + 8 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
export function timeMinutes(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
export function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function addDays(date: string, days: number) { return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10); }
export function period(date: string, rules: Rules, now = Date.now()): 'before' | 'open' | 'closed' {
  const day = dateCN(now);
  if (day < date) return 'before';
  if (day > date) return 'closed';
  const m = minuteCN(now);
  return m < timeMinutes(rules.open) ? 'before' : m > timeMinutes(rules.close) ? 'closed' : 'open';
}
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
// 浏览器定位为 WGS84，校园点位按 GCJ-02 配置，统一后再计算距离。
export function wgsToGcj(lat: number, lng: number): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lat, lng];
  const x = lng - 105, y = lat - 35, pi = Math.PI;
  let a = -100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x));
  a += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  a += (20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3;
  a += (160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
  let b = 300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
  b += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  b += (20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3;
  b += (150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
  const rad = lat*pi/180, magic = 1-0.00669342162296594323*Math.sin(rad)**2;
  a = a*180/((6378245*(1-0.00669342162296594323))/(magic*Math.sqrt(magic))*pi);
  b = b*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*pi);
  return [lat+a,lng+b];
}
export function checkLocation(rules: Rules, loc: { latitude: number; longitude: number; accuracy: number; capturedAt: number; coordinateSystem: 'wgs84' | 'gcj02' }, now = Date.now()) {
  if (now - loc.capturedAt > rules.locationMaxAge * 1000 || loc.capturedAt > now + 10000) throw new Error('位置已过期，请重新获取定位');
  if (loc.accuracy <= 0 || loc.accuracy > rules.accuracyLimit) throw new Error(`定位精度不足，请重试（要求 ${rules.accuracyLimit} 米以内）`);
  const [lat,lng] = loc.coordinateSystem === 'wgs84' ? wgsToGcj(loc.latitude,loc.longitude) : [loc.latitude,loc.longitude];
  const distance = distanceMeters(lat,lng,rules.latitude,rules.longitude);
  if (distance > rules.radius) throw new Error(`距离打卡点约 ${Math.round(distance)} 米，超出 ${rules.radius} 米范围`);
  return { latitude: lat, longitude: lng, distance: Math.round(distance*10)/10 };
}
export function aggregateLeave(items: { status: string }[]) {
  const states = items.map(x=>x.status);
  if (states.includes('pending')) return 'pending';
  if (states.includes('approved')) return 'approved';
  if (states.includes('rejected')) return 'rejected';
  if (states.includes('withdrawn')) return 'withdrawn';
  if (states.includes('revoked')) return 'revoked';
  return 'invalid';
}
export function safeCSV(value: unknown) { const s = String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(s) ? "'"+s : s).replaceAll('"','""') + '"'; }
