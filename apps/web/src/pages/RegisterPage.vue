<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { REGISTER_ROOT_DOMAIN } from '../config'
import { useAuth } from '../auth/useAuth'
import { isValidEmail } from '../lib/email'
import { buildOwnershipMessage } from '../lib/ownership'
import { isValidSubdomain } from '../lib/registration'

const { t } = useI18n()
const auth = useAuth()

const name = ref('')
const spaceId = ref('')
const description = ref('')
const email = ref('')

const checking = ref(false)
const nameStatus = ref<'idle' | 'available' | 'taken' | 'invalid'>('idle')
const checkError = ref<string | null>(null)

const submitting = ref(false)
const submitError = ref<string | null>(null)
const successUrl = ref<string | null>(null)

// --- Email verification code (M6-3) ---
const emailCode = ref('')
const codeState = ref<'idle' | 'sending' | 'sent' | 'unavailable' | 'error'>('idle')
const codeMessage = ref<string | null>(null)

/** Localizes the API's stable verification codes. */
function submitErrorMessage(code: string): string {
  if (code === 'email_code_missing') return t('emailCodeRequired')
  if (code.startsWith('email_code_')) return t('emailCodeInvalid')
  return code
}

function onEmailChange() {
  // A code is bound to one address; a change invalidates what is on screen.
  codeState.value = 'idle'
  codeMessage.value = null
  emailCode.value = ''
}

