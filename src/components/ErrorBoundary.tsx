import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Jingxiang UI error', error, info);
  }

  private recover = () => {
    window.localStorage.clear();
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="error-screen">
        <AlertTriangle aria-hidden="true" />
        <h1>界面发生错误</h1>
        <p>本地游戏状态未能正常显示。</p>
        <button type="button" onClick={this.recover}>
          <RotateCcw aria-hidden="true" /> 返回开始界面
        </button>
      </main>
    );
  }
}
