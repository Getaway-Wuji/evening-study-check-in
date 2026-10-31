type Environment=Record<string,string|undefined>;
export function wechatSetup(env:Environment=process.env){
  let origin='';
  try{const url=new URL(env.APP_URL||'');if(url.protocol==='https:'&&!url.username&&!url.password)origin=url.origin;}catch{}
  const appIdConfigured=/^wx[a-zA-Z0-9]{16}$/.test(env.WECHAT_APP_ID?.trim()||'');
  const secretConfigured=!!env.WECHAT_APP_SECRET?.trim();
  const credentials=!!(origin&&appIdConfigured&&secretConfigured);
  return {origin,appIdConfigured,secretConfigured,httpsConfigured:!!origin,
    oauthEnabled:env.WECHAT_OAUTH_ENABLED!=='false',locationEnabled:env.WECHAT_LOCATION_ENABLED!=='false',
    oauthConfigured:credentials&&env.WECHAT_OAUTH_ENABLED!=='false',locationConfigured:credentials&&env.WECHAT_LOCATION_ENABLED!=='false',
    verificationConfigured:!!(/^MP_verify_[A-Za-z0-9]+\.txt$/.test(env.WECHAT_VERIFY_FILENAME||'')&&env.WECHAT_VERIFY_CONTENT),
    menuURL:origin?origin+'/wechat':'',callbackURL:origin?origin+'/api/auth/wechat/callback':'',
  };
}
