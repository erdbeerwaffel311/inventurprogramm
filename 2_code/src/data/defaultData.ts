import {
  CategoryInfo,
  InventoryItem,
  AppSettings,
  InventoryTransaction,
  MemberAccount,
} from '../types';

export const CATEGORIES: CategoryInfo[] = [
  {
    id: 'drinks_food',
    label: 'Getränke & Lebensmittel',
    shortLabel: 'Getränke & Essen',
    description: 'Kisten, Einzelflaschen, Kaffee, Snacks',
    color: 'amber',
  },
  {
    id: 'consumables',
    label: 'Verbrauchsmaterial',
    shortLabel: 'Verbrauch',
    description: 'Müllsäcke, Klebeband, Servietten, Reinigungsmittel',
    color: 'emerald',
  },
  {
    id: 'equipment',
    label: 'Werkzeug, Technik & Inventar',
    shortLabel: 'Werkzeug & Technik',
    description: 'Leihgeräte, Bierzeltgarnituren, Kabel, Technik (wird zurückgebracht)',
    color: 'sky',
    defaultReturnable: true,
  },
];

export const DEFAULT_ALLOWED_MEMBERS: string[] = [
  'Simon Märker',
  'Aaron Hammerer',
  'Amina Amann',
  'Angelina Fitsch',
  'Anton Loss',
  'Celil-Kaan Beler',
  'Chiara Forcher',
  'Elias Mantler',
  'Emil Schmalfuss',
  'Fabian Stauss',
  'Hannah Grabher',
  'Ian Hörburger',
  'Ismail Öztoprak',
  'Josefine Müller',
  'Jeramis Dengel',
  'Juliana Moosbrugger',
  'Kaspar Riedmann',
  'Katharina Nigg',
  'Leon Schwendinger',
  'Elisabeth Himmer',
  'Liljana Walser',
  'Marian Kolanovic',
  'Paulus Cukrowicz',
  'Rania Moosbrugger',
  'Nick Klein',
  'Sophia-Maria Thoma',
  'Emma Holzer',
  'Elias Mathis',
];

/**
 * Erzeugt aus einem Vor- und Nachnamen den Benutzernamen nach dem Schema:
 * vorname.nachname@schuelerunion.at
 * (Bei Bindestrich-Namen oder Doppelnamen: vorname1.vorname2.nachname@schuelerunion.at)
 */
