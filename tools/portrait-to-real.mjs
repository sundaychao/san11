/**
 * 立绘 -> 真人照片 转换器
 *
 * 支持多家「参考图编辑」图像模型。用法:
 *   node tools/portrait-to-real.mjs --provider gemini --key <API_KEY> [--out out.jpg] [--seed 1]
 *
 * 环境变量也可提供 key: GEMINI_API_KEY / ARK_API_KEY / DASHSCOPE_API_KEY / POLLINATIONS_TOKEN
 *
 * provider 说明(均为「上传参考图 + 编辑」模式, 能保留人物五官与服饰):
 *   gemini      Google gemini-2.5-flash-image  ("Nano Banana")  —— 还原度最好
 *   ark         火山方舟 doubao-seedream-4-0 (图生图)             —— 国内直连, 服饰细节强
 *   dashscope   阿里通义 qwen-image-edit                          —— 国内直连
 *   pollinations Pollinations kontext (需账号 token)              —— 免费额度
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SOURCE = resolve(arg('source', 'zhugeliang_source.png'));
const OUT = resolve(arg('out', 'zhugeliang_real.png'));
const PROVIDER = arg('provider', 'gemini');
const KEY =
  arg('key') ||
  {
    gemini: process.env.GEMINI_API_KEY,
    ark: process.env.ARK_API_KEY,
    dashscope: process.env.DASHSCOPE_API_KEY,
    pollinations: process.env.POLLINATIONS_TOKEN,
  }[PROVIDER];

if (!KEY) {
  console.error(`缺少 API Key。请用 --key <KEY> 或设置对应环境变量 (provider=${PROVIDER})。`);
  process.exit(2);
}

const b64 = readFileSync(SOURCE).toString('base64');
const mime = SOURCE.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

/** 提示词: 目标 = 保留同一人物/同一服饰, 只把画风从 2D 立绘换成真实照片 */
const DEFAULT_PROMPT = [
  '将这张《三国志11》风格的人物立绘转换成一张真实的人类照片。',
  '',
  '必须严格保留原图人物的以下身份特征, 不得改变:',
  '- 脸型、五官比例、眉形、眼型、鼻型、嘴唇形状;',
  '- 细长的下垂八字胡与下巴上的一小撮山羊胡;',
  '- 黑色长发中分, 垂落在肩后;',
  '- 头戴深青绿色竖褶纶巾, 巾脚有浅色束带, 额前有一圈雕花金色金属额带;',
  '- 身穿白色交领汉服长袍, 外罩紫罗兰色交领, 领缘为回纹(雷纹)织锦;',
  '- 右手持白鹤羽毛扇。',
  '',
  '渲染要求: 这是一张真实拍摄的照片, 不是插画、不是 CG、不是游戏建模。',
  '皮肤要有真实的毛孔、细纹、胡须根部的青色、自然的次表面散射, 不要磨皮、不要塑料感。',
  '柔和的阴天侧光, 浅景深, 背景为虚化的土黄与灰褐色。',
  '85mm 人像镜头, 博物馆级历史服饰质感, 眼睛对焦锐利, 电影级调色。',
].join('\n');

/** 提示词可用 --prompt-file <path> 覆盖(避免命令行转义问题), 否则用上面的默认提示词 */
const PROMPT_FILE = arg('prompt-file');
const PROMPT = PROMPT_FILE ? readFileSync(resolve(PROMPT_FILE), 'utf8').trim() : DEFAULT_PROMPT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ---------- gemini (Nano Banana) ---------- */
async function gemini() {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PROMPT }],
      },
    ],
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(j).slice(0, 600)}`);
  const parts = j?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const data = img?.inlineData?.data ?? img?.inline_data?.data;
  if (!data) throw new Error('gemini 未返回图像: ' + JSON.stringify(j).slice(0, 600));
  return Buffer.from(data, 'base64');
}

/** ---------- 火山方舟 Seedream (图生图) ---------- */
async function ark() {
  const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: arg('model', 'doubao-seedream-4-0-250828'),
      prompt: PROMPT,
      image: `data:${mime};base64,${b64}`,
      response_format: 'b64_json',
      size: arg('size', '2K'),
      watermark: false,
    }),
    signal: AbortSignal.timeout(240000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`ark ${r.status}: ${JSON.stringify(j).slice(0, 600)}`);
  const d = j?.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  throw new Error('ark 未返回图像: ' + JSON.stringify(j).slice(0, 600));
}

/** ---------- 阿里 DashScope Qwen-Image-Edit ---------- */
async function dashscope() {
  const r = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: arg('model', 'qwen-image-edit'),
        input: {
          messages: [
            {
              role: 'user',
              content: [{ image: `data:${mime};base64,${b64}` }, { text: PROMPT }],
            },
          ],
        },
        parameters: { negative_prompt: '插画, 动漫, 3D渲染, 游戏原画, 塑料皮肤, 磨皮' },
      }),
      signal: AbortSignal.timeout(240000),
    },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`dashscope ${r.status}: ${JSON.stringify(j).slice(0, 600)}`);
  const url = j?.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image;
  if (!url) throw new Error('dashscope 未返回图像: ' + JSON.stringify(j).slice(0, 600));
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

/** ---------- Pollinations kontext ---------- */
async function pollinations() {
  const url =
    'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(PROMPT) +
    '?model=kontext&width=1024&height=1024&nologo=true';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ image: `data:${mime};base64,${b64}` }),
    signal: AbortSignal.timeout(240000),
  });
  if (!r.ok) throw new Error(`pollinations ${r.status}: ${(await r.text()).slice(0, 600)}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 2000) throw new Error('pollinations 返回内容异常');
  return b;
}

const impl = { gemini, ark, dashscope, pollinations }[PROVIDER];
if (!impl) {
  console.error(`未知 provider: ${PROVIDER}。可选: gemini | ark | dashscope | pollinations`);
  process.exit(2);
}

console.log(`provider=${PROVIDER}  source=${SOURCE}`);
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const buf = await impl();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, buf);
    console.log(`OK -> ${OUT} (${buf.length} bytes)`);
    process.exit(0);
  } catch (e) {
    console.error(`第 ${attempt} 次失败: ${e.message}`);
    if (attempt < 3) await sleep(6000 * attempt);
  }
}
console.error('全部重试失败。');
process.exit(1);
