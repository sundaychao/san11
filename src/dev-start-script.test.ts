import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('development startup script', () => {
  it('starts the backend and frontend in separate Windows command windows', () => {
    const script = readFileSync(resolve(process.cwd(), 'start-dev.bat'), 'utf8');

    expect(script).toContain('start "SAN11 Backend" cmd /k "set CORS_ORIGIN=http://127.0.0.1:5174&& npm.cmd run server"');
    expect(script).toContain('start "SAN11 Frontend" cmd /k "npm.cmd run dev -- --host 127.0.0.1 --port 5174"');
    expect(script).toContain('start "" "http://127.0.0.1:5174"');
    expect(script).toContain('http://127.0.0.1:5174');
    expect(script).toContain('http://localhost:8787');
  });
});
