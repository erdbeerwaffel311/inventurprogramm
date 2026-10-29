import { BackupCode, TwoFactorConfig } from '../types';

// RFC 4648 Base32 Alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Wandelt ein Byte-Array in einen Base32-String um (RFC 4648, ohne Padding).
 */
export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Dekodiert einen Base32-String in ein Byte-Array.
 */
export function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      continue; // Ignoriere ungültige Zeichen
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Erzeugt ein kryptografisch sicheres Base32-Secret für TOTP (20 Bytes = 160 Bit, 32 Zeichen).
 */
export function generateTotpSecret(byteLength: number = 20): string {
  const buffer = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(buffer);
  return base32Encode(buffer);
}

/**
 * Berechnet den 6-stelligen TOTP-Code für ein gegebenes Secret und einen Zeitstempel (RFC 6238 / RFC 4226).
 */
export async function generateTotp(
  secret: string,
  timeMs: number = Date.now(),
  stepSeconds: number = 30,
  digits: number = 6
): Promise<string> {
  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) {
    throw new Error('Ungültiges Base32 TOTP-Secret');
  }

  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const counterBuffer = new ArrayBuffer(8);
  const dataView = new DataView(counterBuffer);
  // 64-bit Big-Endian Counter
  dataView.setBigUint64(0, BigInt(counter), false);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
  const sigBytes = new Uint8Array(signature);

  // Dynamisches Truncating gemäß RFC 4226 Section 5.4
  const offset = sigBytes[sigBytes.length - 1] & 0x0f;
  const binary =
    ((sigBytes[offset] & 0x7f) << 24) |
    ((sigBytes[offset + 1] & 0xff) << 16) |
    ((sigBytes[offset + 2] & 0xff) << 8) |
    (sigBytes[offset + 3] & 0xff);

  const modulo = 10 ** digits;
  const token = (binary % modulo).toString().padStart(digits, '0');
  return token;
}

/**
 * Prüft einen eingegebenen 6-stelligen TOTP-Code gegen das Secret mit Zeittoleranz (Drift).
 * Standardmäßig werden das aktuelle 30s-Fenster sowie ±1 Fenster (insgesamt 90 Sekunden) akzeptiert.
 */
