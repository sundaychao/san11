/** 触发浏览器下载文本文件（SVG/JSON 等） */
export function downloadTextFile(filename: string, content: string, mimeType = 'application/json;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}