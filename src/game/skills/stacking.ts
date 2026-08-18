import type { ActiveSkill, SkillEffect } from './types';

type EffectOfKind<K extends SkillEffect['kind']> = Extract<SkillEffect, { kind: K }>;

export function effectsOfKind<K extends SkillEffect['kind']>(
  skills: ActiveSkill[],
  kind: K,
): Array<{ effect: EffectOfKind<K>; skill: ActiveSkill }> {
  return skills.flatMap((skill) => skill.definition.implementationStatus !== 'active'
    ? []
    : skill.definition.effects
      .filter((effect): effect is EffectOfKind<K> => effect.kind === kind)
      .map((effect) => ({ effect, skill })));
}

export function hasActiveSkill(skills: ActiveSkill[], name: string): boolean {
  return skills.some((skill) => skill.definition.name === name && skill.definition.implementationStatus === 'active');
}
