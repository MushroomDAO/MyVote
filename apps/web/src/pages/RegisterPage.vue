<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const name = ref('')
const spaceId = ref('')
const description = ref('')

const checking = ref(false)
const nameStatus = ref<'idle' | 'available' | 'taken' | 'invalid'>('idle')
const checkError = ref<string | null>(null)

const submitting = ref(false)
const submitError = ref<string | null>(null)
const successUrl = ref<string | null>(null)

const nameLower = computed(() => name.value.toLowerCase().trim())
const isValidName = computed(() => /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(nameLower.value))

let checkTimer: ReturnType<typeof setTimeout> | null = null

function onNameInput() {
  nameStatus.value = 'idle'
  checkError.value = null
  successUrl.value = null
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

async function onSubmit() {
  if (nameStatus.value !== 'available') return
  if (!spaceId.value.trim()) return

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
        description: description.value.trim()
      })
    })
    const data = await res.json() as { success?: boolean; url?: string; error?: string }
    if (!res.ok || data.error) {
      submitError.value = data.error ?? t('registerError')
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
      <div class="successNote">DNS 生效可能需要 1–2 分钟，届时刷新即可访问。</div>
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
          <span class="domain">.forest.mushroom.cv</span>
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

      <div v-if="submitError" class="submitError">{{ t('registerError') }}: {{ submitError }}</div>

      <button
        class="submitBtn"
        type="button"
        :disabled="nameStatus !== 'available' || !spaceId.trim() || submitting"
        @click="onSubmit"
      >
        {{ submitting ? t('loading') : t('registerBtn') }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 600px;
  margin: 0 auto;
  padding: 24px;
}

.title {
  margin: 0 0 16px;
  font-size: 20px;
  font-weight: 600;
}

.card {
  border: 1px solid var(--mv-border);
  border-radius: 12px;
  padding: 20px;
}

.desc {
  margin: 0 0 20px;
  color: var(--mv-muted);
  font-size: 14px;
}

.field {
  margin-bottom: 18px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: 0;
}

.input {
  flex: 1;
  border: 1px solid var(--mv-border-md);
  border-radius: 8px 0 0 8px;
  padding: 9px 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  outline: none;
  min-width: 0;
}

.input:focus {
  border-color: var(--mv-primary);
}

.field > .input {
  border-radius: 8px;
  width: 100%;
  box-sizing: border-box;
}

.domain {
  border: 1px solid var(--mv-border-md);
  border-left: none;
  border-radius: 0 8px 8px 0;
  padding: 9px 12px;
  font-size: 13px;
  color: var(--mv-muted);
  white-space: nowrap;
  background: var(--mv-surface);
}

.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mv-muted-sm);
}

.statusChecking {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mv-muted);
}

.statusOk {
  margin-top: 4px;
  font-size: 12px;
  color: #10b981;
  font-weight: 600;
}

.statusErr {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mv-error);
}

.textarea {
  width: 100%;
  border: 1px solid var(--mv-border-md);
  border-radius: 8px;
  padding: 9px 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
}

.textarea:focus {
  outline: none;
  border-color: var(--mv-primary);
}

.submitBtn {
  width: 100%;
  border: none;
  border-radius: 10px;
  padding: 12px;
  background: var(--mv-primary);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.submitBtn:hover:not(:disabled) {
  background: var(--mv-primary-hover);
}

.submitBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submitError {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--mv-error);
  word-break: break-word;
}

/* Success state */
.successCard {
  text-align: center;
  padding: 32px 20px;
}

.successIcon {
  font-size: 40px;
  color: #10b981;
  margin-bottom: 12px;
}

.successTitle {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
}

.successDesc {
  font-size: 14px;
  color: var(--mv-muted);
  margin-bottom: 12px;
}

.successLink {
  display: inline-block;
  font-size: 16px;
  font-weight: 600;
  color: var(--mv-primary);
  word-break: break-all;
  margin-bottom: 12px;
}

.successNote {
  font-size: 12px;
  color: var(--mv-muted-sm);
}
</style>
