import { describe, expect, it } from 'vitest'

import { parseRequirementTexts } from './requirements'

describe('parseRequirementTexts', () => {
  it('treats a single paragraph as one requirement', () => {
    expect(parseRequirementTexts('  添加 greeting 函数  ')).toEqual(['添加 greeting 函数'])
  })

  it('splits numbered and bulleted lists into separate requirements', () => {
    expect(
      parseRequirementTexts(`1. 修复登录过期
2. 给设置页加模型选择`),
    ).toEqual(['修复登录过期', '给设置页加模型选择'])
    expect(
      parseRequirementTexts(`- 修复登录过期
- 给设置页加模型选择`),
    ).toEqual(['修复登录过期', '给设置页加模型选择'])
  })

  it('splits blank-line paragraphs and ignores empty input', () => {
    expect(
      parseRequirementTexts(`修复登录过期

给设置页加模型选择`),
    ).toEqual(['修复登录过期', '给设置页加模型选择'])
    expect(parseRequirementTexts('   \n')).toEqual([])
  })
})
