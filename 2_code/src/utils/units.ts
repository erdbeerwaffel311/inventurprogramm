import { InventoryItem } from '../types';

export function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

const PLURAL_MAP: Record<string, string> = {
  Kiste: 'Kisten',
  Kasten: 'Kästen',
  Flasche: 'Flaschen',
  Rolle: 'Rollen',
  Packung: 'Packungen',
  Garnitur: 'Garnituren',
  Sack: 'Säcke',
  Stück: 'Stück',
  Set: 'Sets',
  Liter: 'Liter',
  Dose: 'Dosen',
  Karton: 'Kartons',
};

export function pluralizeUnit(unit: string, count: number): string {
  if (Math.abs(count - 1) < 0.0001) return unit;
  return PLURAL_MAP[unit] || (unit.endsWith('e') ? `${unit}n` : unit);
}

export function formatGermanNumber(num: number): string {
  const rounded = Math.round(num * 100) / 100;
  return rounded.toString().replace('.', ',');
}

/**
 * Formatiert einen Bestand in der Haupteinheit lesbar für den Nutzer.
 * Beispiel bei Kiste (20 Flaschen) und quantity = 4.5 -> "4 Kisten + 10 Flaschen"
 * Beispiel bei Rolle und quantity = 1.5 -> "1,5 Rollen"
 */
export function formatStockDisplay(item: InventoryItem, quantity: number = item.quantity): {
  primaryText: string;
  secondaryText?: string;
} {
  const safeQty = roundStock(quantity);

  if (item.subUnit && item.subUnitsPerUnit && item.subUnitsPerUnit > 1) {
    const totalSubUnits = Math.round(safeQty * item.subUnitsPerUnit);
    const fullPrimary = Math.trunc(totalSubUnits / item.subUnitsPerUnit);
    const remainingSub = totalSubUnits % item.subUnitsPerUnit;

    if (remainingSub === 0) {
      return {
        primaryText: `${fullPrimary} ${pluralizeUnit(item.unit, fullPrimary)}`,
        secondaryText: `= ${totalSubUnits} ${pluralizeUnit(item.subUnit, totalSubUnits)}`,
      };
    }

    if (fullPrimary === 0) {
      return {
        primaryText: `${remainingSub} ${pluralizeUnit(item.subUnit, remainingSub)}`,
        secondaryText: `(${formatGermanNumber(safeQty)} ${pluralizeUnit(item.unit, safeQty)})`,
      };
    }

    return {
      primaryText: `${fullPrimary} ${pluralizeUnit(item.unit, fullPrimary)} + ${remainingSub} ${pluralizeUnit(item.subUnit, remainingSub)}`,
      secondaryText: `Gesamt: ${totalSubUnits} ${pluralizeUnit(item.subUnit, totalSubUnits)}`,
    };
  }

  return {
    primaryText: `${formatGermanNumber(safeQty)} ${pluralizeUnit(item.unit, safeQty)}`,
  };
}

/**
 * Rechnet eine eingegebene Menge + Einheit in die Haupteinheit des Artikels um.
 */
export function toPrimaryUnitQuantity(
  item: InventoryItem,
  enteredAmount: number,
  enteredUnit: string
): number {
  if (
    item.subUnit &&
    item.subUnitsPerUnit &&
    item.subUnitsPerUnit > 0 &&
    enteredUnit.toLowerCase() === item.subUnit.toLowerCase()
  ) {
    return roundStock(enteredAmount / item.subUnitsPerUnit);
  }
  return roundStock(enteredAmount);
}

/**
 * Formatiert eine Buchungsposition (z. B. "5 Flaschen" oder "2 Kisten")
 */
export function formatEnteredAmount(amount: number, unit: string): string {
  return `${formatGermanNumber(amount)} ${pluralizeUnit(unit, amount)}`;
}
