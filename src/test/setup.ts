import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import {
  CompressionStream as NodeCompressionStream,
  DecompressionStream as NodeDecompressionStream,
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
  WritableStream as NodeWritableStream,
} from 'node:stream/web';

/**
 * vitest 的 vmThreads 池会剥掉 vm 上下文里的 Web Streams 全局量
 * （ReadableStream / WritableStream / TransformStream / CompressionStream / DecompressionStream
 * 全部变成 undefined），而真实浏览器里这些是原生存在的。
 *
 * 影响：saveSlots 的 gzip 链路（canUseGzip()）会误判为「环境不支持压缩」而降级为明文存档，
 * 于是「32 槽仍显著低于配额」和「gz1 损坏档归为无法读取」两条用例在测试环境失真。
 * 这里用 Node 自带的实现把全局量补回来，让测试环境与浏览器语义保持一致。
 */
const WEB_STREAM_GLOBALS: Record<string, unknown> = {
  ReadableStream: NodeReadableStream,
  WritableStream: NodeWritableStream,
  TransformStream: NodeTransformStream,
  CompressionStream: NodeCompressionStream,
  DecompressionStream: NodeDecompressionStream,
};

for (const [name, ctor] of Object.entries(WEB_STREAM_GLOBALS)) {
  // 只在缺失时补位，不覆盖运行时自带的原生实现
  if (typeof (globalThis as Record<string, unknown>)[name] !== 'function') {
    (globalThis as Record<string, unknown>)[name] = ctor;
  }
}

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => cleanup());
