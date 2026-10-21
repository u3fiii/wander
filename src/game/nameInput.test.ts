import test from 'node:test';
import assert from 'node:assert/strict';
import { englishNameInput, englishPhysicalKey } from './nameInput.ts';

test('Persian keyboard text and mobile/pasted text become the same Latin keys', () => {
  assert.equal(englishNameInput('شمه'), 'ali');
  assert.equal(englishNameInput('ضصثقفغعهخح'), 'qwertyui');
  assert.equal(englishNameInput('يشى'), 'dad');
  assert.equal(englishNameInput('Ali  R'), 'Ali R');
  assert.equal(englishNameInput('Ali '), 'Ali '); // spaces survive while editing
  assert.equal(englishNameInput('Ali۱۲!@🙂'), 'Ali');
  assert.equal(englishNameInput('abcdefghijk'), 'abcdefgh');
});

test('desktop conversion follows physical keys and preserves shift', () => {
  assert.equal(englishPhysicalKey('ش', 'KeyA', false), 'a');
  assert.equal(englishPhysicalKey('آ', 'KeyH', true), 'H');
  assert.equal(englishPhysicalKey('ي', 'KeyD', false), 'd');
  assert.equal(englishPhysicalKey('a', 'KeyA', false), null);
  assert.equal(englishPhysicalKey('Enter', 'Enter', false), null);
  assert.equal(englishPhysicalKey('ک', 'Semicolon', false), null);
});