async function sendCode() {
  if (!isEmailValid.value) {
    codeState.value = 'error'
    codeMessage.value = t('emailInvalid')
    return
  }
  codeState.value = 'sending'
  codeMessage.value = null
  try {
    const res = await fetch('/api/email-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim().toLowerCase() })
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (res.ok && data.ok) {
      codeState.value = 'sent'
      codeMessage.value = t('emailCodeSent')
      return
    }
    const code = data.error ?? ''
    if (code === 'email_verification_unavailable') {
      codeState.value = 'unavailable'
      codeMessage.value = t('emailCodeUnavailable')
    } else {
      codeState.value = 'error'
      codeMessage.value =
        code === 'email_send_failed' || code === 'email_send_unknown'
          ? t('emailCodeSendFailed')
          : code || t('emailCodeSendFailed')
    }
  } catch (e) {
    codeState.value = 'error'
    codeMessage.value = e instanceof Error ? e.message : String(e)
  }
}

const nameLower = computed(() => name.value.toLowerCase().trim())
const isValidName = computed(() => isValidSubdomain(nameLower.value))
const isEmailValid = computed(() => isValidEmail(email.value))
/** Same domain the edge computes, so the signed message matches byte-for-byte. */
const domain = computed(() => `${nameLower.value}.${REGISTER_ROOT_DOMAIN}`)

// --- Optional space-ownership proof (see lib/ownership.ts) ---
const ownershipStatus = ref<'none' | 'signing' | 'verified' | 'error'>('none')
const ownershipError = ref<string | null>(null)
const ownershipProof = ref<{ address: string; timestamp: number; signature: string } | null>(null)

let checkTimer: ReturnType<typeof setTimeout> | null = null

function onNameInput() {
  nameStatus.value = 'idle'
  checkError.value = null
  successUrl.value = null
  // The signed message embeds the domain, so a rename invalidates any proof.
  ownershipProof.value = null
  ownershipStatus.value = 'none'
  ownershipError.value = null
  if (checkTimer) clearTimeout(checkTimer)
  if (!nameLower.value) return
  if (!isValidName.value) {
    nameStatus.value = 'invalid'
    return
  }
  checkTimer = setTimeout(() => void checkName(), 500)
}

async function checkName() {
  if (!isValidName.value) return
  checking.value = true
  checkError.value = null
  try {
    const res = await fetch(`/api/check?name=${encodeURIComponent(nameLower.value)}`)
    const data = await res.json() as { available: boolean; domain: string; error?: string }
    if (data.error) {
      checkError.value = data.error
      nameStatus.value = 'idle'
    } else {
      nameStatus.value = data.available ? 'available' : 'taken'
    }
  } catch (e) {
    checkError.value = e instanceof Error ? e.message : String(e)
    nameStatus.value = 'idle'
  } finally {
    checking.value = false
  }
}

/**
 * Optional: sign a timestamped message so the API can verify the signer is an
 * admin of the space. Skipping it still registers (recorded as 'unverified').
 */
async function signOwnership() {
  ownershipError.value = null
  ownershipStatus.value = 'signing'
  try {
    if (!spaceId.value.trim()) throw new Error(t('snapshotSpaceId'))
    if (!auth.isConnected.value) await auth.connect()
    const address = auth.user.value?.address
    if (!address) throw new Error(t('noAccount'))

    const timestamp = Date.now()
    const signature = await auth.provider.value.signMessage(
      address,
      buildOwnershipMessage(domain.value, timestamp)
    )
    ownershipProof.value = { address, timestamp, signature }
    ownershipStatus.value = 'verified'
  } catch (e) {
    ownershipProof.value = null
    ownershipStatus.value = 'error'
    ownershipError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onSubmit() {
  if (nameStatus.value !== 'available') return
  if (!spaceId.value.trim()) return
  if (!isEmailValid.value) {
    submitError.value = t('emailInvalid')
    return
  }

  submitting.value = true
  submitError.value = null
  successUrl.value = null
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: nameLower.value,
        spaceId: spaceId.value.trim(),
        description: description.value.trim(),
        email: email.value.trim().toLowerCase(),
        ...(emailCode.value.trim() ? { emailCode: emailCode.value.trim() } : {}),
        ...(ownershipProof.value
          ? {
              adminAddress: ownershipProof.value.address,
              adminTimestamp: ownershipProof.value.timestamp,
              adminSignature: ownershipProof.value.signature
            }
          : {})
      })
    })
    const data = await res.json() as { success?: boolean; url?: string; error?: string }
    if (!res.ok || data.error) {
      submitError.value = data.error ? submitErrorMessage(data.error) : t('registerError')
    } else {
      successUrl.value = data.url ?? null
    }
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1 class="title">{{ t('register') }}</h1>

    <div v-if="successUrl" class="card successCard">
      <div class="successIcon">✓</div>
      <div class="successTitle">{{ t('registerSuccess') }}</div>
      <div class="successDesc">{{ t('registerSuccessDesc') }}</div>
      <a class="successLink" :href="successUrl" target="_blank" rel="noopener">{{ successUrl }}</a>
      <div class="successNote">{{ t('registerSuccessNote') }}</div>
    </div>

    <div v-else class="card">
      <p class="desc">{{ t('registerDesc') }}</p>

      <div class="field">
        <label class="label" for="name">{{ t('communityName') }}</label>
        <div class="inputRow">
          <input
            id="name"
            v-model="name"
            class="input"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="bread"
            @input="onNameInput"
          />
          <span class="domain">.{{ REGISTER_ROOT_DOMAIN }}</span>
        </div>
        <div class="hint">{{ t('communityNameHint') }}</div>
        <div v-if="checking" class="statusChecking">{{ t('checking') }}</div>
        <div v-else-if="nameStatus === 'available'" class="statusOk">✓ {{ t('nameAvailable') }}</div>
        <div v-else-if="nameStatus === 'taken'" class="statusErr">✗ {{ t('nameTaken') }}</div>
        <div v-else-if="nameStatus === 'invalid'" class="statusErr">✗ {{ t('nameInvalid') }}</div>
        <div v-if="checkError" class="statusErr">{{ checkError }}</div>
      </div>

      <div class="field">
        <label class="label" for="spaceId">{{ t('snapshotSpaceId') }}</label>
        <input
          id="spaceId"
          v-model="spaceId"
          class="input"
          type="text"
          placeholder="ens.eth"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="hint">{{ t('snapshotSpaceHint') }}</div>
      </div>

      <div class="field">
        <label class="label" for="desc">{{ t('communityDesc') }}</label>
        <textarea
          id="desc"
          v-model="description"
          class="textarea"
          rows="3"
          placeholder="Governance portal for our community"
        />
      </div>

      <div class="field">
        <label class="label" for="email">{{ t('contactEmail') }}</label>
        <div class="emailRow">
          <input
            id="email"
            v-model="email"
            class="inputSolo"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            @input="onEmailChange"
          />
          <button
            class="codeBtn"
            type="button"
            :disabled="codeState === 'sending' || !isEmailValid"
            @click="sendCode"
          >
            {{ codeState === 'sending' ? t('loading') : t('sendCode') }}
          </button>
        </div>
        <div class="hint">{{ t('contactEmailHint') }}</div>
        <div v-if="codeMessage" :class="codeState === 'sent' ? 'statusOk' : 'statusErr'">
          {{ codeMessage }}
        </div>
        <input
          id="emailCode"
          v-model="emailCode"
          class="inputSolo codeInput"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          :placeholder="t('emailCodePlaceholder')"
        />
      </div>

      <div class="field">
        <label class="label">{{ t('ownershipTitle') }}</label>
        <div class="hint">{{ t('ownershipHint') }}</div>
        <button
          class="ownershipBtn"
          type="button"
          :disabled="ownershipStatus === 'signing' || !spaceId.trim()"
          @click="signOwnership"
        >
          {{ ownershipStatus === 'signing' ? t('ownershipSigning') : t('ownershipVerify') }}
        </button>
        <div v-if="ownershipStatus === 'verified'" class="statusOk">
          ✓ {{ t('ownershipVerified') }}
        </div>
        <div v-if="ownershipError" class="statusErr">{{ ownershipError }}</div>
      </div>

      <div v-if="submitError" class="submitError">{{ t('registerError') }}: {{ submitError }}</div>

      <button
        class="submitBtn"
        type="button"
        :disabled="nameStatus !== 'available' || !spaceId.trim() || !isEmailValid || submitting"
        @click="onSubmit"
      >
        {{ submitting ? t('loading') : t('registerBtn') }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 620px;
  margin: 0 auto;
  padding: 36px 20px 64px;
}

