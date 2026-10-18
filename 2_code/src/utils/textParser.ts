import { AppSettings, InventoryItem, ParsedTextItem } from '../types';
import { roundStock, toPrimaryUnitQuantity } from './units';

export interface ParseBlockResult {
  items: ParsedTextItem[];
  suggestedEvent?: string;
  suggestedPerson?: string;
  usedAI: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  eins: 1,
  zwei: 2,
  zwo: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12,
  fünfzehn: 15,
  zwanzig: 20,
  halbe: 0.5,
  halber: 0.5,
  halbes: 0.5,
  halben: 0.5,
  einhalb: 0.5,
  anderthalb: 1.5,
  eineinhalb: 1.5,
};

const UNIT_ALIASES: Record<string, string> = {
  kiste: 'Kiste',
  kisten: 'Kiste',
  kasten: 'Kiste',
  kästen: 'Kiste',
  kaesten: 'Kiste',
  träger: 'Kiste',
  flasche: 'Flasche',
  flaschen: 'Flasche',
  fl: 'Flasche',
  pulle: 'Flasche',
  pullen: 'Flasche',
  rolle: 'Rolle',
  rollen: 'Rolle',
  packung: 'Packung',
  packungen: 'Packung',
  pack: 'Packung',
  pkg: 'Packung',
  pck: 'Packung',
  paket: 'Packung',
  pakete: 'Packung',
  sack: 'Sack',
  säcke: 'Sack',
  saecke: 'Sack',
  beutel: 'Sack',
  garnitur: 'Garnitur',
  garnituren: 'Garnitur',
  set: 'Set',
  sets: 'Set',
  koffer: 'Set',
  stück: 'Stück',
  stueck: 'Stück',
  stk: 'Stück',
  st: 'Stück',
};

