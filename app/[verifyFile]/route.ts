import { NextRequest,NextResponse } from 'next/server';
export async function GET(req:NextRequest,{params}:{params:Promise<{verifyFile:string}>}){
  const {verifyFile}=await params;
  if(verifyFile!==process.env.WECHAT_VERIFY_FILENAME||!/^MP_verify_[A-Za-z0-9]+\.txt$/.test(verifyFile)||!process.env.WECHAT_VERIFY_CONTENT)return new NextResponse('Not found',{status:404});
  return new NextResponse(process.env.WECHAT_VERIFY_CONTENT,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public,max-age=300'}});
}
