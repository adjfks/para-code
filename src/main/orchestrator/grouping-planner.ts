import { randomUUID } from 'node:crypto'

import type { GroupingPlan, Requirement, RequirementKind } from '../../shared/ipc'

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function proposeGroupingPlan(input: {
  repositoryPath: string
  baseRef: string
  sourceText: string
  texts: string[]
}): GroupingPlan {
  const texts = input.texts.map((text) => text.trim()).filter(Boolean)
  if (texts.length === 0) throw new Error('需求不能为空。')

  const now = new Date().toISOString()
  const requirements: Requirement[] = texts.map((sourceText) => ({
    id: `req_${randomUUID()}`,
    sourceText,
    kind: inferRequirementKind(sourceText),
  }))

  return {
    id: `plan_${randomUUID()}`,
    version: 1,
    repositoryPath: input.repositoryPath,
    baseRef: input.baseRef,
    sourceText: input.sourceText,
    requirements,
    groups: requirements.map((requirement, index) => ({
      id: `group_${randomUUID()}`,
      name: `分组 ${GROUP_LETTERS[index] ?? index + 1}`,
      requirementIds: [requirement.id],
    })),
    unassigned: [],
    groupRuns: [],
    status: 'ready',
    createdAt: now,
    updatedAt: now,
  }
}

export function moveRequirement(
  plan: GroupingPlan,
  requirementId: string,
  targetGroupId: string | 'new',
): GroupingPlan {
  if (!plan.requirements.some((item) => item.id === requirementId)) {
    throw new Error('需求不存在。')
  }

  const now = new Date().toISOString()
  const groups = plan.groups.map((group) => ({
    ...group,
    requirementIds: group.requirementIds.filter((id) => id !== requirementId),
  }))

  if (targetGroupId === 'new') {
    groups.push({
      id: `group_${randomUUID()}`,
      name: `分组 ${GROUP_LETTERS[groups.filter((group) => group.requirementIds.length > 0).length] ?? groups.length + 1}`,
      requirementIds: [requirementId],
    })
  } else {
    const target = groups.find((group) => group.id === targetGroupId)
    if (!target) throw new Error('目标分组不存在。')
    target.requirementIds.push(requirementId)
  }

  const nextGroups = groups.filter((group) => group.requirementIds.length > 0)
  return {
    ...plan,
    version: plan.version + 1,
    groups: nextGroups.map((group, index) => ({
      ...group,
      name: `分组 ${GROUP_LETTERS[index] ?? index + 1}`,
    })),
    status: 'editing',
    updatedAt: now,
  }
}

export function inferRequirementKind(text: string): RequirementKind {
  if (/修复|bug|缺陷|错误|崩溃/.test(text)) return 'bug'
  if (/性能|perf|延迟|卡顿/.test(text)) return 'performance'
  if (/重构|refactor/.test(text)) return 'refactor'
  return 'feature'
}

export function requirementTextForGroup(plan: GroupingPlan, groupId: string): string {
  const group = plan.groups.find((item) => item.id === groupId)
  if (!group) throw new Error('分组不存在。')
  return group.requirementIds
    .map((id) => plan.requirements.find((item) => item.id === id)?.sourceText)
    .filter((text): text is string => Boolean(text))
    .join('\n\n')
}
