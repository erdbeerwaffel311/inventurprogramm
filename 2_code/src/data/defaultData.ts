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
 * (Bei Doppelnamen / Bindestrich im Vor- oder Nachnamen:
 *  vorname1-vorname2.nachname@schuelerunion.at bzw. vorname.nachname1-nachname2@schuelerunion.at)
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

  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);

  if (words.length === 0) {
    return 'mitglied@schuelerunion.at';
  }
  if (words.length === 1) {
    return `${words[0]}@schuelerunion.at`;
  }

  const lastName = words[words.length - 1];
  const firstNames = words.slice(0, -1).join('-');
  return `${firstNames}.${lastName}@schuelerunion.at`;
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
 * Erzeugt ein gut lesbares zufälliges Passwort für neu angelegte Personen.
 */
export function generateRandomMemberPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  for (let i = 0; i < 2; i++) {
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SU-${part1}-${part2}`;
}

const INITIAL_PASSWORDS_BY_NAME: Record<string, string> = {
  'Simon Märker': 'SU-K7m4-9X',
  'Aaron Hammerer': 'SU-P3n8-2V',
  'Amina Amann': 'SU-R9t2-6B',
  'Angelina Fitsch': 'SU-W4q7-5N',
  'Anton Loss': 'SU-L8k3-4M',
  'Celil-Kaan Beler': 'SU-H5v9-7C',
  'Chiara Forcher': 'SU-D2j6-8F',
  'Elias Mantler': 'SU-Z6x3-9T',
  'Emil Schmalfuss': 'SU-B9w4-2G',
  'Fabian Stauss': 'SU-M3p7-6R',
  'Hannah Grabher': 'SU-T8c5-3K',
  'Ian Hörburger': 'SU-V4n9-5L',
  'Ismail Öztoprak': 'SU-Q7b2-8H',
  'Josefine Müller': 'SU-F6m8-4P',
  'Jeramis Dengel': 'SU-N2r5-9W',
  'Juliana Moosbrugger': 'SU-X5t3-7J',
  'Kaspar Riedmann': 'SU-C8g4-2D',
  'Katharina Nigg': 'SU-J3k9-6S',
  'Leon Schwendinger': 'SU-G7p2-5V',
  'Elisabeth Himmer': 'SU-S4v8-3Q',
  'Liljana Walser': 'SU-Y9d6-4Z',
  'Marian Kolanovic': 'SU-K2h7-8B',
  'Paulus Cukrowicz': 'SU-W6f3-5M',
  'Rania Moosbrugger': 'SU-P8q4-7N',
  'Nick Klein': 'SU-R3z9-2T',
  'Sophia-Maria Thoma': 'SU-L5x7-6K',
  'Emma Holzer': 'SU-H4c8-3F',
  'Elias Mathis': 'SU-T9n2-5G',
};

export const DEFAULT_MEMBER_ACCOUNTS: MemberAccount[] = DEFAULT_ALLOWED_MEMBERS.map((name) => ({
  name,
  username: buildMemberUsername(name),
  password: INITIAL_PASSWORDS_BY_NAME[name] || 'SU-K7m4-9X',
}));

/**
 * Stellt sicher, dass für jeden Namen in `allowedMembers` ein vollständiger `MemberAccount`
 * (mit Benutzername nach Schema vorname1-vorname2.nachname@schuelerunion.at und Passwort) existiert.
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
          username: buildMemberUsername(acc.name),
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
        username: buildMemberUsername(cleanName),
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