function normalizeSearchToken(str: string): string {
  return str
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBestMatchingItem(
  query: string,
  catalog: InventoryItem[]
): { item?: InventoryItem; confidence: 'high' | 'medium' | 'low' } {
  const normQuery = normalizeSearchToken(query);
  if (!normQuery || normQuery.length < 2) {
    return { confidence: 'low' };
  }

  const queryWords = normQuery.split(' ').filter((w) => w.length >= 2);
  let bestItem: InventoryItem | undefined;
  let bestScore = 0;

  for (const item of catalog) {
    const normName = normalizeSearchToken(item.name);
    const normAliases = item.aliases.map(normalizeSearchToken);

    let score = 0;

    // Exakter Treffer auf Alias oder Name
    if (normName === normQuery || normAliases.includes(normQuery)) {
      score = 100;
    } else if (normName.includes(normQuery) || normQuery.includes(normName)) {
      score = 85;
    }

    for (const alias of normAliases) {
      if (!alias) continue;
      if (normQuery === alias) {
        score = Math.max(score, 98);
      } else if (normQuery.includes(alias) || alias.includes(normQuery)) {
        const ratio = Math.min(normQuery.length, alias.length) / Math.max(normQuery.length, alias.length);
        score = Math.max(score, 75 + ratio * 20);
      }
    }

    // Wort-Überlappung prüfen
    const itemWords = new Set(
      [normName, ...normAliases]
        .join(' ')
        .split(' ')
        .filter((w) => w.length >= 2)
    );

    let matchedWords = 0;
    for (const qw of queryWords) {
      for (const iw of itemWords) {
        if (iw === qw) {
          matchedWords += 1.2;
          break;
        } else if (iw.length >= 4 && qw.length >= 4 && (iw.startsWith(qw) || qw.startsWith(iw))) {
          matchedWords += 0.9;
          break;
        }
      }
    }

    if (queryWords.length > 0 && matchedWords > 0) {
      const wordScore = (matchedWords / queryWords.length) * 80;
      score = Math.max(score, wordScore);
    }

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (bestScore >= 75 && bestItem) {
    return { item: bestItem, confidence: 'high' };
  }
  if (bestScore >= 45 && bestItem) {
    return { item: bestItem, confidence: 'medium' };
  }
  return { confidence: 'low' };
}

function parseSingleSegment(rawSegment: string, catalog: InventoryItem[]): ParsedTextItem | null {
  let cleaned = rawSegment
    .replace(/^[\s\-*•+>]+/, '') // Aufzählungszeichen (-, *, •) am Anfang entfernen
    .replace(/^\d+\)\s+/, '') // Nummerierte Listen wie "1) " entfernen, aber Mengenangaben wie "3 Kisten" behalten
    .trim();

  if (!cleaned) return null;

  // Dezimalkomma in Dezimalpunkt umwandeln: "1,5" -> "1.5"
  cleaned = cleaned.replace(/(\d+),(\d+)/g, '$1.$2');

  // Unicode-Brüche ersetzen
  cleaned = cleaned
    .replace(/(\d+)\s*½/g, '$1.5')
    .replace(/½/g, '0.5')
    .replace(/¼/g, '0.25')
    .replace(/¾/g, '0.75')
    .replace(/(\d+)\s+1\/2\b/g, '$1.5')
    .replace(/\b1\/2\b/g, '0.5')
    .replace(/\b1\/4\b/g, '0.25')
    .replace(/\b3\/4\b/g, '0.75');

  let amount = 1;
  let detectedUnit = '';
  let remainder = cleaned;

  // 1. Prüfe Zahl am Anfang (z. B. "3 Kisten Bier", "1.5 Rollen Gaffa", "2x Bierzeltgarnitur")
  const leadingNumberMatch = remainder.match(/^(\d+(?:\.\d+)?)\s*(?:x|mal|\*)?\s*(.*)$/i);
  if (leadingNumberMatch) {
    amount = parseFloat(leadingNumberMatch[1]);
    remainder = leadingNumberMatch[2].trim();
  } else {
    // 2. Prüfe Zahlwort am Anfang (z. B. "halbe Rolle Gaffa", "zwei Kisten Bier", "eine halbe Packung")
    const words = remainder.split(/\s+/);
    const firstWord = words[0]?.toLowerCase().replace(/[^a-zäöüß]/g, '');
    const secondWord = words[1]?.toLowerCase().replace(/[^a-zäöüß]/g, '');

    if ((firstWord === 'eine' || firstWord === 'ein') && secondWord && NUMBER_WORDS[secondWord] === 0.5) {
      amount = 0.5;
      remainder = words.slice(2).join(' ');
    } else if (firstWord && NUMBER_WORDS[firstWord] !== undefined) {
      amount = NUMBER_WORDS[firstWord];
      remainder = words.slice(1).join(' ');
    } else {
      // 3. Prüfe Zahl am Ende (z. B. "Bier 3 Kisten" oder "Kabeltrommel 2x")
      const trailingNumberMatch = remainder.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*(?:x|mal)?\s*([a-zA-ZäöüÄÖÜß.]*)$/);
      if (trailingNumberMatch && trailingNumberMatch[1].trim().length >= 2) {
        amount = parseFloat(trailingNumberMatch[2]);
        const possibleUnit = trailingNumberMatch[3]?.trim();
        remainder = possibleUnit
          ? `${possibleUnit} ${trailingNumberMatch[1].trim()}`
          : trailingNumberMatch[1].trim();
      }
    }
  }

  // Einheit am Anfang von remainder erkennen (z. B. "Kisten Cola" -> unit="Kiste", remainder="Cola")
  const remWords = remainder.split(/\s+/);
  if (remWords.length >= 1) {
    const firstTokenClean = remWords[0].toLowerCase().replace(/[^a-zäöüß]/g, '');
    if (UNIT_ALIASES[firstTokenClean]) {
      detectedUnit = UNIT_ALIASES[firstTokenClean];
      remainder = remWords.slice(1).join(' ').replace(/^(?:von|vom|an)\s+/i, '').trim();
    }
  }

  // Falls remainder leer ist (z. B. bei "1 Kiste" vor "und 5 Flaschen Bier"), geben wir ein Teil-Objekt zurück
  const { item: matchedItem, confidence } = findBestMatchingItem(remainder || cleaned, catalog);

  let finalUnit = detectedUnit || 'Stück';
  let normalizedQuantity = amount;

  if (matchedItem) {
    if (
      detectedUnit &&
      matchedItem.subUnit &&
      detectedUnit.toLowerCase() === matchedItem.subUnit.toLowerCase()
    ) {
      finalUnit = matchedItem.subUnit;
    } else {
      finalUnit = matchedItem.unit;
    }
    normalizedQuantity = toPrimaryUnitQuantity(matchedItem, amount, finalUnit);
  }

  return {
    rawSegment: rawSegment.trim(),
    matchedItem,
    amount: roundStock(amount),
    unit: finalUnit,
    normalizedQuantity,
    confidence,
  };
}

/**
 * Lokaler Offline-Parser für kopierte WhatsApp-Nachrichten, Notizen oder Freitext-Listen.
 */
