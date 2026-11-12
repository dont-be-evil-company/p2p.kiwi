import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { ed25519 } from '@noble/curves/ed25519.js'

export type StoredIdentity = {
  publicKey: Uint8Array
  privateKey: Uint8Array
  fingerprint: string
}

const fingerprint = (publicKey: Uint8Array): string =>
  [...publicKey]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)

const identityPath = (): string => join(app.getPath('userData'), 'device-identity.bin')

export const loadOrCreateIdentity = async (): Promise<StoredIdentity> => {
  const file = identityPath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  if (existsSync(file)) {
    const packed = readFileSync(file)
    const raw = (await safeStorage.isAsyncEncryptionAvailable())
      ? (await safeStorage.decryptStringAsync(packed)).result
      : packed.toString('utf8')
    const parsed = JSON.parse(raw) as { publicKey: string; privateKey: string }
    const publicKey = Buffer.from(parsed.publicKey, 'base64')
    const privateKey = Buffer.from(parsed.privateKey, 'base64')
    return {
      publicKey: new Uint8Array(publicKey),
      privateKey: new Uint8Array(privateKey),
      fingerprint: fingerprint(new Uint8Array(publicKey)),
    }
  }
  const secretKey = randomBytes(32)
  const publicKey = ed25519.getPublicKey(secretKey)
  const record = {
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(secretKey).toString('base64'),
  }
  const json = JSON.stringify(record)
  const stored = (await safeStorage.isAsyncEncryptionAvailable())
    ? await safeStorage.encryptStringAsync(json)
    : Buffer.from(json, 'utf8')
  writeFileSync(file, stored, { mode: 0o600 })
  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(secretKey),
    fingerprint: fingerprint(new Uint8Array(publicKey)),
  }
}
