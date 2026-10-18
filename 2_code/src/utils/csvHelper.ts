import { CategoryId, CategoryInfo, InventoryItem, InventoryTransaction } from '../types';
import { CATEGORIES } from '../data/defaultData';
import { formatGermanNumber, formatStockDisplay, roundStock } from './units';

function escapeCsvCell(val: string | number | boolean | undefined): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function slugifyCategoryId(label: string): string {
  return (
    'cat-' +
    label
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

/**
 * Exportiert den gesamten aktuellen Bestand als Excel-kompatible CSV-Datei (UTF-8 mit BOM + Semikolon)
 */
export function exportInventoryToCsv(
  items: InventoryItem[],
  categories: CategoryInfo[] = CATEGORIES
): string {
  const headers = [
    'Name',
    'Kategorie',
    'Bestand (Haupteinheit)',
    'Haupteinheit',
    'Lesbarer Bestand',
    'Untereinheit',
    'Faktor Untereinheit',
    'Mindestbestand',
    'Sollbestand',
    'Lagerort',
    'Leihgerät (Rückgabepflicht)',
    'Teilmengen erlaubt',
    'Suchbegriffe / Synonyme',
  ];

  const rows = items.map((item) => {
    const display = formatStockDisplay(item);
    const catObj = categories.find((c) => c.id === item.category);
    const categoryLabel = catObj?.label || item.categoryLabel || item.category;

    return [
      item.name,
      categoryLabel,
      formatGermanNumber(item.quantity),
      item.unit,
      display.primaryText,
      item.subUnit || '',
      item.subUnitsPerUnit || '',
      formatGermanNumber(item.minStock),
      item.targetStock !== undefined ? formatGermanNumber(item.targetStock) : '',
      item.location || '',
      item.isReturnable ? 'Ja' : 'Nein',
      item.allowFractions ? 'Ja' : 'Nein',
      item.aliases.join(', '),
    ].map(escapeCsvCell);
  });

  return '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
}

/**
 * Erstellt eine CSV-Mustervorlage für die Erstinventur am PC
 */
export function generateCsvTemplate(): string {
  const headers = [
    'Name',
    'Kategorie',
    'Bestand (Haupteinheit)',
    'Haupteinheit',
    'Untereinheit',
    'Faktor Untereinheit',
    'Mindestbestand',
    'Sollbestand',
    'Lagerort',
    'Leihgerät (Rückgabepflicht)',
    'Teilmengen erlaubt',
    'Suchbegriffe / Synonyme',
  ];

  const sampleRows = [
    [
      'Pilsener Bier (0,5l)',
      'Getränke & Lebensmittel',
      '6',
      'Kiste',
      'Flasche',
      '20',
      '3',
      '8',
      'Getränkekeller Regal A',
      'Nein',
      'Ja',
      'bier, pils, kasten bier',
    ],
    [
      'Gaffa-Tape (Gewebeband)',
      'Verbrauchsmaterial',
      '3,5',
      'Rolle',
      '',
      '',
      '2',
      '5',
      'Werkzeugschrank Fach 2',
      'Nein',
      'Ja',
      'gaffa, panzertape, klebeband',
    ],
    [
      'Bierzeltgarnitur (Tisch + 2 Bänke)',
      'Werkzeug, Technik & Inventar',
      '8',
      'Garnitur',
      '',
      '',
      '8',
      '8',
      'Lagerraum Hinten',
      'Ja',
      'Nein',
      'bierzeltgarnitur, biertisch, bierbank',
    ],
  ];

  return '\uFEFF' + [headers.join(';'), ...sampleRows.map((r) => r.map(escapeCsvCell).join(';'))].join('\r\n');
}

/**
 * Exportiert das Buchungs-Logbuch als CSV für Excel
 */
export function exportTransactionsToCsv(transactions: InventoryTransaction[]): string {
  const headers = ['Datum & Uhrzeit', 'Buchungsart', 'Person', 'Event / Zweck', 'Positionen', 'Notiz'];
  const typeMap: Record<string, string> = {
    withdraw: 'Entnahme',
    return: 'Rückgabe',
    restock: 'Einkauf / Befüllung',
    initial_inventory: 'Inventur / Korrektur',
  };

  const rows = transactions.map((tx) => {
    const dateStr = new Date(tx.timestamp).toLocaleString('de-DE');
    const itemsSummary = tx.items
      .map((i) => `${i.itemName}: ${formatGermanNumber(i.enteredAmount)} ${i.enteredUnit}`)
      .join(' | ');

    return [
      dateStr,
      typeMap[tx.type] || tx.type,
      tx.personName || '-',
      tx.eventName || '-',
      itemsSummary,
      tx.note || '',
    ].map(escapeCsvCell);
  });

  return '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Liest eine CSV-Datei ein und aktualisiert bestehende Artikel oder legt neue (inkl. neuer Kategorien) an.
 */
export function parseInventoryCsv(
  csvText: string,
  existingItems: InventoryItem[],
  existingCategories: CategoryInfo[] = CATEGORIES
): {
  items: InventoryItem[];
  categories: CategoryInfo[];
  addedCount: number;
  updatedCount: number;
} {
  const cleanText = csvText.replace(/^\uFEFF/, '').trim();
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      items: existingItems,
      categories: existingCategories,
      addedCount: 0,
      updatedCount: 0,
    };
  }

  const headerLine = lines[0];
  const delimiter = headerLine.includes(';') ? ';' : ',';
  const headers = splitCsvLine(headerLine, delimiter).map((h) => h.toLowerCase());

  const idxName = headers.findIndex((h) => h.includes('name') || h.includes('artikel') || h.includes('bezeichnung'));
  const idxCategory = headers.findIndex((h) => h.includes('kategorie') || h.includes('bereich'));
  const idxQty = headers.findIndex((h) => h.includes('bestand') && !h.includes('mindest') && !h.includes('soll') && !h.includes('lesbar'));
  const idxUnit = headers.findIndex((h) => h.includes('haupteinheit') || h === 'einheit');
  const idxSubUnit = headers.findIndex((h) => h.includes('untereinheit'));
  const idxSubFactor = headers.findIndex((h) => h.includes('faktor'));
  const idxMinStock = headers.findIndex((h) => h.includes('mindest'));
  const idxTargetStock = headers.findIndex((h) => h.includes('soll') || h.includes('ziel'));
  const idxLocation = headers.findIndex((h) => h.includes('lagerort') || h.includes('ort') || h.includes('regal'));
  const idxReturnable = headers.findIndex((h) => h.includes('leih') || h.includes('rückgabe'));
  const idxFractions = headers.findIndex((h) => h.includes('teilmenge') || h.includes('angebrochen'));
  const idxAliases = headers.findIndex((h) => h.includes('suchbegriff') || h.includes('synonym') || h.includes('alias'));

  const updatedList = [...existingItems];
  const updatedCategories = [...existingCategories];
  let addedCount = 0;
  let updatedCount = 0;
  const now = new Date().toISOString();

  function resolveOrCreateCategory(rawCatText: string): { id: CategoryId; label: string } {
    const trimmed = rawCatText.trim();
    if (!trimmed) {
      return { id: 'consumables', label: 'Verbrauchsmaterial' };
    }

    const lower = trimmed.toLowerCase();
    // 1. Exakter Treffer auf bestehende Kategorie (Name, Kurzname oder ID)
    const found = updatedCategories.find(
      (c) =>
        c.id.toLowerCase() === lower ||
        c.label.toLowerCase() === lower ||
        c.shortLabel.toLowerCase() === lower
    );
    if (found) {
      return { id: found.id, label: found.label };
    }

    // 2. Standard-Kategorien über Schlüsselwörter erkennen
    if (lower.includes('getränk') || lower.includes('lebensmittel') || lower === 'drinks_food') {
      return { id: 'drinks_food', label: 'Getränke & Lebensmittel' };
    }
    if (lower.includes('verbrauch') || lower === 'consumables') {
      return { id: 'consumables', label: 'Verbrauchsmaterial' };
    }
    if (lower.includes('werkzeug') || lower.includes('technik') || lower === 'equipment') {
      return { id: 'equipment', label: 'Werkzeug, Technik & Inventar' };
    }

    // 3. Neue eigene Kategorie automatisch anlegen!
    const newId = slugifyCategoryId(trimmed);
    const shortLabel = trimmed.length > 18 ? trimmed.slice(0, 16) + '…' : trimmed;
    const newCat: CategoryInfo = {
      id: newId,
      label: trimmed,
      shortLabel,
      description: 'Eigene Vereins-Kategorie',
      color: 'violet',
    };
    updatedCategories.push(newCat);
    return { id: newCat.id, label: newCat.label };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    const name = (idxName >= 0 ? cols[idxName] : cols[0])?.trim();
    if (!name) continue;

    const categoryText = idxCategory >= 0 ? cols[idxCategory] || '' : '';
    const { id: category, label: categoryLabel } = resolveOrCreateCategory(categoryText);

    const rawQty = (idxQty >= 0 ? cols[idxQty] : cols[2])?.replace(',', '.') || '0';
    const quantity = roundStock(Math.max(0, parseFloat(rawQty) || 0));

    const unit = (idxUnit >= 0 ? cols[idxUnit] : cols[3])?.trim() || 'Stück';
    const subUnit = idxSubUnit >= 0 ? cols[idxSubUnit]?.trim() || undefined : undefined;
    const rawSubFactor = idxSubFactor >= 0 ? parseInt(cols[idxSubFactor] || '', 10) : NaN;
    const subUnitsPerUnit = !isNaN(rawSubFactor) && rawSubFactor > 1 ? rawSubFactor : undefined;

    const rawMin = idxMinStock >= 0 ? cols[idxMinStock]?.replace(',', '.') || '0' : '0';
    const minStock = roundStock(Math.max(0, parseFloat(rawMin) || 0));

    const rawTarget = idxTargetStock >= 0 ? cols[idxTargetStock]?.replace(',', '.') || '' : '';
    const targetStock = rawTarget ? roundStock(Math.max(0, parseFloat(rawTarget) || 0)) : undefined;

    const location = idxLocation >= 0 ? cols[idxLocation]?.trim() || undefined : undefined;

    const isReturnable =
      idxReturnable >= 0
        ? ['ja', 'true', '1', 'yes'].includes((cols[idxReturnable] || '').toLowerCase())
        : category === 'equipment';

    const allowFractions =
      idxFractions >= 0
        ? ['ja', 'true', '1', 'yes'].includes((cols[idxFractions] || '').toLowerCase())
        : category !== 'equipment';

    const aliases =
      idxAliases >= 0 && cols[idxAliases]
        ? cols[idxAliases]
            .split(',')
            .map((a) => a.trim().toLowerCase())
            .filter(Boolean)
        : [name.toLowerCase().split(' ')[0]];

    const existingIdx = updatedList.findIndex(
      (item) => item.name.toLowerCase() === name.toLowerCase()
    );

    if (existingIdx >= 0) {
      updatedList[existingIdx] = {
        ...updatedList[existingIdx],
        category,
        categoryLabel,
        quantity,
        unit,
        subUnit,
        subUnitsPerUnit,
        minStock,
        targetStock,
        location: location ?? updatedList[existingIdx].location,
        isReturnable,
        allowFractions,
        aliases: aliases.length > 0 ? aliases : updatedList[existingIdx].aliases,
        updatedAt: now,
      };
      updatedCount++;
    } else {
      updatedList.push({
        id: `item-${Date.now()}-${i}`,
        name,
        category,
        categoryLabel,
        unit,
        subUnit,
        subUnitsPerUnit,
        allowFractions,
        isReturnable,
        quantity,
        minStock,
        targetStock,
        location,
        aliases,
        updatedAt: now,
      });
      addedCount++;
    }
  }

  return {
    items: updatedList,
    categories: updatedCategories,
    addedCount,
    updatedCount,
  };
}

export function downloadTextFile(content: string, filename: string, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
