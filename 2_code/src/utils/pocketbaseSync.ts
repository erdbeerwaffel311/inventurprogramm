import PocketBase from 'pocketbase';
import {
  AppSettings,
  CategoryInfo,
  InventoryItem,
  InventoryTransaction,
  KellerlisteProject,
  MemberAccount,
  TwoFactorConfig,
} from '../types';
import { normalizeUsernameForComparison } from '../data/defaultData';

export const CONFIG_ROW_ID = '__keller_config__';
export const POCKETBASE_DEFAULT_URL = 'https://api.keller.schuelerunion-vorarlberg.at';

export interface CloudConfigPayload {
  clubName: string;
  adminPassword: string;
  adminEmail?: string;
  twoFactor?: TwoFactorConfig;
  allowedMembers?: string[];
  memberAccounts?: MemberAccount[];
  projectLists?: KellerlisteProject[];
  twoFactorToken?: {
    code: string;
    email: string;
    expiresAt: string;
  };
  categories: CategoryInfo[];
  deletedCategoryIds?: string[];
  commonEvents: string[];
  updatedAt: string;
}

export const POCKETBASE_COLLECTIONS_INFO = `PocketBase Collections-Konfiguration (https://api.keller.schuelerunion-vorarlberg.at/_/):

1. Collection: keller_items (Typ: Base collection)
   API Rules (List, View, Create, Update, Delete): jeweils leer lassen (Public / Everyone)
   Spalten (Fields):
   - name       (Plain text, Nonempty: Nein)
   - category   (Plain text, Nonempty: Nein)
   - quantity   (Number, Standard: 0)
   - updated_at (Plain text)
   - payload    (JSON)

2. Collection: keller_transactions (Typ: Base collection)
   API Rules (List, View, Create, Update, Delete): jeweils leer lassen (Public / Everyone)
   Spalten (Fields):
   - timestamp  (Plain text)
   - type       (Plain text)
   - payload    (JSON)

3. Collection: users (Typ: Auth collection – standardmäßig vorhanden)
   Spalten (Fields):
   - name       (Plain text – standardmäßig vorhanden)
`;

export function normalizePocketBaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  return rawUrl
    .trim()
    .replace(/\/api(\/.*)?$/i, '')
    .replace(/\/_(\/.*)?$/i, '')
    .replace(/\/+$/, '');
}

/**
 * PocketBase verlangt für das Systemfeld `id` exakt 15 Zeichen (`^[a-z0-9]{15}$`).
 * Diese Funktion wandelt beliebige App-IDs (z. B. "__keller_config__", "item-1730...", "tx-1730...")
 * deterministisch in eine gültige 15-stellige PocketBase-ID um.
 */
export function toPocketBaseId(rawId: string): string {
  const trimmed = rawId.trim();
  if (trimmed === CONFIG_ROW_ID || trimmed === 'kellerconfig000') {
    return 'kellerconfig000';
  }
  if (trimmed === '__app_config__' || trimmed === 'appconfig000000') {
    return 'appconfig000000';
  }
  if (trimmed === '__sip_users_config__' || trimmed === 'sipusersconfig0') {
    return 'sipusersconfig0';
  }
  if (/^[a-z0-9]{15}$/.test(trimmed)) {
    return trimmed;
  }

  const cleanPrefix = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5)
    .padEnd(5, '0');

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ (i * 31);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(36).padStart(5, '0').slice(-5);
  const part2 = (h2 >>> 0).toString(36).padStart(5, '0').slice(-5);
  return `${cleanPrefix}${part1}${part2}`.slice(0, 15).padEnd(15, '0');
}

function parseJsonPayload<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as T;
  }
  return null;
}

let cachedClient: PocketBase | null = null;
let cachedUrl = '';
let lastOtpId = '';

export function getPocketBaseClient(settings: AppSettings): PocketBase | null {
  const url = normalizePocketBaseUrl(settings.pocketbaseUrl);
  if (!url) return null;

  if (cachedClient && cachedUrl === url) {
    return cachedClient;
  }

  try {
    const pb = new PocketBase(url);
    pb.autoCancellation(false);
    cachedClient = pb;
    cachedUrl = url;
    return pb;
  } catch {
    return null;
  }
}

