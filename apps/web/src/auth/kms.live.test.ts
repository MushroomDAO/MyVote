// @vitest-environment node
//
// Opt-in live check against the real TEE KMS. The agent credential is minted
// with the SDK's P256PasskeySigner (see the KMS repo) and read from a file so it
// never appears in the command line:
//
//   KMS_LIVE=1 KMS_LIVE_ENDPOINT=https://kms.aastar.io KMS_LIVE_API_KEY=... \
//   KMS_LIVE_KEY_ID=... KMS_LIVE_HD_PATH=... KMS_LIVE_ADDRESS=0x... \
//   KMS_LIVE_JWT_FILE=/path/to/agent.jwt vitest run src/auth/kms.live.test.ts
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createHttpKmsSigner } from './kms'

describe.skipIf(process.env.KMS_LIVE !== '1')('live KMS (KMS_LIVE=1)', () => {
  it('signs EIP-712 typed data with a real agent credential', async () => {
    const {
      KMS_LIVE_ENDPOINT: endpoint,
      KMS_LIVE_API_KEY: apiKey,
      KMS_LIVE_KEY_ID: keyId,
      KMS_LIVE_HD_PATH: hdPath,
      KMS_LIVE_ADDRESS: aaAddress,
      KMS_LIVE_JWT_FILE: jwtFile
    } = process.env
    expect(endpoint && apiKey && keyId && hdPath && aaAddress && jwtFile).toBeTruthy()

    const token = readFileSync(jwtFile!, 'utf8').trim()
    const signer = createHttpKmsSigner({
      endpoint: endpoint!,
      apiKey,
      hdPath,
      resolveKeyId: () => keyId
    })

    const signature = await signer.signTypedData({
      aaAddress: aaAddress!,
      token,
      typedData: {
        domain: { name: 'snapshot', version: '0.1.4' },
        types: { Vote: [{ name: 'choice', type: 'uint32' }] },
        primaryType: 'Vote',
        message: { choice: 1 }
      }
    })

    expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
  }, 60000)
})
