import { describe, expect, it } from 'vitest'

import { protocolForSpaceId } from './voteRouting'

describe('protocolForSpaceId', () => {
  it('routes 0x contract addresses to Snapshot X', () => {
    expect(protocolForSpaceId('0x012b261effbf548f2b9a495d50b81a8a7c1dd941')).toBe('snapshot-x')
    expect(protocolForSpaceId('  0x012B261EFFBF548F2B9A495D50B81A8A7C1DD941  ')).toBe('snapshot-x')
  })

  it('routes ENS names to off-chain Snapshot', () => {
    expect(protocolForSpaceId('yam.eth')).toBe('snapshot-offchain')
    expect(protocolForSpaceId('aastar.eth')).toBe('snapshot-offchain')
    expect(protocolForSpaceId('')).toBe('snapshot-offchain')
  })

  it('does not treat a short/non-hex 0x string as a contract address', () => {
    expect(protocolForSpaceId('0xabc')).toBe('snapshot-offchain')
    expect(protocolForSpaceId('0xZZZZ261effbf548f2b9a495d50b81a8a7c1dd941')).toBe('snapshot-offchain')
  })
})