export async function verifyTotp(
  secret: string,
  tokenInput: string,
  windowSteps: number = 1,
  timeMs: number = Date.now(),
  stepSeconds: number = 30
): Promise<boolean> {
  const cleanToken = tokenInput.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanToken)) {
    return false;
  }

  const currentCounter = Math.floor(timeMs / 1000 / stepSeconds);

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const candidateCounterTime = (currentCounter + offset) * stepSeconds * 1000;
    try {
      const expected = await generateTotp(secret, candidateCounterTime, stepSeconds, 6);
      if (expected === cleanToken) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Erzeugt die standardkonforme `otpauth://`-URL zum Scannen mit Authentifizierungs-Apps.
 */
export function getOtpAuthUrl(
  secret: string,
  accountName: string = 'Admin',
  issuer: string = 'Vereinskeller'
): string {
  const encIssuer = encodeURIComponent(issuer.trim() || 'Vereinskeller');
  const encAccount = encodeURIComponent(accountName.trim() || 'Admin');
  return `otpauth://totp/${encIssuer}:${encAccount}?secret=${secret}&issuer=${encIssuer}&algorithm=SHA1&digits=6&period=30`;
}

// Zeichensatz für verwechslungssichere Ersatzcodes (ohne 0, O, 1, I, L)
const BACKUP_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generiert 10 einmalig verwendbare Ersatzcodes im Format XXXX-XXXX.
 */
export function generateBackupCodes(count: number = 10): BackupCode[] {
  const codes: BackupCode[] = [];
  const generated = new Set<string>();

  while (codes.length < count) {
    const randomBytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(randomBytes);
    let codeStr = '';
    for (let i = 0; i < 8; i++) {
      codeStr += BACKUP_CHARSET[randomBytes[i] % BACKUP_CHARSET.length];
    }
    const formatted = `${codeStr.slice(0, 4)}-${codeStr.slice(4)}`;
    if (!generated.has(formatted)) {
      generated.add(formatted);
      codes.push({
        code: formatted,
        used: false,
      });
    }
  }

  return codes;
}

/**
 * Formatiert die Ersatzcodes als übersichtlichen Text zum Download oder Kopieren.
 */
export function formatBackupCodesForExport(
  backupCodes: BackupCode[],
  clubName: string = 'Vereinskeller'
): string {
  const activeCount = backupCodes.filter((c) => !c.used).length;
  const lines: string[] = [
    `==================================================`,
    `${clubName.toUpperCase()} – 2FA ERSATZCODES`,
    `==================================================`,
    `Erstellt am: ${new Date().toLocaleString('de-AT')}`,
    `Verfügbare Codes: ${activeCount} von ${backupCodes.length}`,
    ``,
    `WICHTIGER HINWEIS:`,
    `- Jeder dieser Codes kann genau EINMAL verwendet werden,`,
    `  falls du keinen Zugriff auf deine Authentifizierungs-App hast.`,
    `- Bewahre diese Codes an einem sicheren Ort auf (z. B. Passwort-Manager).`,
    `- Sobald alle Codes aufgebraucht sind, können im Admin-Bereich neue generiert werden.`,
    `--------------------------------------------------`,
  ];

  backupCodes.forEach((bc, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const status = bc.used ? `[BEREITS VERWENDET am ${bc.usedAt || 'unbekannt'}]` : '[GÜLTIG]';
    lines.push(`  ${num}.  ${bc.code}  ${status}`);
  });

  lines.push(`--------------------------------------------------`);
  lines.push(``);

  return lines.join('\n');
}

export interface VerifyTwoFactorResult {
  valid: boolean;
  isBackupCode?: boolean;
  usedBackupCode?: string;
  remainingBackupCodes?: number;
  updatedBackupCodes?: BackupCode[];
  errorMessage?: string;
}

/**
 * Universelle 2FA-Eingabeprüfung:
 * Prüft entweder einen 6-stelligen TOTP-Code aus der Authentifizierungs-App
 * ODER einen noch nicht genutzten Ersatzcode (Format: XXXX-XXXX bzw. XXXXXXXX).
 */
export async function verifyTwoFactorInput(
  twoFactor: TwoFactorConfig | undefined,
  input: string
): Promise<VerifyTwoFactorResult> {
  if (!twoFactor || !twoFactor.enabled || !twoFactor.secret) {
    return { valid: false, errorMessage: '2FA ist nicht eingerichtet oder nicht aktiviert.' };
  }

  const raw = input.trim();
  if (!raw) {
    return { valid: false, errorMessage: 'Bitte gib einen 6-stelligen Handycode oder Ersatzcode ein.' };
  }

  // 1. Prüfe, ob es sich um einen 6-stelligen Zifferncode handelt (TOTP)
  const numericOnly = raw.replace(/\s+/g, '');
  if (/^\d{6}$/.test(numericOnly)) {
    const isTotpValid = await verifyTotp(twoFactor.secret, numericOnly);
    if (isTotpValid) {
      const remaining = (twoFactor.backupCodes || []).filter((c) => !c.used).length;
      return {
        valid: true,
        isBackupCode: false,
        remainingBackupCodes: remaining,
      };
    }
    // Falls 6 Ziffern fehlschlugen, noch prüfen ob es zufällig ein Ersatzcode ist (meist 8 Zeichen, aber sicher ist sicher)
  }

  // 2. Prüfe, ob es sich um einen Ersatzcode handelt
  const normalizedCandidate = raw.toUpperCase().replace(/[\s-]/g, '');
  const existingCodes = twoFactor.backupCodes || [];

  const foundIndex = existingCodes.findIndex(
    (bc) => bc.code.replace(/[\s-]/g, '').toUpperCase() === normalizedCandidate
  );

  if (foundIndex !== -1) {
    const targetCode = existingCodes[foundIndex];
    if (targetCode.used) {
      return {
        valid: false,
        errorMessage: `Dieser Ersatzcode (${targetCode.code}) wurde bereits am ${targetCode.usedAt || 'früher'} verwendet.`,
      };
    }

    // Gültigen Ersatzcode entwerten (Single Use)
    const updatedCodes: BackupCode[] = existingCodes.map((bc, idx) =>
      idx === foundIndex
        ? {
            ...bc,
            used: true,
            usedAt: new Date().toISOString(),
          }
        : bc
    );

    const remaining = updatedCodes.filter((c) => !c.used).length;

    return {
      valid: true,
      isBackupCode: true,
      usedBackupCode: targetCode.code,
      remainingBackupCodes: remaining,
      updatedBackupCodes: updatedCodes,
    };
  }

  return {
    valid: false,
    errorMessage:
      'Ungültiger Code. Bitte gib den 6-stelligen Code aus deiner Authenticator-App oder einen ungenutzten Ersatzcode ein.',
  };
}