export function parseFreeTextBlock(text: string, catalog: InventoryItem[]): ParseBlockResult {
  if (!text || !text.trim()) {
    return { items: [], usedAI: false };
  }

  let suggestedEvent: string | undefined;
  let suggestedPerson: string | undefined;

  let workingText = text.trim();

  // Event-Hinweis erkennen, z. B. "Fürs Sommerfest: ..." oder "Event: Vereinsabend"
  const eventHeaderMatch = workingText.match(
    /^(?:fürs|fuers|für das|fuer das|für|fuer|event|veranstaltung|anlass)\s+([A-Za-zÄÖÜäöüß0-9\-\s]{2,28}?)\s*[:\-–\n]([\s\S]*)$/i
  );
  if (eventHeaderMatch) {
    suggestedEvent = eventHeaderMatch[1].trim();
    workingText = eventHeaderMatch[2].trim();
  }

  // Person erkennen, falls "Von Max:" oder "Name: Lisa" angegeben
  const personHeaderMatch = workingText.match(
    /^(?:von|name|entnommen von|zurück von)\s+([A-Za-zÄÖÜäöüß\s]{2,20}?)\s*[:\-–\n]([\s\S]*)$/i
  );
  if (personHeaderMatch) {
    suggestedPerson = personHeaderMatch[1].trim();
    workingText = personHeaderMatch[2].trim();
  }

  // Dezimalkommas schützen, damit beim Komma-Split "1,5 Rollen" zusammenbleibt
  const decimalProtected = workingText.replace(/(\d+),(\d+)/g, '$1.$2');

  // Segmente nach Zeilenumbruch, Semikolon, Komma oder " und " / " + " vor Zahlen/Zahlwörtern trennen
  const rawLines = decimalProtected
    .split(/\n|;|,|\s+(?:und|sowie|\+)\s+(?=(?:\d|ein|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|halb|anderthalb))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const parsedItems: ParsedTextItem[] = [];

  for (const segment of rawLines) {
    // Ignoriere reine Überschrift-Segmente wie "Mitgenommen:" oder "Verbraucht:"
    const strippedPrefix = segment.replace(
      /^(?:mitgenommen|entnommen|verbraucht|zurück|zurueck|rest|reste|einkauf|gekauft)\s*:\s*/i,
      ''
    );
    if (!strippedPrefix.trim()) continue;

    const parsed = parseSingleSegment(strippedPrefix, catalog);
    if (parsed) {
      parsedItems.push(parsed);
    }
  }

  // Rückwärts-Verknüpfung für Ausdrücke wie "1 Kiste und 5 Flaschen Bier"
  for (let i = parsedItems.length - 2; i >= 0; i--) {
    const current = parsedItems[i];
    const next = parsedItems[i + 1];
    if (!current.matchedItem && next.matchedItem) {
      current.matchedItem = next.matchedItem;
      if (
        current.unit &&
        next.matchedItem.subUnit &&
        current.unit.toLowerCase() === next.matchedItem.subUnit.toLowerCase()
      ) {
        current.unit = next.matchedItem.subUnit;
      } else {
        current.unit = next.matchedItem.unit;
      }
      current.normalizedQuantity = toPrimaryUnitQuantity(
        next.matchedItem,
        current.amount,
        current.unit
      );
      current.confidence = 'medium';
    }
  }

  return {
    items: parsedItems,
    suggestedEvent,
    suggestedPerson,
    usedAI: false,
  };
}

/**
 * Optionale KI-gestützte Texterkennung über Gemini oder OpenAI API (falls im Admin-Bereich konfiguriert)
 */
export async function parseTextWithAI(
  text: string,
  catalog: InventoryItem[],
  settings: AppSettings
): Promise<ParseBlockResult> {
  if (!settings.aiApiKey || !navigator.onLine) {
    return parseFreeTextBlock(text, catalog);
  }

  const catalogDescription = catalog.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    subUnit: item.subUnit || null,
    subUnitsPerUnit: item.subUnitsPerUnit || null,
    aliases: item.aliases,
  }));

  const systemPrompt = `Du bist ein Assistent für ein Vereinskeller-Inventurprogramm.
Analysiere den folgenden Freitext und ordne alle genannten Artikel dem Katalog zu.
Katalog: ${JSON.stringify(catalogDescription)}
Antworte ausschließlich als valides JSON-Objekt im Format:
{
  "suggestedEvent": "Optionaler Eventname oder null",
  "suggestedPerson": "Optionaler Personenname oder null",
  "items": [
    {
      "rawSegment": "Originaltext der Position",
      "itemId": "ID aus dem Katalog oder null",
      "amount": 2,
      "unit": "Gewählte Einheit (unit oder subUnit des Artikels)"
    }
  ]
}`;

  try {
    let jsonText = '';

    if (settings.aiProvider === 'gemini') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
          settings.aiApiKey
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\nFreitext:\n${text}` }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );
      if (!response.ok) throw new Error('Gemini API Fehler');
      const data = await response.json();
      jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
        }),
      });
      if (!response.ok) throw new Error('OpenAI API Fehler');
      const data = await response.json();
      jsonText = data.choices?.[0]?.message?.content || '';
    }

    const parsedJson = JSON.parse(jsonText);
    const items: ParsedTextItem[] = (parsedJson.items || []).map(
      (entry: { rawSegment?: string; itemId?: string; amount?: number; unit?: string }) => {
        const matchedItem = catalog.find((c) => c.id === entry.itemId);
        const amount = typeof entry.amount === 'number' && entry.amount > 0 ? entry.amount : 1;
        const unit = matchedItem
          ? entry.unit &&
            matchedItem.subUnit &&
            entry.unit.toLowerCase() === matchedItem.subUnit.toLowerCase()
            ? matchedItem.subUnit
            : matchedItem.unit
          : entry.unit || 'Stück';

        return {
          rawSegment: entry.rawSegment || '',
          matchedItem,
          amount: roundStock(amount),
          unit,
          normalizedQuantity: matchedItem
            ? toPrimaryUnitQuantity(matchedItem, amount, unit)
            : amount,
          confidence: matchedItem ? 'high' : 'low',
        };
      }
    );

    return {
      items,
      suggestedEvent: parsedJson.suggestedEvent || undefined,
      suggestedPerson: parsedJson.suggestedPerson || undefined,
      usedAI: true,
    };
  } catch {
    return parseFreeTextBlock(text, catalog);
  }
}
