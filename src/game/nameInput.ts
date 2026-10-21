// Persian keyboard positions, not phonetic transliteration: شمه → ali.
const persian = 'ضصثقفغعهخحشسیبلاتنمظطزرذدئ';
const latin =   'qwertyuiopasdfghjklzxcvbnm';
const keys = Object.fromEntries([...persian].map((letter, index) => [letter, latin[index]]));
Object.assign(keys, { 'ي': 'd', 'ى': 'd', 'آ': 'H' });

export function englishNameInput(value: string) {
  return [...value].map(letter => keys[letter] ?? letter).join('')
    .replace(/[^a-z ]/gi, '').replace(/ +/g, ' ').slice(0, 8);
}

export function englishPhysicalKey(key: string, code: string, shift: boolean) {
  if (!/^[\u0600-\u06ff]$/.test(key) || !/^Key[A-Z]$/.test(code)) return null;
  const letter = code.slice(3);
  return shift ? letter : letter.toLowerCase();
}
