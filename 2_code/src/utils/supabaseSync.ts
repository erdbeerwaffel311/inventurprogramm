import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  AppSettings,
  CategoryInfo,
  InventoryItem,
  InventoryTransaction,
  KellerlisteProject,
  MemberAccount,
} from '../types';

export const CONFIG_ROW_ID = '__keller_config__';

export interface CloudConfigPayload {
  clubName: string;
  adminPassword: string;
  adminEmail?: string;
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

export const SUPABASE_SETUP_SQL = `-- Dieses Skript im Supabase "SQL Editor" einfügen und auf "Run" klicken:

create table if not exists public.keller_items (
  id text primary key,
  name text not null,
  category text not null,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists public.keller_transactions (
  id text primary key,
  timestamp timestamptz not null default now(),
  type text not null,
  payload jsonb not null
);

alter table public.keller_items enable row level security;
alter table public.keller_transactions enable row level security;

grant usage on schema public to anon, authenticated;
grant all on table public.keller_items to anon, authenticated;
grant all on table public.keller_transactions to anon, authenticated;

drop policy if exists "Vereinskeller Items Vollzugriff" on public.keller_items;
create policy "Vereinskeller Items Vollzugriff"
  on public.keller_items for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Vereinskeller Buchungen Vollzugriff" on public.keller_transactions;
create policy "Vereinskeller Buchungen Vollzugriff"
  on public.keller_transactions for all
  to anon, authenticated
  using (true)
  with check (true);
`;

export function normalizeSupabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  return rawUrl
    .trim()
    .replace(/\/rest\/v1\/?.*$/i, '')
    .replace(/\/+$/, '');
}

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';

export function getSupabaseClient(settings: AppSettings): SupabaseClient | null {
  const url = normalizeSupabaseUrl(settings.supabaseUrl);
  const key = settings.supabaseAnonKey?.trim();
  if (!url || !key) return null;

  const cacheToken = `${url}::${key}`;
  if (cachedClient && cachedKey === cacheToken) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, key, {
      auth: { persistSession: true, detectSessionInUrl: true },
    });
    cachedKey = cacheToken;
    return cachedClient;
  } catch {
    return null;
  }
}

/**
 * Sendet einen 2FA-Bestätigungscode / Magic-Link an die hinterlegte Admin-E-Mail-Adresse über Supabase Auth.
 * Falls das kostenlose Supabase-Limit (max. 2 E-Mails/Stunde) erreicht ist, wird `rateLimited: true`
 * zurückgegeben, damit das Eingabefeld trotzdem geöffnet wird und bereits empfangene Links/Codes genutzt werden können.
 */
export async function sendAdmin2FAEmail(
  settings: AppSettings,
  targetEmail: string
): Promise<{ rateLimited: boolean }> {
  const client = getSupabaseClient(settings);
  if (!client) {
    throw new Error('Keine gültige Supabase-Datenbankverbindung konfiguriert.');
  }
  const cleanEmail = targetEmail.trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
  }

  const redirectUrl = 'https://erdbeerwaffel311.github.io/inventurprogramm/?2fa=verify';
  const { error } = await client.auth.signInWithOtp({
    email: cleanEmail,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectUrl,
    },
  });

  if (error) {
    const msgLower = (error.message || '').toLowerCase();
    if (
      msgLower.includes('rate limit') ||
      msgLower.includes('over_email_send_rate_limit') ||
      error.status === 429
    ) {
      return { rateLimited: true };
    }
    throw new Error(error.message || 'Fehler beim Senden der 2FA-E-Mail.');
  }

  return { rateLimited: false };
}

/**
 * Prüft den eingegebenen 2FA-Code (6-8-stelliger Zahlencode), einen aus der E-Mail kopierten
 * Bestätigungs-Link oder die Weiterleitungs-URL (auch falls Supabase auf localhost:3000 weitergeleitet hat).
 */