export function buildMemberUsername(fullName: string): string {
  const cleaned = fullName
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const parts = cleaned
    .split(/[\s.-]+/)
    .map((p) => p.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  return `${parts.join('.')}@schuelerunion.at`;
}

/**
 * Normalisiert einen eingegebenen Benutzernamen für den Login-Vergleich
 * (damit z. B. sowohl "simon.maerker@schuelerunion.at" als auch "simon.märker@schuelerunion.at" akzeptiert wird).
 */
export function normalizeUsernameForComparison(rawUsername: string): string {
  return rawUsername
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Erzeugt ein gut lesbares zufälliges 8-stelliges Passwort für neu angelegte Personen.
 */
export function generateRandomMemberPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let result = 'SU-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const INITIAL_PASSWORDS_BY_NAME: Record<string, string> = {
  'Simon Märker': 'SU-8kM4p2',
  'Aaron Hammerer': 'SU-3vR9x7',
  'Amina Amann': 'SU-6tN2q5',
  'Angelina Fitsch': 'SU-9wL5b8',
  'Anton Loss': 'SU-4hJ7d3',
  'Celil-Kaan Beler': 'SU-7pF3m9',
  'Chiara Forcher': 'SU-2cW8k4',
  'Elias Mantler': 'SU-5zY6n2',
  'Emil Schmalfuss': 'SU-9bQ4v7',
  'Fabian Stauss': 'SU-3mX8r5',
  'Hannah Grabher': 'SU-6dK2w9',
  'Ian Hörburger': 'SU-8nP5t4',
  'Ismail Öztoprak': 'SU-4rG9j6',
  'Josefine Müller': 'SU-7vH3q8',
  'Jeramis Dengel': 'SU-2kT6m5',
  'Juliana Moosbrugger': 'SU-5wB9x3',
  'Kaspar Riedmann': 'SU-8jL4n7',
  'Katharina Nigg': 'SU-3qC7p2',
  'Leon Schwendinger': 'SU-6fR5v9',
  'Elisabeth Himmer': 'SU-9mD2k6',
  'Liljana Walser': 'SU-4xN8t3',
  'Marian Kolanovic': 'SU-7gP6w4',
  'Paulus Cukrowicz': 'SU-2vJ9r8',
  'Rania Moosbrugger': 'SU-5tK3m7',
  'Nick Klein': 'SU-8bW4q6',
  'Sophia-Maria Thoma': 'SU-3nL7x2',
  'Emma Holzer': 'SU-6pG5d9',
  'Elias Mathis': 'SU-9kR4v3',
};

export const DEFAULT_MEMBER_ACCOUNTS: MemberAccount[] = DEFAULT_ALLOWED_MEMBERS.map((name) => ({
  name,
  username: buildMemberUsername(name),
  password: INITIAL_PASSWORDS_BY_NAME[name] || 'SU-4kM8p2',
}));

/**
 * Stellt sicher, dass für jeden Namen in `allowedMembers` ein vollständiger `MemberAccount`
 * (mit Benutzername und Passwort) existiert.
 */
export function reconcileMemberAccounts(
  allowedMembers: string[],
  existingAccounts?: MemberAccount[]
): MemberAccount[] {
  const names =
    Array.isArray(allowedMembers) && allowedMembers.length > 0
      ? allowedMembers
      : DEFAULT_ALLOWED_MEMBERS;
  const accountMap = new Map<string, MemberAccount>();

  for (const def of DEFAULT_MEMBER_ACCOUNTS) {
    accountMap.set(def.name.trim().toLowerCase(), def);
  }
  if (Array.isArray(existingAccounts)) {
    for (const acc of existingAccounts) {
      if (acc && acc.name) {
        accountMap.set(acc.name.trim().toLowerCase(), {
          name: acc.name.trim(),
          username: acc.username?.trim() || buildMemberUsername(acc.name),
          password: acc.password?.trim() || generateRandomMemberPassword(),
        });
      }
    }
  }

  return names.map((rawName) => {
    const cleanName = rawName.trim();
    const existing = accountMap.get(cleanName.toLowerCase());
    if (existing) {
      return {
        name: cleanName,
        username: existing.username || buildMemberUsername(cleanName),
        password: existing.password || INITIAL_PASSWORDS_BY_NAME[cleanName] || generateRandomMemberPassword(),
      };
    }
    return {
      name: cleanName,
      username: buildMemberUsername(cleanName),
      password: INITIAL_PASSWORDS_BY_NAME[cleanName] || generateRandomMemberPassword(),
    };
  });
}

export const DEFAULT_SETTINGS: AppSettings = {
  clubName: 'Vereinskeller',
  adminPassword: 'admin',
  adminEmail: '',
  allowedMembers: DEFAULT_ALLOWED_MEMBERS,
  memberAccounts: DEFAULT_MEMBER_ACCOUNTS,
  projectLists: [],
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://zdduvvluqairhnbdbunk.supabase.co',
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_CEjKQudAlYxYtTvykEwDxw_E4KvyUhC',
  aiProvider: 'gemini',
  aiApiKey: '',
  commonEvents: ['Sommerfest', 'Vereinsabend', 'Arbeitseinsatz', 'Vorstandssitzung', 'Turnier / Spieltag'],
  categories: CATEGORIES,
};

// Kein automatisches Beispielinventar – Start mit leerem Kellerbestand
export const DEFAULT_ITEMS: InventoryItem[] = [];

export const DEFAULT_TRANSACTIONS: InventoryTransaction[] = [];

// IDs des früheren Beispielinventars (zum automatischen Bereinigen alter Browser-Caches)
export const LEGACY_DEMO_ITEM_IDS = new Set([
  'item-bier-pils',
  'item-cola-mix',
  'item-wasser-sprudel',
  'item-apfelschorle',
  'item-kaffee',
  'item-gaffa-tape',
  'item-muellsaecke',
  'item-servietten',
  'item-spuelmittel',
  'item-kuechenrolle',
  'item-bierzeltgarnitur',
  'item-kabeltrommel',
  'item-akkuschrauber',
  'item-musikbox',
  'item-stehtisch',
]);

export const LEGACY_DEMO_TX_IDS = new Set(['tx-demo-1']);
