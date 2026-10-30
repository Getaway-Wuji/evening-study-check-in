import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudentName,normalizeStudentCode } from '../lib/identity';
test('名单核对兼容全半角和意外空格，保留学号的前导零',()=>{
  assert.equal(normalizeStudentName(' 张 三 '),normalizeStudentName('张三'));
  assert.equal(normalizeStudentCode(' ０００１２３ '),'000123');
  assert.notEqual(normalizeStudentName('张三'),normalizeStudentName('张山'));
});