export async function verifyAdmin2FACode(
  settings: AppSettings,
  email: string,
  tokenOrLink: string
): Promise<boolean> {
  const client = getSupabaseClient(settings);
  if (!client) {
    throw new Error('Keine gültige Supabase-Verbindung vorhanden.');
  }
  const sb = client;

  const cleanEmail = email.trim().toLowerCase();
  const rawInput = tokenOrLink.trim();
  if (!rawInput) return false;

  // Hilfsprüfung gegen einen in der Cloud hinterlegten 2FA-Freigabecode (falls aktiv)
  async function checkCloudTwoFactorToken(candidateCode: string): Promise<boolean> {
    const cleanCandidate = candidateCode.trim();
    if (!cleanCandidate) return false;
    try {
      const { data } = await sb
        .from('keller_items')
        .select('payload')
        .eq('id', CONFIG_ROW_ID)
        .maybeSingle();
      const cfg = data?.payload as CloudConfigPayload | undefined;
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

  // 1. Falls eine URL eingefügt wurde (entweder der Link aus der E-Mail ODER die localhost:3000/#access_token=... Adresse)
  if (
    rawInput.startsWith('http://') ||
    rawInput.startsWith('https://') ||
    rawInput.startsWith('localhost') ||
    rawInput.includes('access_token=') ||
    rawInput.includes('token=') ||
    rawInput.includes('2fa_code=')
  ) {
    try {
      const normalizedUrlStr = rawInput.startsWith('localhost')
        ? `http://${rawInput}`
        : rawInput.startsWith('http')
        ? rawInput
        : `https://dummy.local/?${rawInput.replace(/^#/, '')}`;
      const parsedUrl = new URL(normalizedUrlStr);

      // Fall A: #access_token=... in der URL (z. B. nach Klick auf den Link -> http://localhost:3000/#access_token=...)
      const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
      const accessToken =
        hashParams.get('access_token') || parsedUrl.searchParams.get('access_token');
      if (accessToken) {
        const { data, error } = await client.auth.getUser(accessToken);
        if (!error && data?.user?.email?.toLowerCase() === cleanEmail) {
          return true;
        }
      }

      // Fall B: ?2fa_code=... oder ?code=... in der URL
      const directCode =
        parsedUrl.searchParams.get('2fa_code') || parsedUrl.searchParams.get('code');
      if (directCode) {
        if (await checkCloudTwoFactorToken(directCode)) {
          return true;
        }
        const { data, error } = await client.auth.exchangeCodeForSession(directCode);
        if (!error && (data?.user?.email?.toLowerCase() === cleanEmail || data?.session)) {
          return true;
        }
      }

      // Fall C: Ungeklickter Bestätigungs-Link direkt aus der E-Mail kopiert (?token=...&type=magiclink)
      const tokenHash =
        parsedUrl.searchParams.get('token_hash') || parsedUrl.searchParams.get('token');
      if (tokenHash) {
        if (await checkCloudTwoFactorToken(tokenHash)) {
          return true;
        }
        const linkTypes: Array<'magiclink' | 'email' | 'signup'> = [
          (parsedUrl.searchParams.get('type') as 'magiclink' | 'email' | 'signup') || 'magiclink',
          'magiclink',
          'email',
          'signup',
        ];
        for (const t of linkTypes) {
          const { data, error } = await client.auth.verifyOtp({
            token_hash: tokenHash,
            type: t,
          });
          if (!error && (data?.session || data?.user)) {
            return true;
          }
        }
      }
    } catch {
      // Fallback auf normale Code-Prüfung
    }
  }

  // 2. Prüfung gegen Cloud-Freigabecode oder 6- bis 8-stelligen Supabase OTP-Code
  const cleanToken = rawInput.replace(/\s+/g, '');
  if (await checkCloudTwoFactorToken(cleanToken)) {
    return true;
  }

  const typesToTry: Array<'email' | 'magiclink' | 'signup'> = ['email', 'magiclink', 'signup'];

  for (const otpType of typesToTry) {
    const { data, error } = await client.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: otpType,
    });
    if (!error && (data?.session || data?.user)) {
      return true;
    }
  }

  return false;
}

