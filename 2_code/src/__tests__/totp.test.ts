import { describe, it, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  getOtpAuthUrl,
  generateBackupCodes,
  formatBackupCodesForExport,
  verifyTwoFactorInput,
} from '../utils/totp';
import { TwoFactorConfig } from '../types';

describe('2FA & TOTP Authenticator Utilities', () => {
  it('kodiert und dekodiert Base32 gemäß RFC 4648 korrekt', () => {
    const raw = new Uint8Array([72, 101, 108, 108, 111, 33]); // "Hello!"
    const encoded = base32Encode(raw);
    expect(encoded).toBe('JBSWY3DPEE');

    const decoded = base32Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(raw));
  });

  it('generiert ein zufälliges 32-stelliges Base32 TOTP-Secret', () => {
    const secret1 = generateTotpSecret();
    const secret2 = generateTotpSecret();

    expect(secret1).toHaveLength(32);
    expect(secret2).toHaveLength(32);
    expect(secret1).not.toBe(secret2);
    expect(/^[A-Z2-7]+$/.test(secret1)).toBe(true);
  });

  it('erzeugt und verifiziert einen 6-stelligen TOTP-Code', async () => {
    const secret = generateTotpSecret();
    const now = Date.now();

    const token = await generateTotp(secret, now);
    expect(token).toHaveLength(6);
    expect(/^\d{6}$/.test(token)).toBe(true);

    const isValid = await verifyTotp(secret, token, 1, now);
    expect(isValid).toBe(true);

    const isInvalid = await verifyTotp(secret, '000000', 1, now);
    expect(isInvalid).toBe(false);
  });

  it('toleriert Zeittoleranz (±30 Sekunden) bei TOTP-Prüfung', async () => {
    const secret = generateTotpSecret();
    const now = 1700000000000;

    // Token aus dem vorherigen 30s-Fenster
    const pastToken = await generateTotp(secret, now - 30_000);
    // Token aus dem nächsten 30s-Fenster
    const futureToken = await generateTotp(secret, now + 30_000);
    // Token weit in der Vergangenheit (2 Minuten zurück)
    const farPastToken = await generateTotp(secret, now - 120_000);

    // Bei windowSteps = 1 (Standard) müssen past und future akzeptiert werden
    expect(await verifyTotp(secret, pastToken, 1, now)).toBe(true);
    expect(await verifyTotp(secret, futureToken, 1, now)).toBe(true);
    expect(await verifyTotp(secret, farPastToken, 1, now)).toBe(false);
  });

  it('erzeugt gültige otpauth-URL für QR-Codes', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const url = getOtpAuthUrl(secret, 'Admin', 'Vereinskeller Dornbirn');
    expect(url).toContain('otpauth://totp/Vereinskeller%20Dornbirn:Admin');
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });

  it('generiert genau 10 einzigartige Ersatzcodes im Format XXXX-XXXX', () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);

    const codeStrings = codes.map((c) => c.code);
    const unique = new Set(codeStrings);
    expect(unique.size).toBe(10);

    codes.forEach((c) => {
      expect(c.used).toBe(false);
      expect(c.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    });
  });

  it('formatiert Ersatzcodes übersichtlich für den Download', () => {
    const codes = generateBackupCodes(10);
    const formatted = formatBackupCodesForExport(codes, 'Vereinskeller');
    expect(formatted).toContain('VEREINSKELLER – 2FA ERSATZCODES');
    expect(formatted).toContain('Verfügbare Codes: 10 von 10');
    expect(formatted).toContain(codes[0].code);
    expect(formatted).toContain(codes[9].code);
  });

  it('verifyTwoFactorInput validiert TOTP-Code erfolgreich', async () => {
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes(10);
    const twoFactor: TwoFactorConfig = {
      enabled: true,
      secret,
      backupCodes,
      createdAt: new Date().toISOString(),
    };

    const token = await generateTotp(secret);
    const res = await verifyTwoFactorInput(twoFactor, token);
    expect(res.valid).toBe(true);
    expect(res.isBackupCode).toBe(false);
    expect(res.remainingBackupCodes).toBe(10);
  });

  it('verifyTwoFactorInput validiert und entwertet einen Ersatzcode (Single-Use)', async () => {
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes(10);
    const twoFactor: TwoFactorConfig = {
      enabled: true,
      secret,
      backupCodes,
      createdAt: new Date().toISOString(),
    };

    const firstCode = backupCodes[0].code;

    // Einlösung mit Bindestrich
    const res1 = await verifyTwoFactorInput(twoFactor, firstCode);
    expect(res1.valid).toBe(true);
    expect(res1.isBackupCode).toBe(true);
    expect(res1.usedBackupCode).toBe(firstCode);
    expect(res1.remainingBackupCodes).toBe(9);
    expect(res1.updatedBackupCodes).toBeDefined();

    const updatedConfig: TwoFactorConfig = {
      ...twoFactor,
      backupCodes: res1.updatedBackupCodes!,
    };

    // Zweiter Versuch mit demselben Code muss fehlschlagen
    const res2 = await verifyTwoFactorInput(updatedConfig, firstCode);
    expect(res2.valid).toBe(false);
    expect(res2.errorMessage).toContain('bereits');

    // Einlösung ohne Bindestrich und klein geschrieben (z. B. "abcd1234")
    const secondCodeRaw = backupCodes[1].code.replace('-', '').toLowerCase();
    const res3 = await verifyTwoFactorInput(updatedConfig, secondCodeRaw);
    expect(res3.valid).toBe(true);
    expect(res3.isBackupCode).toBe(true);
    expect(res3.remainingBackupCodes).toBe(8);
  });

  it('weist falsche Codes und inaktive 2FA ab', async () => {
    const resInactive = await verifyTwoFactorInput(undefined, '123456');
    expect(resInactive.valid).toBe(false);

    const twoFactor: TwoFactorConfig = {
      enabled: true,
      secret: generateTotpSecret(),
      backupCodes: generateBackupCodes(10),
      createdAt: new Date().toISOString(),
    };

    const resWrong = await verifyTwoFactorInput(twoFactor, '999999');
    expect(resWrong.valid).toBe(false);

    const resRandom = await verifyTwoFactorInput(twoFactor, 'INVALID-CODE');
    expect(resRandom.valid).toBe(false);
  });

  it('erlaubt das sukzessive Einlösen aller 10 Ersatzcodes bis auf 0', async () => {
    const secret = generateTotpSecret();
    let currentBackupCodes = generateBackupCodes(10);
    let currentConfig: TwoFactorConfig = {
      enabled: true,
      secret,
      backupCodes: currentBackupCodes,
      createdAt: new Date().toISOString(),
    };

    for (let i = 0; i < 10; i++) {
      const codeToUse = currentConfig.backupCodes[i].code;
      const res = await verifyTwoFactorInput(currentConfig, codeToUse);
      expect(res.valid).toBe(true);
      expect(res.isBackupCode).toBe(true);
      expect(res.remainingBackupCodes).toBe(9 - i);

      currentConfig = {
        ...currentConfig,
        backupCodes: res.updatedBackupCodes!,
      };
    }

    // Jetzt sind alle 10 verbraucht
    const exportText = formatBackupCodesForExport(currentConfig.backupCodes, 'Vereinskeller');
    expect(exportText).toContain('Verfügbare Codes: 0 von 10');

    // Erneuter Versuch mit irgendeinem der Codes schlägt fehl
    const failRes = await verifyTwoFactorInput(currentConfig, currentBackupCodes[0].code);
    expect(failRes.valid).toBe(false);
    expect(failRes.errorMessage).toContain('bereits');
  });
});
