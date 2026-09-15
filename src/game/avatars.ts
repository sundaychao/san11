/**
 * 武将头像模块。
 *
 * 图片来源：assets/image/avatar/ 下的《三国志11》原版武将头像（240×240 BMP），
 * 文件名与武将名的关联关系来自同目录的 links.txt。
 * 头像属于纯展示数据、不进入存档：按武将名查询（可回退到武将 id），
 * 因此主剧本与自定义地图中的同名武将都能自动匹配。
 */

// 批量引入全部头像文件（?url 拿到最终资源地址；bmp 由 vite 原样拷贝发布）
const avatarFileUrls = import.meta.glob('../../assets/image/avatar/*.bmp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** links.txt 的关联关系：武将名 → 头像文件名（去扩展名） */
const OFFICER_AVATAR_BY_NAME: Record<string, string> = {
  张飞: '2-1',
  关羽: '3-1',
  赵云: '10-1',
  刘备: '37-1',
  徐庶: '40-1',
  郭嘉: '44-1',
  诸葛亮: '46-1',
  曹操: '61-1',
  孙权: '65-1',
  刘表: '75-1',
};

/** 主剧本（襄樊208）武将 id → 头像文件名（与按名的关系一一对应，支持 id 直查） */
const OFFICER_AVATAR_BY_ID: Record<string, string> = {
  'zhang-fei': '2-1',
  'guan-yu': '3-1',
  'zhao-yun': '10-1',
  'liu-bei': '37-1',
  'xu-shu': '40-1',
  'guo-jia': '44-1',
  'zhuge-liang': '46-1',
  'cao-cao': '61-1',
  'sun-quan': '65-1',
  'liu-biao': '75-1',
};

function avatarUrlOf(file: string): string | undefined {
  return avatarFileUrls[`../../assets/image/avatar/${file}.bmp`];
}

/** 取武将头像地址；无头像返回 undefined（由头像组件显示名字占位图） */
export function officerAvatarUrl(officer: { id: string; name: string }): string | undefined {
  const file = OFFICER_AVATAR_BY_NAME[officer.name] ?? OFFICER_AVATAR_BY_ID[officer.id];
  return file ? avatarUrlOf(file) : undefined;
}