const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const compile = path => ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const gemini = { exports: {} };
vm.runInNewContext(compile('app/api/_shared/gemini.ts'), { exports: gemini.exports, require });

async function correct(fetchImpl, input = {}) {
  const exports = {};
  vm.runInNewContext(compile('app/api/correct-transcript/route.ts'), {
    exports, AbortSignal, fetch: fetchImpl,
    require: name => name.endsWith('/auth')
      ? { requireAuthenticatedUser: async () => ({ memberId: 'member-1' }) }
      : gemini.exports
  });
  return exports.POST(new Request('http://localhost/api/correct-transcript', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gemini-api-key': 'test-key' },
    body: JSON.stringify({ rawText: 'ジャバ', previousInterviewerText: '使用した技術は？',
      followingInterviewerText: '', isReverseQuestionTurn: false, domainContext: 'Java', ...input })
  }));
}

test('correction API distinguishes upstream failures from a successful no-change decision for client retries', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('network error'); },
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => Response.json({ error: { message: 'unavailable' } }, { status: 503 }),
    async () => Response.json({ candidates: [{ content: { parts: [{ text: 'invalid JSON' }] } }] })
  ]) {
    const response = await correct(fetchImpl);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { correctedText: 'ジャバ', shouldReplace: false });
  }
  const response = await correct(async () => Response.json({ candidates: [{ content: { parts: [{
    text: JSON.stringify({ correctedText: 'ジャバ', shouldReplace: false })
  }] } }] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { correctedText: 'ジャバ', shouldReplace: false });
});

test('correction length validation ignores transcription spaces without accepting excessive content changes', async () => {
  const rawText = 'ま 、 そう いっ た 等 で の 追加 学習 です ね 。';
  for (const original of [rawText, rawText.replace(/\s/g, '')]) {
    const correctedText = '書籍等での追加学習ですね。';
    const response = await correct(async () => Response.json({ candidates: [{ content: { parts: [{
      text: JSON.stringify({ correctedText, shouldReplace: true })
    }] } }] }), { rawText: original,
      followingInterviewerText: '書籍などを用いて独学で学習を進めていく考えなのですね。' });
    assert.deepEqual(await response.json(), { correctedText, shouldReplace: true });
  }
  for (const correctedText of ['はい。', '書籍で学習します。'.repeat(10)]) {
    const response = await correct(async () => Response.json({ candidates: [{ content: { parts: [{
      text: JSON.stringify({ correctedText, shouldReplace: true })
    }] } }] }), { rawText });
    assert.deepEqual(await response.json(), { correctedText: rawText, shouldReplace: false });
  }
});

test('correction API accepts a short technical answer without a following interviewer turn', async () => {
  const response = await correct(async () => Response.json({ candidates: [{ content: { parts: [{
    text: JSON.stringify({ correctedText: 'Java', shouldReplace: true })
  }] } }] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { correctedText: 'Java', shouldReplace: true });
});
