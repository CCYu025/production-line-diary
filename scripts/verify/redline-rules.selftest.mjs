// Self-test for redline-rules.mjs. No server, no packages: node scripts/verify/redline-rules.selftest.mjs  (exit 0 = all pass)
// Fake paths use "someone". The theme key is assembled so this file never contains it as one string.
import assert from 'node:assert/strict';
import { personalHit, profilePathHit, stripComments, themeKeyHit, themeKeyLines } from './redline-rules.mjs';

const KEY = ['pld', 'theme'].join('.');
const q = (s) => `"${s}"`;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
/** lines of `text` (1-based) that rule 2 flags when every line counts as added */
const flagged = (text) => themeKeyLines(text, text.split('\n').map((_, i) => i + 1));

// ---------- rule 2: comments
ok('L2-d bypass: a line starting with `*/` followed by real code is flagged', () => {
  assert.deepEqual(flagged(`/* old note\n*/ localStorage.setItem(${q(KEY)}, "cyber");`), [2]);
});
ok('L2-d bypass: a line starting with `*` that is NOT inside a block comment is code and is flagged', () => {
  assert.deepEqual(flagged(`const a = 1\n  * f(${q(KEY)})`), [2]);
});
ok('L2-d false positive: key on a middle line of a multi-line block comment that does not start with `*` is not flagged', () => {
  assert.deepEqual(flagged(`/*\n  the key is ${q(KEY)} and we must not write it\n*/\nconst x = 1;`), []);
});
ok('block comment with ` * ` prefixed lines is not flagged', () => {
  assert.deepEqual(flagged(`/**\n * see ${q(KEY)}\n */\nfoo();`), []);
});
ok('line comment and trailing line comment are not flagged', () => {
  assert.deepEqual(flagged(`// ${q(KEY)}\nfoo(); // ${q(KEY)}`), []);
});
ok('code before a trailing line comment is flagged; code after a one-line block comment is flagged', () => {
  assert.deepEqual(flagged(`set(${q(KEY)}); // why\n/* a */ set(${q(KEY)});`), [1, 2]);
});
ok('a comment opener inside a string does not hide the key that follows', () => {
  assert.deepEqual(flagged(`const u = "http://example.test", k = ${q(KEY)};`), [1]);
  assert.deepEqual(flagged(`const g = "/*"; set(${q(KEY)}); const h = "*/";`), [1]);
});
ok('single quote, backtick, escaped quote forms are flagged', () => {
  assert.deepEqual(flagged(`set('${KEY}')`), [1]);
  assert.deepEqual(flagged('set(`' + KEY + '`)'), [1]);
  assert.deepEqual(flagged(`const s = "a\\"b"; set(${q(KEY)})`), [1]);
});
ok('multi-line template literal keeps its text as code; an unterminated quote ends with its line', () => {
  assert.deepEqual(flagged('const t = `first\n' + KEY.replace('.', '.') + ' "' + KEY + '"\n`;'), [2]);
  assert.deepEqual(flagged(`const bad = 'oops\nset(${q(KEY)})`), [2]);
});
ok('the key not as a quoted string is not flagged by themeKeyHit', () => {
  assert.equal(themeKeyHit(`const a = ${KEY};`), false);
  assert.equal(themeKeyHit(q(KEY)), true);
});
ok('stripComments keeps line count and positions', () => {
  const t = 'a /* x\ny */ b // c\nd';
  const s = stripComments(t);
  assert.equal(s.length, 3);
  assert.equal(s[0].length, t.split('\n')[0].length);
  assert.equal(s[1].trim(), 'b');
  assert.equal(s[2], 'd');
});
ok('CRLF input gives the same result', () => {
  assert.deepEqual(themeKeyLines(`/*\r\n ${q(KEY)}\r\n*/\r\nset(${q(KEY)})`, [1, 2, 3, 4]), [4]);
});

// ---------- rule 3: personal paths
const WIN = (drive, root, sep, user) => `${drive}:${sep}${root}${sep}${user}${sep}x`;
ok('L2-d bypass: lower-case Windows profile path is flagged', () => {
  assert.equal(profilePathHit('c:\\' + 'users' + '\\someone\\x'), true);
  assert.equal(profilePathHit('c:/' + 'users' + '/someone/x'), true);
});
ok('upper / mixed case, other drive letters, forward slash, escaped backslashes are flagged', () => {
  assert.equal(profilePathHit(WIN('C', 'Users', '\\', 'someone')), true);
  assert.equal(profilePathHit(WIN('D', 'USERS', '\\', 'someone')), true);
  assert.equal(profilePathHit(WIN('c', 'Users', '/', 'someone')), true);
  assert.equal(profilePathHit(WIN('C', 'Users', '\\\\', 'someone')), true);
});
ok('unix profile paths are flagged (case-sensitive as those systems spell them)', () => {
  assert.equal(profilePathHit('/Us' + 'ers/someone/x'), true);
  assert.equal(profilePathHit('/ho' + 'me/someone/x'), true);
  assert.equal(profilePathHit('/us' + 'ers/someone/x'), false);
});
ok('no false positives: Program Files, a users folder inside the repo, a plain word', () => {
  assert.equal(profilePathHit('C:\\Program Files\\Chrome'), false);
  assert.equal(profilePathHit('src/users/list.ts'), false);
  assert.equal(profilePathHit('the users of this app'), false);
  assert.equal(profilePathHit('users\\someone'), false);
});
ok('personalHit also takes the extra literal needles (case-sensitive)', () => {
  assert.equal(personalHit('folder One' + 'Drive here', ['One' + 'Drive']), true);
  assert.equal(personalHit('folder one' + 'drive here', ['One' + 'Drive']), false);
  assert.equal(personalHit('clean line', ['One' + 'Drive']), false);
});

// ---------- known range (README "Known range"): these are NOT detected, on purpose; the test pins the documented behaviour
ok('documented gaps stay gaps: concatenated key, %USERPROFILE%, ~/ paths', () => {
  assert.deepEqual(flagged(`set("pld." + "theme")`), []);
  assert.equal(profilePathHit('%USERPROFILE%\\x'), false);
  assert.equal(profilePathHit('~/projects/x'), false);
});

console.log(`redline-rules selftest: ${n} passed`);