export async function pullFromSupabase(settings: AppSettings): Promise<{
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  config: CloudConfigPayload | null;
} | null> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return null;

  const [itemsRes, txRes] = await Promise.all([
    client.from('keller_items').select('id, payload').order('name', { ascending: true }),
    client
      .from('keller_transactions')
      .select('payload')
      .order('timestamp', { ascending: false })
      .limit(250),
  ]);

  if (itemsRes.error || txRes.error) {
    throw new Error(itemsRes.error?.message || txRes.error?.message || 'Supabase Abruf-Fehler');
  }

  let config: CloudConfigPayload | null = null;
  const items: InventoryItem[] = [];

  for (const row of itemsRes.data || []) {
    if (row.id === CONFIG_ROW_ID) {
      config = row.payload as CloudConfigPayload;
    } else if (typeof row.id === 'string' && row.id.startsWith('__')) {
      // Systemzeilen wie __keller_config__ oder __sip_session_current__ nicht als Inventarartikel laden
      continue;
    } else if (row.payload && typeof row.payload === 'object' && row.payload.id && !String(row.payload.id).startsWith('__')) {
      const p = row.payload as InventoryItem;
      // Sicherstellen, dass Pflichtfelder vorhanden sind
      items.push({
        ...p,
        unit: p.unit || 'Stück',
      });
    }
  }

  const transactions: InventoryTransaction[] = (txRes.data || [])
    .map((r: { payload: InventoryTransaction }) => ({ ...r.payload, synced: true }))
    .filter(Boolean);

  return { items, transactions, config };
}

export async function pushConfigToSupabase(
  settings: AppSettings,
  deletedCategoryIds: string[] = []
): Promise<boolean> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return false;

  const now = new Date().toISOString();
  const configPayload: CloudConfigPayload = {
    clubName: settings.clubName,
    adminPassword: settings.adminPassword,
    adminEmail: settings.adminEmail || '',
    allowedMembers: settings.allowedMembers || [],
    memberAccounts: settings.memberAccounts || [],
    projectLists: settings.projectLists || [],
    categories: settings.categories,
    deletedCategoryIds,
    commonEvents: settings.commonEvents,
    updatedAt: now,
  };

  const { error } = await client.from('keller_items').upsert(
    [
      {
        id: CONFIG_ROW_ID,
        name: '__keller_config__',
        category: '__system__',
        quantity: 0,
        updated_at: now,
        payload: configPayload,
      },
    ],
    { onConflict: 'id' }
  );

  if (error) throw new Error(error.message);
  return true;
}

export async function pushToSupabase(
  settings: AppSettings,
  items: InventoryItem[],
  transactions: InventoryTransaction[]
): Promise<boolean> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return false;

  const now = new Date().toISOString();
  const configPayload: CloudConfigPayload = {
    clubName: settings.clubName,
    adminPassword: settings.adminPassword,
    adminEmail: settings.adminEmail || '',
    allowedMembers: settings.allowedMembers || [],
    memberAccounts: settings.memberAccounts || [],
    projectLists: settings.projectLists || [],
    categories: settings.categories,
    commonEvents: settings.commonEvents,
    updatedAt: now,
  };

  const itemRows = [
    {
      id: CONFIG_ROW_ID,
      name: '__keller_config__',
      category: '__system__',
      quantity: 0,
      updated_at: now,
      payload: configPayload,
    },
    ...items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      updated_at: item.updatedAt || now,
      payload: item,
    })),
  ];

  const unsyncedTxs = transactions.filter((tx) => !tx.synced);
  const txRows = (unsyncedTxs.length > 0 ? unsyncedTxs : transactions.slice(0, 50)).map((tx) => ({
    id: tx.id,
    timestamp: tx.timestamp,
    type: tx.type,
    payload: { ...tx, synced: true },
  }));

  if (itemRows.length > 0) {
    const { error: itemErr } = await client
      .from('keller_items')
      .upsert(itemRows, { onConflict: 'id' });
    if (itemErr) throw new Error(itemErr.message);
  }

  if (txRows.length > 0) {
    const { error: txErr } = await client
      .from('keller_transactions')
      .upsert(txRows, { onConflict: 'id' });
    if (txErr) throw new Error(txErr.message);
  }

  return true;
}

export async function deleteItemFromSupabase(settings: AppSettings, itemId: string): Promise<void> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return;
  await client.from('keller_items').delete().eq('id', itemId);
}

/**
 * Erzeugt einen Einladungs-Link (inkl. Datenbank-Zugangsdaten), der als QR-Code an die Kellertür
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
  const cleanUrl = normalizeSupabaseUrl(settings.supabaseUrl);
  if (cleanUrl) params.set('dbUrl', cleanUrl);
  if (settings.supabaseAnonKey) params.set('dbKey', settings.supabaseAnonKey);

  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

