import { useState } from 'react';
import { useGame } from '../game/store/GameProvider';

type AuthMode = 'login' | 'register';

export function AuthScreen() {
  const { auth, loginAccount, online, registerAccount } = useGame();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(online.serverUrl);

  const submit = async () => {
    try {
      const input = { username, password, serverUrl };
      if (mode === 'login') await loginAccount(input);
      else await registerAccount(input);
    } catch {
      // GameProvider exposes the server error through auth.error.
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card tool-panel" aria-label="账号登录">
        <header>
          <p>联网对战账号</p>
          <h1>账号登录</h1>
        </header>
        <div className="auth-tabs" role="tablist" aria-label="账号模式">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : undefined} onClick={() => setMode('login')}>登录</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : undefined} onClick={() => setMode('register')}>注册</button>
        </div>
        <div className="auth-fields">
          <label>
            <span>服务器</span>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://localhost:8787" />
          </label>
          <label>
            <span>用户名</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3-20 位字母、数字或下划线" autoComplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
        </div>
        <button className="auth-submit" type="button" onClick={() => void submit()} disabled={auth.loading}>
          {mode === 'login' ? '登录' : '注册'}
        </button>
        {auth.error && <p className="auth-error" role="alert">{auth.error}</p>}
      </section>
    </main>
  );
}