/**
 * Authentifiziert ein Vereinsmitglied über PocketBase (`users` Auth-Collection)
 * sowie über die synchronisierten Vereins-Zugangsdaten (`memberAccounts`).
 */
export async function authenticateMemberWithPocketBase(
  settings: AppSettings,
  usernameInput: string,
  passwordInput: string,
  localAccounts: MemberAccount[]
): Promise<{ account?: MemberAccount; error?: string }> {
  const rawUser = usernameInput.trim();
  const rawPass = passwordInput.trim();

  if (!rawUser || !rawPass) {
    return { error: 'Bitte gib deinen Benutzernamen und dein Passwort ein.' };
  }

  const withDomain = rawUser.includes('@') ? rawUser : `${rawUser}@schuelerunion.at`;
  const normalizedInput = normalizeUsernameForComparison(withDomain);

  const client = getPocketBaseClient(settings);

  // 1. Online-Authentifizierung gegen die PocketBase `users`-Collection versuchen
  if (client && navigator.onLine) {
    try {
      const authData = await client
        .collection('users')
        .authWithPassword(normalizedInput, rawPass, { requestKey: null });

      if (authData?.record) {
        const matchedLocal = localAccounts.find(
          (acc) => normalizeUsernameForComparison(acc.username) === normalizedInput
        );
        const resolvedName =
          (typeof authData.record.name === 'string' && authData.record.name.trim()) ||
          matchedLocal?.name ||
          normalizedInput.split('@')[0];
        const resolvedUsername =
          (typeof authData.record.email === 'string' && authData.record.email.trim()) ||
          matchedLocal?.username ||
          normalizedInput;

        return {
          account: {
            name: resolvedName,
            username: resolvedUsername,
            password: rawPass,
          },
        };
      }
    } catch {
      // Falls User noch nicht in der PocketBase `users` Collection angelegt ist,
      // prüfen wir die im Keller-Config hinterlegten `memberAccounts`.
    }
  }

  // 2. Abgleich gegen die hinterlegten `memberAccounts` (inkl. Offline-Support im Keller)
  let matchedAccount = localAccounts.find(
    (acc) => normalizeUsernameForComparison(acc.username) === normalizedInput
  );

  // Falls lokal noch nicht gefunden und online, einmal frisch die Config von PocketBase abrufen
  if ((!matchedAccount || matchedAccount.password !== rawPass) && client && navigator.onLine) {
    try {
      const remote = await pullFromPocketBase(settings);
      if (remote?.config?.memberAccounts?.length) {
        matchedAccount = remote.config.memberAccounts.find(
          (acc) => normalizeUsernameForComparison(acc.username) === normalizedInput
        );
      }
    } catch {
      // Ignorieren (Offline-Fallback)
    }
  }

  if (!matchedAccount) {
    return {
      error: 'Dieser Benutzername ist nicht in der Liste der berechtigten Personen hinterlegt.',
    };
  }

  if (matchedAccount.password !== rawPass) {
    return { error: 'Falsches Passwort. Bitte prüfe deine Eingabe.' };
  }

  // Optional: Benutzer automatisch in der PocketBase `users` Collection synchronisieren, falls online
  if (client && navigator.onLine && rawPass.length >= 8) {
    try {
      await client.collection('users').create(
        {
          email: matchedAccount.username,
          emailVisibility: true,
          password: rawPass,
          passwordConfirm: rawPass,
          name: matchedAccount.name,
        },
        { requestKey: null }
      );
      await client
        .collection('users')
        .authWithPassword(matchedAccount.username, rawPass, { requestKey: null });
    } catch {
      // Ignorieren, falls User bereits in `users` existiert oder Create-Rule geschlossen ist
    }
  }

  return { account: matchedAccount };
}

export function logoutFromPocketBase(settings: AppSettings): void {
  const client = getPocketBaseClient(settings);
  if (client) {
    client.authStore.clear();
  }
}

/**
 * Sendet einen 2FA-Bestätigungscode (OTP) an die hinterlegte Admin-E-Mail-Adresse über PocketBase Auth.
 */
