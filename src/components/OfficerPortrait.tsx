import type { CSSProperties } from 'react';
import { officerAvatarUrl } from '../game/avatars';

interface OfficerPortraitProps {
  officer: { id: string; name: string };
  /** 头像框边长（px），默认 40；无头像时占位图名字字号按比例缩放 */
  size?: number;
  /** 悬停提示（缺省为武将名） */
  title?: string;
  className?: string;
}

/**
 * 武将头像：配置了头像（assets/image/avatar）的显示头像图，
 * 没有配置的显示名字占位图（仿原版姓名牌）。
 * 头像图填满头像框（object-fit: cover，不留白）。
 * 占位名通过 CSS 伪元素（attr(data-name)）渲染，不产生重复文本节点。
 */
export function OfficerPortrait({ officer, size = 40, title, className = '' }: OfficerPortraitProps) {
  const url = officerAvatarUrl(officer);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.22)),
  };
  if (url) {
    return (
      <span
        className={`officer-portrait${className ? ` ${className}` : ''}`}
        style={style}
        title={title ?? officer.name}
        aria-hidden="true"
      >
        <img src={url} alt="" />
      </span>
    );
  }
  return (
    <span
      className={`officer-portrait is-fallback${className ? ` ${className}` : ''}`}
      style={style}
      title={title ?? officer.name}
      aria-hidden="true"
      data-name={officer.name}
    />
  );
}