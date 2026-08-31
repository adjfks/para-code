import { describe, expect, it } from 'vitest'

import { inferRequirementKind, moveRequirement, proposeGroupingPlan } from './grouping-planner'

describe('proposeGroupingPlan', () => {
  it('creates one named group per requirement and never drops text', () => {
    const plan = proposeGroupingPlan({
      repositoryPath: '/tmp/repo',
      baseRef: 'main',
      sourceText: '1. 修复登录过期\n2. 给设置页加模型选择',
      texts: ['修复登录过期', '给设置页加模型选择'],
    })

    expect(plan.groups).toHaveLength(2)
    expect(plan.groups.map((group) => group.name)).toEqual(['分组 A', '分组 B'])
    expect(plan.requirements.map((item) => item.sourceText)).toEqual([
      '修复登录过期',
      '给设置页加模型选择',
    ])
    expect(plan.unassigned).toEqual([])
    expect(plan.status).toBe('ready')
    expect(plan.version).toBe(1)
  })

  it('rejects empty requirement lists', () => {
    expect(() =>
      proposeGroupingPlan({
        repositoryPath: '/tmp/repo',
        baseRef: 'main',
        sourceText: '',
        texts: [],
      }),
    ).toThrow('需求不能为空')
  })
})

describe('moveRequirement', () => {
  it('moves a requirement, drops empty groups, and bumps the version', () => {
    const plan = proposeGroupingPlan({
      repositoryPath: '/tmp/repo',
      baseRef: 'main',
      sourceText: 'a\n\nb',
      texts: ['修复登录过期', '给设置页加模型选择'],
    })
    const moved = moveRequirement(plan, plan.requirements[1]!.id, plan.groups[0]!.id)

    expect(moved.version).toBe(plan.version + 1)
    expect(moved.status).toBe('editing')
    expect(moved.groups).toHaveLength(1)
    expect(moved.groups[0]?.requirementIds).toEqual(plan.requirements.map((item) => item.id))
  })
})

describe('inferRequirementKind', () => {
  it('classifies common requirement wording', () => {
    expect(inferRequirementKind('修复登录过期')).toBe('bug')
    expect(inferRequirementKind('优化列表渲染性能')).toBe('performance')
    expect(inferRequirementKind('重构权限模块')).toBe('refactor')
    expect(inferRequirementKind('添加模型选择')).toBe('feature')
  })
})
