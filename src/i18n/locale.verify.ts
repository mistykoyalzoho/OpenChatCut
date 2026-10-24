import assert from 'node:assert/strict';

const documentElement = { lang: 'en' };
let persistedLocale = 'zh';
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => persistedLocale,
    setItem: (_key: string, value: string) => { persistedLocale = value; },
  },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement },
});

const { getLocale, setLocale } = await import('./locale');
assert.equal(getLocale(), 'en');
assert.equal(persistedLocale, 'zh', 'a saved locale must not override the English interface');
assert.equal(documentElement.lang, 'en', 'the document language must remain English');
setLocale('zh');
assert.equal(getLocale(), 'zh');
assert.equal(persistedLocale, 'zh');
assert.equal(documentElement.lang, 'zh-CN');

console.log('locale.verify: persisted and changed locales update the document language');
