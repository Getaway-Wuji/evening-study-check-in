import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseConfig} from '../lib/database-config';
test('Vercel Marketplace 数据库变量可直接连接，正式环境拒绝本地数据库',()=>{
  assert.deepEqual(databaseConfig({VERCEL:'1',TURSO_DATABASE_URL:'libsql://test.turso.io',TURSO_AUTH_TOKEN:'test-token'}),{url:'libsql://test.turso.io',authToken:'test-token'});
  assert.deepEqual(databaseConfig({DATABASE_URL:'https://primary.example',DATABASE_AUTH_TOKEN:'primary',TURSO_DATABASE_URL:'libsql://other.turso.io',TURSO_AUTH_TOKEN:'other'}),{url:'https://primary.example',authToken:'primary'});
  assert.throws(()=>databaseConfig({VERCEL:'1'}),/远程/);
  assert.throws(()=>databaseConfig({VERCEL:'1',DATABASE_URL:'file:./data/study.db'}),/远程/);
  assert.equal(databaseConfig({}).url,'file:./data/study.db');
});
