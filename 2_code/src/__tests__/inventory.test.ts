import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ITEMS,
  DEFAULT_MEMBER_ACCOUNTS,
  buildMemberUsername,
  normalizeUsernameForComparison,
} from '../data/defaultData';
import { InventoryItem } from '../types';
import { formatStockDisplay, toPrimaryUnitQuantity } from '../utils/units';
import { parseFreeTextBlock } from '../utils/textParser';
import { exportInventoryToCsv, parseInventoryCsv } from '../utils/csvHelper';

const now = new Date().toISOString();

const TEST_ITEMS: InventoryItem[] = [
  {
    id: 'test-bier-pils',
    name: 'Pilsener Bier (0,5l)',
    category: 'drinks_food',
    unit: 'Kiste',
    subUnit: 'Flasche',
    subUnitsPerUnit: 20,
    allowFractions: true,
    isReturnable: false,
    quantity: 6,
    minStock: 3,
    targetStock: 8,
    location: 'Getränkekeller Regal A',
    aliases: ['bier', 'pils', 'pilsener', 'kasten bier', 'kiste bier'],
    updatedAt: now,
  },
  {
    id: 'test-cola-mix',
    name: 'Cola / Spezi (0,5l)',
    category: 'drinks_food',
    unit: 'Kiste',
    subUnit: 'Flasche',
    subUnitsPerUnit: 20,
    allowFractions: true,
    isReturnable: false,
    quantity: 4.5,
    minStock: 2,
    targetStock: 6,
    location: 'Getränkekeller Regal A',
    aliases: ['cola', 'spezi', 'limo'],
    updatedAt: now,
  },
  {
    id: 'test-wasser-sprudel',
    name: 'Mineralwasser Sprudel (0,7l)',
    category: 'drinks_food',
    unit: 'Kiste',
    subUnit: 'Flasche',
    subUnitsPerUnit: 12,
    allowFractions: true,
    isReturnable: false,
    quantity: 5,
    minStock: 3,
    targetStock: 6,
    location: 'Getränkekeller Regal B',
    aliases: ['wasser', 'sprudel', 'mineralwasser'],
    updatedAt: now,
  },
  {
    id: 'test-gaffa-tape',
    name: 'Gaffa-Tape (Gewebeband)',
    category: 'consumables',
    unit: 'Rolle',
    allowFractions: true,
    isReturnable: false,
    quantity: 3.5,
    minStock: 2,
    targetStock: 5,
    location: 'Werkzeugschrank Fach 2',
    aliases: ['gaffa', 'panzertape', 'gewebeband', 'klebeband'],
    updatedAt: now,
  },
  {
    id: 'test-servietten',
    name: 'Servietten (250er Pack)',
    category: 'consumables',
    unit: 'Packung',
    allowFractions: true,
    isReturnable: false,
    quantity: 1,
    minStock: 2,
    targetStock: 5,
    location: 'Vorratsschrank 2',
    aliases: ['servietten', 'papierservietten'],
    updatedAt: now,
  },
  {
    id: 'test-bierzeltgarnitur',
    name: 'Bierzeltgarnitur (Tisch + 2 Bänke)',
    category: 'equipment',
    unit: 'Garnitur',
    allowFractions: false,
    isReturnable: true,
    quantity: 8,
    minStock: 8,
    targetStock: 10,
    location: 'Lagerraum Hinten',
    aliases: ['bierzeltgarnitur', 'bierzeltgarnituren', 'biertisch', 'bierbank'],
    updatedAt: now,
  },
];

describe('Standardbestand ist leer (kein Beispielinventar)', () => {
  it('startet standardmäßig ohne Beispielinventar', () => {
    expect(DEFAULT_ITEMS.length).toBe(0);
  });
});

describe('Einheiten & Gebinde-Umrechnung (Kisten / Einzelflaschen / Teilmengen)', () => {
  it('zeigt angebrochene Kisten korrekt als Kisten + Einzelflaschen an', () => {
    const cola = TEST_ITEMS.find((i) => i.id === 'test-cola-mix')!;
    const display = formatStockDisplay(cola, 4.5);
    expect(display.primaryText).toBe('4 Kisten + 10 Flaschen');
    expect(display.secondaryText).toContain('90 Flaschen');
  });

  it('rechnet Einzelflaschen korrekt in Bruchteile einer Kiste um', () => {
    const bier = TEST_ITEMS.find((i) => i.id === 'test-bier-pils')!;
    const inKisten = toPrimaryUnitQuantity(bier, 5, 'Flasche');
    expect(inKisten).toBe(0.25);
  });

  it('zeigt angebrochene Rollen mit deutschem Komma an', () => {
    const gaffa = TEST_ITEMS.find((i) => i.id === 'test-gaffa-tape')!;
    const display = formatStockDisplay(gaffa, 1.5);
    expect(display.primaryText).toBe('1,5 Rollen');
  });
});