export async function sendAdmin2FAEmail(
  settings: AppSettings,
  targetEmail: string
): Promise<{ rateLimited: boolean }> {
  const client = getPocketBaseClient(settings);
  if (!client) {
    throw new Error('Keine gültige PocketBase-Datenbankverbindung konfiguriert.');
  }
  const cleanEmail = targetEmail.trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
  }

  try {
    const res = await client.collection('users').requestOTP(cleanEmail, { requestKey: null });
    lastOtpId = res.otpId;
    return { rateLimited: false };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const message = (err as { message?: string })?.message || '';
    if (status === 429 || message.toLowerCase().includes('rate limit')) {
      return { rateLimited: true };
    }
    throw new Error(message || 'Fehler beim Senden der 2FA-E-Mail über PocketBase.');
  }
}

/**
 * Prüft einen eingegebenen 2FA-Code gegen PocketBase OTP oder einen in der Cloud hinterlegten 2FA-Token.
 */
export async function verifyAdmin2FACode(
  settings: AppSettings,
  email: string,
  tokenOrLink: string
): Promise<boolean> {
  const client = getPocketBaseClient(settings);
  if (!client) {
    throw new Error('Keine gültige PocketBase-Verbindung vorhanden.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const rawInput = tokenOrLink.trim();
  if (!rawInput) return false;

  async function checkCloudTwoFactorToken(candidateCode: string): Promise<boolean> {
    const cleanCandidate = candidateCode.trim();
    if (!cleanCandidate) return false;
    try {
      const record = await client!
        .collection('keller_items')
        .getOne(toPocketBaseId(CONFIG_ROW_ID), { requestKey: null });
      const cfg = parseJsonPayload<CloudConfigPayload>(record?.payload);
      if (
        cfg?.twoFactorToken &&
        cfg.twoFactorToken.code === cleanCandidate &&
        cfg.twoFactorToken.email.toLowerCase() === cleanEmail &&
        new Date(cfg.twoFactorToken.expiresAt).getTime() > Date.now()
      ) {
        return true;
      }
    } catch {
      // Ignorieren
    }
    return false;
  }

  if (
    rawInput.startsWith('http://') ||
    rawInput.startsWith('https://') ||
    rawInput.includes('2fa_code=') ||
    rawInput.includes('code=') ||
    rawInput.includes('token=')
  ) {
    try {
      const normalizedUrlStr = rawInput.startsWith('http')
        ? rawInput
        : `https://dummy.local/?${rawInput.replace(/^#/, '')}`;
      const parsedUrl = new URL(normalizedUrlStr);
      const directCode =
        parsedUrl.searchParams.get('2fa_code') ||
        parsedUrl.searchParams.get('code') ||
        parsedUrl.searchParams.get('token');
      if (directCode && (await checkCloudTwoFactorToken(directCode))) {
        return true;
      }
    } catch {
      // Fallback auf normale Code-Prüfung
    }
  }

  const cleanToken = rawInput.replace(/\s+/g, '');
  if (await checkCloudTwoFactorToken(cleanToken)) {
    return true;
  }

  if (lastOtpId) {
    try {
      const authData = await client
        .collection('users')
        .authWithOTP(lastOtpId, cleanToken, { requestKey: null });
      if (authData?.record) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export async function pullFromPocketBase(settings: AppSettings): Promise<{
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  config: CloudConfigPayload | null;
} | null> {
  const client = getPocketBaseClient(settings);
  if (!client || !navigator.onLine) return null;

  const [itemsRes, txListRes] = await Promise.all([
    client.collection('keller_items').getFullList({ requestKey: null }),
    client.collection('keller_transactions').getList(1, 250, { requestKey: null }),
  ]);

  let config: CloudConfigPayload | null = null;
  const items: InventoryItem[] = [];
  const configPbId = toPocketBaseId(CONFIG_ROW_ID);

  for (const row of itemsRes) {
    const payload = parseJsonPayload<Record<string, unknown>>(row.payload);
    const isConfigRow =
      row.id === CONFIG_ROW_ID ||
      row.id === configPbId ||
      row.name === CONFIG_ROW_ID ||
      (row.category === '__system__' && row.name === '__keller_config__');

    if (isConfigRow && payload) {
      config = payload as unknown as CloudConfigPayload;
    } else if (
      (typeof row.id === 'string' && row.id.startsWith('__')) ||
      (typeof row.name === 'string' && row.name.startsWith('__')) ||
      row.category === '__system__' ||
      row.id === toPocketBaseId('__app_config__') ||
      row.id === toPocketBaseId('__sip_users_config__')
    ) {
      continue;
    } else if (payload && typeof payload === 'object') {
      const p = payload as unknown as InventoryItem;
      const itemId = p.id || row.id;
      if (itemId && !String(itemId).startsWith('__')) {
        items.push({
          ...p,
          id: String(itemId),
          name: p.name || String(row.name || 'Artikel'),
          category: p.category || String(row.category || 'consumables'),
          quantity: typeof p.quantity === 'number' ? p.quantity : Number(row.quantity) || 0,
          unit: p.unit || 'Stück',
        });
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const transactions: InventoryTransaction[] = (txListRes.items || [])
    .map((r) => {
      const p = parseJsonPayload<InventoryTransaction>(r.payload);
      if (!p || !p.id) return null;
      return {
        ...p,
        timestamp: p.timestamp || String(r.timestamp || r.created || new Date().toISOString()),
        type: p.type || (r.type as InventoryTransaction['type']) || 'withdraw',
        synced: true,
      };
    })
    .filter((t): t is InventoryTransaction => Boolean(t))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { items, transactions, config };
}

async function upsertPocketBaseRecord(
  client: PocketBase,
  collectionName: string,
  pbId: string,
  data: Record<string, unknown>,
  existingIds?: Set<string>
): Promise<void> {
  if (existingIds) {
    if (existingIds.has(pbId)) {
      await client.collection(collectionName).update(pbId, data, { requestKey: null });
    } else {
      await client
        .collection(collectionName)
        .create({ id: pbId, ...data }, { requestKey: null });
      existingIds.add(pbId);
    }
    return;
  }

  try {
    await client.collection(collectionName).update(pbId, data, { requestKey: null });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      await client
        .collection(collectionName)
        .create({ id: pbId, ...data }, { requestKey: null });
    } else {
      throw err;
    }
  }
}

export async function pushConfigToPocketBase(
  settings: AppSettings,
  deletedCategoryIds: string[] = []
): Promise<boolean> {
  const client = getPocketBaseClient(settings);
  if (!client || !navigator.onLine) return false;

  const now = new Date().toISOString();
  const configPayload: CloudConfigPayload = {
    clubName: settings.clubName,
    adminPassword: settings.adminPassword,
    adminEmail: settings.adminEmail || '',
    twoFactor: settings.twoFactor,
    allowedMembers: settings.allowedMembers || [],
    memberAccounts: settings.memberAccounts || [],
    projectLists: settings.projectLists || [],
    categories: settings.categories,
    deletedCategoryIds,
    commonEvents: settings.commonEvents,
    updatedAt: now,
  };

  const pbId = toPocketBaseId(CONFIG_ROW_ID);
  await upsertPocketBaseRecord(client, 'keller_items', pbId, {
    name: CONFIG_ROW_ID,
    category: '__system__',
    quantity: 0,
    updated_at: now,
    payload: configPayload,
  });

  return true;
}

export async function pushToPocketBase(
  settings: AppSettings,
  items: InventoryItem[],
  transactions: InventoryTransaction[]
): Promise<boolean> {
  const client = getPocketBaseClient(settings);
  if (!client || !navigator.onLine) return false;

  const now = new Date().toISOString();
  const configPayload: CloudConfigPayload = {
    clubName: settings.clubName,
    adminPassword: settings.adminPassword,
    adminEmail: settings.adminEmail || '',
    twoFactor: settings.twoFactor,
    allowedMembers: settings.allowedMembers || [],
    memberAccounts: settings.memberAccounts || [],
    projectLists: settings.projectLists || [],
    categories: settings.categories,
    commonEvents: settings.commonEvents,
    updatedAt: now,
  };

  const [existingItemsRes, existingTxsRes] = await Promise.all([
    client
      .collection('keller_items')
      .getFullList({ fields: 'id,quantity,updated_at', requestKey: null })
      .catch(() => []),
    client
      .collection('keller_transactions')
      .getFullList({ fields: 'id', requestKey: null })
      .catch(() => []),
  ]);

  const existingItemsMap = new Map<string, { quantity?: number; updated_at?: string }>();
  const existingItemIds = new Set<string>();
  for (const r of existingItemsRes) {
    existingItemIds.add(r.id);
    existingItemsMap.set(r.id, {
      quantity: typeof r.quantity === 'number' ? r.quantity : Number(r.quantity),
      updated_at: typeof r.updated_at === 'string' ? r.updated_at : undefined,
    });
  }

  const existingTxIds = new Set<string>(existingTxsRes.map((r) => r.id));

  // 1. Config-Datensatz immer aktualisieren
  const configPbId = toPocketBaseId(CONFIG_ROW_ID);
  await upsertPocketBaseRecord(
    client,
    'keller_items',
    configPbId,
    {
      name: CONFIG_ROW_ID,
      category: '__system__',
      quantity: 0,
      updated_at: now,
      payload: configPayload,
    },
    existingItemIds
  );

  // 2. Neue oder geänderte Inventar-Artikel synchronisieren
  const itemsToSync = items.filter((item) => {
    const pbId = toPocketBaseId(item.id);
    const existing = existingItemsMap.get(pbId);
    if (!existing) return true;
    const sameQty = existing.quantity === item.quantity;
    const sameTime =
      existing.updated_at &&
      item.updatedAt &&
      new Date(existing.updated_at).getTime() === new Date(item.updatedAt).getTime();
    return !(sameQty && sameTime);
  });

  await Promise.all(
    itemsToSync.map((item) => {
      const pbId = toPocketBaseId(item.id);
      return upsertPocketBaseRecord(
        client,
        'keller_items',
        pbId,
        {
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          updated_at: item.updatedAt || now,
          payload: item,
        },
        existingItemIds
      );
    })
  );

  // 3. Ausstehende oder aktualisierte Buchungen synchronisieren
  const unsyncedTxs = transactions.filter((tx) => !tx.synced);
  const txsToPush = unsyncedTxs.length > 0 ? unsyncedTxs : transactions.slice(0, 25);

  await Promise.all(
    txsToPush.map((tx) => {
      const pbId = toPocketBaseId(tx.id);
      return upsertPocketBaseRecord(
        client,
        'keller_transactions',
        pbId,
        {
          timestamp: tx.timestamp,
          type: tx.type,
          payload: { ...tx, synced: true },
        },
        existingTxIds
      );
    })
  );

  return true;
}

export async function deleteItemFromPocketBase(
  settings: AppSettings,
  itemId: string
): Promise<void> {
  const client = getPocketBaseClient(settings);
  if (!client || !navigator.onLine) return;
  try {
    await client
      .collection('keller_items')
      .delete(toPocketBaseId(itemId), { requestKey: null });
  } catch {
    // Ignorieren, falls der Artikel noch nicht in PocketBase existierte
  }
}

export async function deleteTransactionFromPocketBase(
  settings: AppSettings,
  txId: string
): Promise<void> {
  const client = getPocketBaseClient(settings);
  if (!client || !navigator.onLine) return;
  try {
    await client
      .collection('keller_transactions')
      .delete(toPocketBaseId(txId), { requestKey: null });
  } catch {
    // Ignorieren, falls die Buchung noch nicht in PocketBase existierte
  }
}

/**
 * Erzeugt einen Einladungs-Link (inkl. PocketBase-Server-URL), der als QR-Code an die Kellertür
 * gehängt werden kann, damit Vereinsmitglieder mit 1 Scan sofort mit derselben Datenbank verbunden sind.
 */
export function buildShareableAppUrl(settings: AppSettings): string {
  const isNativeOrLocal =
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost';
  const baseUrl = isNativeOrLocal
    ? 'https://erdbeerwaffel311.github.io/inventurprogramm/'
    : window.location.origin + window.location.pathname;
  const params = new URLSearchParams();
  if (settings.clubName) params.set('club', settings.clubName);
  const cleanUrl = normalizePocketBaseUrl(settings.pocketbaseUrl);
  if (cleanUrl) params.set('dbUrl', cleanUrl);

  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}
