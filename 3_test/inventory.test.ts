import { describe, it, expect } from 'vitest';
import { DEFAULT_ITEMS } from '../data/defaultData';
import { formatStockDisplay, toPrimaryUnitQuantity } from '../utils/units';
import { parseFreeTextBlock } from '../utils/textParser';
import { exportInventoryToCsv, parseInventoryCsv } from '../utils/csvHelper';

describe('Einheiten & Gebinde-Umrechnung (Kisten / Einzelflaschen / Teilmengen)', () => {
  it('zeigt angebrochene Kisten korrekt als Kisten + Einzelflaschen an', () => {
    const cola = DEFAULT_ITEMS.find((i) => i.id === 'item-cola-mix')!;
    const display = formatStockDisplay(cola, 4.5); // 1 Kiste = 20 Flaschen
    expect(display.primaryText).toBe('4 Kisten + 10 Flaschen');
    expect(display.secondaryText).toContain('90 Flaschen');
  });

  it('rechnet Einzelflaschen korrekt in Bruchteile einer Kiste um', () => {
    const bier = DEFAULT_ITEMS.find((i) => i.id === 'item-bier-pils')!;
    const inKisten = toPrimaryUnitQuantity(bier, 5, 'Flasche');
    expect(inKisten).toBe(0.25); // 5 von 20 Flaschen = 0,25 Kisten
  });

  it('zeigt angebrochene Rollen mit deutschem Komma an', () => {
    const gaffa = DEFAULT_ITEMS.find((i) => i.id === 'item-gaffa-tape')!;
    const display = formatStockDisplay(gaffa, 1.5);
    expect(display.primaryText).toBe('1,5 Rollen');
  });
});

describe('Intelligenter Offline-Freitext-Parser (Textblock einfügen)', () => {
  it('erkennt Event-Header, Kisten, Einzelflaschen, Dezimalzahlen und halbe Einheiten aus einem Textblock', () => {
    const text =
      'Fürs Sommerfest:\n3 Kisten Bier, 6 Flaschen Wasser, 1,5 Rollen Gaffa-Tape, halbe Packung Servietten, 2x Bierzeltgarnitur';

    const result = parseFreeTextBlock(text, DEFAULT_ITEMS);
    expect(result.suggestedEvent).toBe('Sommerfest');
    expect(result.items.length).toBe(5);

    // 1. 3 Kisten Bier
    expect(result.items[0].matchedItem?.id).toBe('item-bier-pils');
    expect(result.items[0].amount).toBe(3);
    expect(result.items[0].unit).toBe('Kiste');
    expect(result.items[0].normalizedQuantity).toBe(3);

    // 2. 6 Flaschen Wasser (1 Kiste Wasser = 12 Flaschen -> 0.5 Kisten)
    expect(result.items[1].matchedItem?.id).toBe('item-wasser-sprudel');
    expect(result.items[1].amount).toBe(6);
    expect(result.items[1].unit).toBe('Flasche');
    expect(result.items[1].normalizedQuantity).toBe(0.5);

    // 3. 1,5 Rollen Gaffa-Tape
    expect(result.items[2].matchedItem?.id).toBe('item-gaffa-tape');
    expect(result.items[2].amount).toBe(1.5);
    expect(result.items[2].unit).toBe('Rolle');

    // 4. halbe Packung Servietten
    expect(result.items[3].matchedItem?.id).toBe('item-servietten');
    expect(result.items[3].amount).toBe(0.5);

    // 5. 2x Bierzeltgarnitur
    expect(result.items[4].matchedItem?.id).toBe('item-bierzeltgarnitur');
    expect(result.items[4].amount).toBe(2);
  });

  it('versteht zusammengesetzte Mengenangaben wie "1 Kiste und 5 Flaschen Bier"', () => {
    const text = '1 Kiste und 5 Flaschen Bier';
    const result = parseFreeTextBlock(text, DEFAULT_ITEMS);
    expect(result.items.length).toBe(2);
    expect(result.items[0].matchedItem?.id).toBe('item-bier-pils');
    expect(result.items[0].unit).toBe('Kiste');
    expect(result.items[0].amount).toBe(1);
    expect(result.items[1].matchedItem?.id).toBe('item-bier-pils');
    expect(result.items[1].unit).toBe('Flasche');
    expect(result.items[1].amount).toBe(5);
  });
});

describe('CSV / Excel Export & Import für die Erstinventur', () => {
  it('exportiert den Bestand als CSV und importiert Änderungen sowie neue Artikel fehlerfrei', () => {
    const csv = exportInventoryToCsv(DEFAULT_ITEMS);
    expect(csv).toContain('Pilsener Bier (0,5l)');
    expect(csv).toContain('Gaffa-Tape (Gewebeband)');

    const customCsv = [
      'Name;Kategorie;Bestand (Haupteinheit);Haupteinheit;Untereinheit;Faktor Untereinheit;Mindestbestand;Sollbestand;Lagerort;Leihgerät (Rückgabepflicht);Teilmengen erlaubt;Suchbegriffe / Synonyme',
      'Pilsener Bier (0,5l);Getränke & Lebensmittel;10;Kiste;Flasche;20;3;10;Getränkekeller Regal A;Nein;Ja;bier, pils',
      'Pavillon Faltzelt 3x3m;Werkzeug, Technik & Inventar;2;Stück;;;2;2;Lagerraum Hinten;Ja;Nein;pavillon, zelt, faltzelt',
    ].join('\r\n');

    const imported = parseInventoryCsv(customCsv, DEFAULT_ITEMS);
    expect(imported.updatedCount).toBe(1);
    expect(imported.addedCount).toBe(1);

    const updatedBier = imported.items.find((i) => i.id === 'item-bier-pils')!;
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

    const imported = parseInventoryCsv(customCatCsv, DEFAULT_ITEMS);
    expect(imported.categories.some((c) => c.label === 'Deko & Partybedarf')).toBe(true);
    const lichterkette = imported.items.find((i) => i.name.includes('Lichterkette'))!;
    expect(lichterkette.category).toBe('cat-deko-partybedarf');
  });
});