.title {
  margin: 0 0 20px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mv-text-heading);
  background: linear-gradient(135deg, var(--mv-text-heading) 40%, var(--mv-primary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.card {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-lg);
  padding: 32px 28px;
  background: var(--mv-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--mv-shadow-md);
}

.desc {
  margin: 0 0 24px;
  color: var(--mv-muted);
  font-size: 15px;
  line-height: 1.6;
}

.field {
  margin-bottom: 22px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--mv-text-heading);
  margin-bottom: 8px;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: 0;
  box-shadow: var(--mv-shadow-sm);
  border-radius: var(--mv-radius);
  overflow: hidden;
}

/* Standalone input (no domain suffix) — full radius, unlike .input in .inputRow. */
.emailRow {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.emailRow .inputSolo {
  flex: 1;
}

.codeBtn {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius);
  padding: 0 16px;
  background: var(--mv-surface-md);
  color: var(--mv-text-heading);
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: var(--mv-shadow-sm);
}

.codeBtn:hover:not(:disabled) {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
  box-shadow: var(--mv-shadow-glow);
}

.codeBtn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.codeInput {
  margin-top: 10px;
}

.inputSolo {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--mv-border-md);
  border-radius: var(--mv-radius);
  padding: 11px 14px;
  background: var(--mv-surface);
  color: var(--mv-text);
  font: inherit;
  font-size: 14px;
  box-shadow: var(--mv-shadow-sm);
}

.inputSolo:hover {
  border-color: var(--mv-card-border-hover);
}

.input {
  flex: 1;
  border: 1px solid var(--mv-border-md);
  border-radius: var(--mv-radius) 0 0 var(--mv-radius);
  padding: 11px 14px;
  background: var(--mv-surface);
  color: var(--mv-text);
  font: inherit;
  font-size: 14px;
  outline: none;
  min-width: 0;
}

.input:focus {
  border-color: var(--mv-primary);
}

.field > .input {
  border-radius: var(--mv-radius);
  width: 100%;
  box-sizing: border-box;
  box-shadow: var(--mv-shadow-sm);
}

.domain {
  border: 1px solid var(--mv-border-md);
  border-left: none;
  border-radius: 0 var(--mv-radius) var(--mv-radius) 0;
  padding: 11px 14px;
  font-size: 13px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--mv-primary);
  white-space: nowrap;
  background: var(--mv-surface-md);
}

.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mv-muted-sm);
}

.statusChecking {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mv-muted);
}

.statusOk {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mv-primary);
  font-weight: 600;
}

.statusErr {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mv-error);
  font-weight: 500;
}

.textarea {
  width: 100%;
  border: 1px solid var(--mv-border-md);
  border-radius: var(--mv-radius);
  padding: 11px 14px;
  background: var(--mv-surface);
  color: var(--mv-text);
  font: inherit;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
  box-shadow: var(--mv-shadow-sm);
}

.textarea:hover {
  border-color: var(--mv-card-border-hover);
}

.ownershipBtn {
  margin-top: 10px;
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius);
  padding: 9px 16px;
  background: var(--mv-surface-md);
  color: var(--mv-text-heading);
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  box-shadow: var(--mv-shadow-sm);
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ownershipBtn:hover:not(:disabled) {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
}

.ownershipBtn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.submitBtn {
  width: 100%;
  margin-top: 8px;
  border: 1px solid var(--mv-primary);
  border-radius: var(--mv-radius-full);
  padding: 13px 20px;
  background: linear-gradient(135deg, var(--mv-primary), var(--mv-primary-hover));
  color: #ffffff;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--mv-shadow-glow), var(--mv-shadow-sm);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.submitBtn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 25px var(--mv-primary), var(--mv-shadow-md);
}

.submitBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.submitError {
  margin-bottom: 16px;
  padding: 10px 14px;
  border-radius: var(--mv-radius);
  background: rgba(224, 82, 96, 0.1);
  border: 1px solid rgba(224, 82, 96, 0.3);
  font-size: 13px;
  color: var(--mv-error);
  word-break: break-word;
}

/* Success state */
.successCard {
  text-align: center;
  padding: 44px 28px;
}

.successIcon {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: var(--mv-selected-bg);
  border: 1px solid var(--mv-card-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: var(--mv-primary);
  box-shadow: var(--mv-shadow-glow);
}

.successTitle {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--mv-text-heading);
  margin-bottom: 10px;
}

.successDesc {
  font-size: 15px;
  color: var(--mv-muted);
  margin-bottom: 16px;
}

.successLink {
  display: inline-block;
  font-size: 16px;
  font-weight: 700;
  color: var(--mv-primary);
  word-break: break-all;
  margin-bottom: 16px;
  padding: 6px 14px;
  background: var(--mv-surface);
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
}

.successNote {
  font-size: 13px;
  color: var(--mv-muted-sm);
}
</style>
