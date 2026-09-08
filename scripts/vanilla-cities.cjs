// 打印 42 城记录顺序与坐标，对照 S11 已知城市表定方位
const fs = require('fs');
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const s11 = fs.readFileSync(VAN_S11);
const names = ['蓟','襄平','乌丸','代县','晋阳','南皮','平原','北平','小沛','下邳','沛县','寿春','广陵','秣陵','吴会','山阴','建安','罗阳','豫章','江洲','柴桑','寻阳','夏口','江夏','襄阳','新野','宛','陈留','许昌','洛阳','孟津','潼关','长安','安定','天水','南郑','武都','梓潼','成都','江州','云南','永晶'];
console.log('idx x y  (record hex)');
for (let i = 0; i < 42; i++) {
  const o = 0x3f4f + i * 18;
  const x = s11.readUInt16LE(o), y = s11.readUInt16LE(o + 2);
  const hex = Buffer.from(s11.subarray(o, o + 18)).toString('hex');
  console.log(String(i).padStart(2), `x=${String(x).padStart(3)} y=${String(y).padStart(3)}  ${names[i] || '?'}  ${hex}`);
}
