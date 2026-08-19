import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRangeHeaders,
  cleanupPackages,
} from '../worker/src/r2-packages.ts';

test('Range 运行时对象包含 undefined suffix 时仍生成有效响应头', () => {
  const headers = new Headers();
  const runtimeRange = { offset: 0, length: 1024, suffix: undefined };

  applyRangeHeaders(headers, runtimeRange, 744_413_455);

  assert.equal(headers.get('content-length'), '1024');
  assert.equal(headers.get('content-range'), 'bytes 0-1023/744413455');
});

test('后缀 Range 使用文件末尾的正确字节范围', () => {
  const headers = new Headers();

  applyRangeHeaders(headers, { suffix: 1024 }, 4096);

  assert.equal(headers.get('content-length'), '1024');
  assert.equal(headers.get('content-range'), 'bytes 3072-4095/4096');
});

test('发布新版本后清理任务保留当前版和上一版', async () => {
  const currentSha = 'a'.repeat(40);
  const previousSha = 'b'.repeat(40);
  const staleSha = 'c'.repeat(40);
  const deleted = [];
  const bucket = {
    async list() {
      return {
        truncated: false,
        objects: [currentSha, previousSha, staleSha].map((sha1) => ({
          key: `packages/${sha1}.msix`,
        })),
      };
    },
    async delete(keys) {
      deleted.push(...keys);
    },
  };
  const links = (sha1) => ({ x64: { sha1 }, arm64: null });

  await cleanupPackages(
    bucket,
    links(currentSha),
    links(previousSha),
  );

  assert.deepEqual(deleted, [`packages/${staleSha}.msix`]);
});