describe('Intelligenter Offline-Freitext-Parser (Textblock einfügen)', () => {
  it('erkennt Event-Header, Kisten, Einzelflaschen, Dezimalzahlen und halbe Einheiten aus einem Textblock', () => {
    const text =
      'Fürs Sommerfest:\n3 Kisten Bier, 6 Flaschen Wasser, 1,5 Rollen Gaffa-Tape, halbe Packung Servietten, 2x Bierzeltgarnitur';

    const result = parseFreeTextBlock(text, TEST_ITEMS);
    expect(result.suggestedEvent).toBe('Sommerfest');
    expect(result.items.length).toBe(5);

    expect(result.items[0].matchedItem?.id).toBe('test-bier-pils');
    expect(result.items[0].amount).toBe(3);
    expect(result.items[0].unit).toBe('Kiste');
    expect(result.items[0].normalizedQuantity).toBe(3);

    expect(result.items[1].matchedItem?.id).toBe('test-wasser-sprudel');
    expect(result.items[1].amount).toBe(6);
    expect(result.items[1].unit).toBe('Flasche');
    expect(result.items[1].normalizedQuantity).toBe(0.5);

    expect(result.items[2].matchedItem?.id).toBe('test-gaffa-tape');
    expect(result.items[2].amount).toBe(1.5);
    expect(result.items[2].unit).toBe('Rolle');

    expect(result.items[3].matchedItem?.id).toBe('test-servietten');
    expect(result.items[3].amount).toBe(0.5);

    expect(result.items[4].matchedItem?.id).toBe('test-bierzeltgarnitur');
    expect(result.items[4].amount).toBe(2);
  });

  it('versteht zusammengesetzte Mengenangaben wie "1 Kiste und 5 Flaschen Bier"', () => {
    const text = '1 Kiste und 5 Flaschen Bier';
    const result = parseFreeTextBlock(text, TEST_ITEMS);
    expect(result.items.length).toBe(2);
    expect(result.items[0].matchedItem?.id).toBe('test-bier-pils');
    expect(result.items[0].unit).toBe('Kiste');
    expect(result.items[0].amount).toBe(1);
    expect(result.items[1].matchedItem?.id).toBe('test-bier-pils');
    expect(result.items[1].unit).toBe('Flasche');
    expect(result.items[1].amount).toBe(5);
  });
});

describe('CSV / Excel Export & Import für die Erstinventur', () => {
  it('exportiert den Bestand als CSV und importiert Änderungen sowie neue Artikel fehlerfrei', () => {
    const csv = exportInventoryToCsv(TEST_ITEMS);
    expect(csv).toContain('Pilsener Bier (0,5l)');
    expect(csv).toContain('Gaffa-Tape (Gewebeband)');

    const customCsv = [
      'Name;Kategorie;Bestand (Haupteinheit);Haupteinheit;Untereinheit;Faktor Untereinheit;Mindestbestand;Sollbestand;Lagerort;Leihgerät (Rückgabepflicht);Teilmengen erlaubt;Suchbegriffe / Synonyme',
      'Pilsener Bier (0,5l);Getränke & Lebensmittel;10;Kiste;Flasche;20;3;10;Getränkekeller Regal A;Nein;Ja;bier, pils',
      'Pavillon Faltzelt 3x3m;Werkzeug, Technik & Inventar;2;Stück;;;2;2;Lagerraum Hinten;Ja;Nein;pavillon, zelt, faltzelt',
    ].join('\r\n');

    const imported = parseInventoryCsv(customCsv, TEST_ITEMS);
    expect(imported.updatedCount).toBe(1);
    expect(imported.addedCount).toBe(1);

    const updatedBier = imported.items.find((i) => i.id === 'test-bier-pils')!;
    expect(updatedBier.quantity).toBe(10);

    const addedPavillon = imported.items.find((i) => i.name.includes('Pavillon'))!;
    expect(addedPavillon).toBeDefined();
    expect(addedPavillon.isReturnable).toBe(true);
    expect(addedPavillon.quantity).toBe(2);
  });

  it('legt neue eigene Kategorien beim CSV-Import automatisch an', () => {
    const customCatCsv = [
      'Name;Kategorie;Bestand (Haupteinheit);Haupteinheit;Untereinheit;Faktor Untereinheit;Mindestbestand;Sollbestand;Lagerort;Leihgerät (Rückgabepflicht);Teilmengen erlaubt;Suchbegriffe / Synonyme',
      'Lichterkette 20m;Deko & Partybedarf;4;Stück;;;2;4;Dekokiste 1;Ja;Nein;lichterkette, deko, beleuchtung',
    ].join('\r\n');

    const imported = parseInventoryCsv(customCatCsv, TEST_ITEMS);
    expect(imported.categories.some((c) => c.label === 'Deko & Partybedarf')).toBe(true);
    const lichterkette = imported.items.find((i) => i.name.includes('Lichterkette'))!;
    expect(lichterkette.category).toBe('cat-deko-partybedarf');
  });
});

describe('Mitglieder-Login & Benutzernamen-Format (@schuelerunion.at)', () => {
  it('erzeugt vorname.nachname@schuelerunion.at inkl. Bindestrich-Auflösung und Doppel-Nachnamen', () => {
    expect(buildMemberUsername('Elias Mantler')).toBe('elias.mantler@schuelerunion.at');
    expect(buildMemberUsername('Celil-Kaan Beler')).toBe('celil.kaan.beler@schuelerunion.at');
    expect(buildMemberUsername('Sophia-Maria Thoma')).toBe('sophia.maria.thoma@schuelerunion.at');
    expect(buildMemberUsername('Simon Märker')).toBe('simon.maerker@schuelerunion.at');
    expect(buildMemberUsername('Max Müller-Lüdenscheidt')).toBe(
      'max.mueller.luedenscheidt@schuelerunion.at'
    );
  });

  it('normalisiert Umlaute beim Login-Vergleich flexibel', () => {
    expect(normalizeUsernameForComparison('simon.märker@schuelerunion.at')).toBe(
      'simon.maerker@schuelerunion.at'
    );
  });

  it('enthält alle 28 berechtigten Mitglieder mit individuellem Zufallspasswort', () => {
    expect(DEFAULT_MEMBER_ACCOUNTS.length).toBe(28);
    for (const acc of DEFAULT_MEMBER_ACCOUNTS) {
      expect(acc.username.endsWith('@schuelerunion.at')).toBe(true);
      expect(acc.password.length).toBeGreaterThanOrEqual(8);
    }
  });
});

