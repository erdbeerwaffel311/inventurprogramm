import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AppSettings,
  BookingMode,
  CartEntry,
  CategoryInfo,
  InventoryItem,
  InventoryTransaction,
  TransactionLineItem,
} from './types';
import {
  DEFAULT_ITEMS,
  DEFAULT_SETTINGS,
  DEFAULT_TRANSACTIONS,
  LEGACY_DEMO_ITEM_IDS,
  LEGACY_DEMO_TX_IDS,
} from './data/defaultData';
import { roundStock, toPrimaryUnitQuantity } from './utils/units';
import {
  deleteItemFromSupabase,
  normalizeSupabaseUrl,
  pullFromSupabase,
  pushConfigToSupabase,
  pushToSupabase,
} from './utils/supabaseSync';
import { ActiveTab, Header } from './components/Header';
import { OpenBookingView } from './components/OpenBookingView';
import { HistoryLogView } from './components/HistoryLogView';
import { ShoppingListView } from './components/ShoppingListView';
import { AdminView } from './components/AdminView';

const STORAGE_KEYS = {
  ITEMS: 'vk_inventory_items_v2',
  TRANSACTIONS: 'vk_inventory_transactions_v2',
  SETTINGS: 'vk_app_settings_v1',
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('booking');
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [selectedReturnTxId, setSelectedReturnTxId] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const parsed = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };

      if (!parsed.supabaseUrl) parsed.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
      if (!parsed.supabaseAnonKey) parsed.supabaseAnonKey = DEFAULT_SETTINGS.supabaseAnonKey;

      // Prüfe QR-Code / Einladungslink-Parameter (?dbUrl=...&dbKey=...&club=...)
      const params = new URLSearchParams(window.location.search);
      const urlDb = params.get('dbUrl');
      const keyDb = params.get('dbKey');
      const clubParam = params.get('club');

      if (urlDb && keyDb) {
        parsed.supabaseUrl = urlDb;
        parsed.supabaseAnonKey = keyDb;
      }
      if (clubParam) {
        parsed.clubName = clubParam;
      }

      // Automatisch "/rest/v1/" am Ende der URL entfernen, falls mitkopiert
      parsed.supabaseUrl = normalizeSupabaseUrl(parsed.supabaseUrl);

      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
      if (urlDb || keyDb || clubParam) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      return parsed;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [items, setItems] = useState<InventoryItem[]>(() => {
    try {
      localStorage.removeItem('vk_inventory_items_v1');
      const saved = localStorage.getItem(STORAGE_KEYS.ITEMS);
      const parsed: InventoryItem[] = saved ? JSON.parse(saved) : DEFAULT_ITEMS;
      return parsed.filter((i) => !LEGACY_DEMO_ITEM_IDS.has(i.id));
    } catch {
      return DEFAULT_ITEMS;
    }
  });

  const [transactions, setTransactions] = useState<InventoryTransaction[]>(() => {
    try {
      localStorage.removeItem('vk_inventory_transactions_v1');
      const saved = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
      const parsed: InventoryTransaction[] = saved ? JSON.parse(saved) : DEFAULT_TRANSACTIONS;
      return parsed.filter((t) => !LEGACY_DEMO_TX_IDS.has(t.id));
    } catch {
      return DEFAULT_TRANSACTIONS;
    }
  });

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Speichere Änderungen sofort lokal (Offline-First im Keller)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }, [settings]);

  const hasCloudConfig = Boolean(
    settings.supabaseUrl?.trim() && settings.supabaseAnonKey?.trim()
  );

  const unsyncedCount = useMemo(
    () => transactions.filter((t) => !t.synced).length,
    [transactions]
  );

  // Cloud-Synchronisation (Push ausstehender Offline-Buchungen + Pull des aktuellen Bestands)
  const syncWithCloud = useCallback(
    async (currentItems = items, currentTxs = transactions, currentSettings = settings) => {
      if (
        !navigator.onLine ||
        !currentSettings.supabaseUrl?.trim() ||
        !currentSettings.supabaseAnonKey?.trim()
      ) {
        return;
      }

      setIsSyncing(true);
      try {
        const hasUnsynced = currentTxs.some((t) => !t.synced);
        if (hasUnsynced) {
          await pushToSupabase(currentSettings, currentItems, currentTxs);
          setTransactions((prev) => prev.map((tx) => ({ ...tx, synced: true })));
        }

        const remote = await pullFromSupabase(currentSettings);
        if (remote) {
          const cleanRemoteItems = remote.items.filter(
            (i) => !LEGACY_DEMO_ITEM_IDS.has(i.id)
          );
          const cleanRemoteTxs = remote.transactions.filter(
            (t) => !LEGACY_DEMO_TX_IDS.has(t.id)
          );

          setItems(cleanRemoteItems);
          setTransactions(cleanRemoteTxs);

          const defaultCatIds = new Set(['drinks_food', 'consumables', 'equipment']);
          const localCats = currentSettings.categories || DEFAULT_SETTINGS.categories;

          if (remote.config && remote.config.categories?.length) {
            const deletedSet = new Set(remote.config.deletedCategoryIds || []);
            const mergedCats = [...remote.config.categories];
            let localHadNewCustomCats = false;

            // Falls auf diesem Gerät (z. B. Handy) bereits eigene Kategorien angelegt wurden,
            // die noch nicht in der Cloud waren, führen wir sie zusammen und laden sie hoch:
            for (const lCat of localCats) {
              if (
                !defaultCatIds.has(lCat.id) &&
                !deletedSet.has(lCat.id) &&
                !mergedCats.some((rc) => rc.id === lCat.id)
              ) {
                mergedCats.push(lCat);
                localHadNewCustomCats = true;
              }
            }

            // Auch Kategorien aus vorhandenen Cloud-Artikeln berücksichtigen
            for (const rItem of cleanRemoteItems) {
              if (rItem.category && !mergedCats.some((c) => c.id === rItem.category)) {
                const label = rItem.categoryLabel || rItem.category;
                mergedCats.push({
                  id: rItem.category,
                  label,
                  shortLabel: label.length > 18 ? label.slice(0, 16) + '…' : label,
                  description: 'Eigene Vereins-Kategorie',
                  color: 'violet',
                  defaultReturnable: rItem.isReturnable,
                });
                localHadNewCustomCats = true;
              }
            }

            const updatedSettings: AppSettings = {
              ...currentSettings,
              clubName: remote.config.clubName || currentSettings.clubName,
              adminPassword: remote.config.adminPassword || currentSettings.adminPassword,
              commonEvents: remote.config.commonEvents?.length
                ? remote.config.commonEvents
                : currentSettings.commonEvents,
              categories: mergedCats,
            };

            setSettings(updatedSettings);

            if (localHadNewCustomCats) {
              await pushConfigToSupabase(updatedSettings, remote.config.deletedCategoryIds || []);
            }
          } else {
            // Noch kein __keller_config__ in Supabase vorhanden:
            // Falls dieses Gerät eigene Kategorien hat, sofort in die Cloud hochladen!
            const hasLocalCustomCats = localCats.some((c) => !defaultCatIds.has(c.id));
            if (hasLocalCustomCats) {
              await pushConfigToSupabase(currentSettings);
            }
          }
        }
      } catch {
        // Bleibt im Offline-/Queue-Modus bis zur nächsten Verbindung
      } finally {
        setIsSyncing(false);
      }
    },
    [items, transactions, settings]
  );

  // Online / Offline Listener + automatischer Sync beim Verlassen des Kellers + Live-Sync alle 15s
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncWithCloud();
    };
    const handleOffline = () => setIsOnline(false);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        syncWithCloud();
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        syncWithCloud();
      }
    }, 15000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [syncWithCloud]);

  // Initialer Cloud-Sync beim Start
  useEffect(() => {
    if (hasCloudConfig && navigator.onLine) {
      syncWithCloud();
    }
  }, [hasCloudConfig]);

  // Buchung ausführen (Entnahme, Rückgabe, Befüllung)
  function handleExecuteBooking(params: {
    mode: BookingMode;
    entries: CartEntry[];
    personName?: string;
    eventName?: string;
    note?: string;
    relatedTransactionId?: string;
  }) {
    const now = new Date().toISOString();
    const lineItems: TransactionLineItem[] = [];
    const nextItems = items.map((item) => {
      const entry = params.entries.find((e) => e.itemId === item.id);
      if (!entry || entry.amount <= 0) return item;

      const deltaPrimary = toPrimaryUnitQuantity(item, entry.amount, entry.unit);
      const signedChange = params.mode === 'withdraw' ? -deltaPrimary : deltaPrimary;
      const previousStock = item.quantity;
      const newStock = roundStock(Math.max(0, previousStock + signedChange));

      lineItems.push({
        itemId: item.id,
        itemName: item.name,
        quantityChange: signedChange,
        enteredAmount: entry.amount,
        enteredUnit: entry.unit,
        previousStock,
        newStock,
        returnedQuantity: 0,
      });

      return {
        ...item,
        quantity: newStock,
        updatedAt: now,
      };
    });

    const newTx: InventoryTransaction = {
      id: `tx-${Date.now()}`,
      timestamp: now,
      type: params.mode,
      personName: params.personName,
      eventName: params.eventName,
      note: params.note,
      relatedTransactionId: params.relatedTransactionId,
      status: params.mode === 'withdraw' ? 'open_loan' : 'completed',
      items: lineItems,
      synced: false,
    };

    const nextTransactions = [
      ...(lineItems.length > 0 ? [newTx] : []),
      ...transactions.map((tx) => {
        if (params.relatedTransactionId && tx.id === params.relatedTransactionId) {
          const updatedLines = tx.items.map((line) => {
            const retEntry = lineItems.find((l) => l.itemId === line.itemId);
            if (!retEntry) return line;
            return {
              ...line,
              returnedQuantity: roundStock(
                (line.returnedQuantity || 0) + Math.abs(retEntry.quantityChange)
              ),
            };
          });
          return {
            ...tx,
            items: updatedLines,
            status: 'completed' as const,
            synced: false,
          };
        }
        return tx;
      }),
    ];

    setItems(nextItems);
    setTransactions(nextTransactions);

    if (hasCloudConfig && navigator.onLine) {
      pushToSupabase(settings, nextItems, nextTransactions)
        .then((ok) => {
          if (ok) {
            setTransactions((prev) => prev.map((t) => ({ ...t, synced: true })));
          }
        })
        .catch(() => {});
    }
  }

  // Erstinventur / Zählung speichern
  function handleSaveInitialInventory(
    updatedQuantities: Record<string, number>,
    note?: string
  ) {
    const now = new Date().toISOString();
    const changedLines: TransactionLineItem[] = [];

    const nextItems = items.map((item) => {
      const counted = updatedQuantities[item.id];
      if (counted === undefined) return item;
      const diff = roundStock(counted - item.quantity);
      if (Math.abs(diff) > 0.0001) {
        changedLines.push({
          itemId: item.id,
          itemName: item.name,
          quantityChange: diff,
          enteredAmount: Math.abs(diff),
          enteredUnit: item.unit,
          previousStock: item.quantity,
          newStock: counted,
        });
      }
      return {
        ...item,
        quantity: counted,
        updatedAt: now,
      };
    });

    let nextTxs = transactions;
    if (changedLines.length > 0) {
      const invTx: InventoryTransaction = {
        id: `tx-inv-${Date.now()}`,
        timestamp: now,
        type: 'initial_inventory',
        personName: 'Admin',
        eventName: 'Inventur',
        note: note || 'Bestandszählung im Admin-Bereich',
        status: 'completed',
        items: changedLines,
        synced: false,
      };
      nextTxs = [invTx, ...transactions];
    }

    setItems(nextItems);
    setTransactions(nextTxs);

    if (hasCloudConfig && navigator.onLine) {
      pushToSupabase(settings, nextItems, nextTxs).catch(() => {});
    }
  }

  // Buchung stornieren / rückgängig machen
  function handleUndoTransaction(txId: string) {
    const target = transactions.find((t) => t.id === txId);
    if (!target) return;

    const now = new Date().toISOString();
    const nextItems = items.map((item) => {
      const line = target.items.find((l) => l.itemId === item.id);
      if (!line) return item;
      return {
        ...item,
        quantity: roundStock(Math.max(0, item.quantity - line.quantityChange)),
        updatedAt: now,
      };
    });

    const nextTxs = transactions.filter((t) => t.id !== txId);
    setItems(nextItems);
    setTransactions(nextTxs);

    if (hasCloudConfig && navigator.onLine) {
      pushToSupabase(settings, nextItems, nextTxs).catch(() => {});
    }
  }

  function handleUpsertItem(item: InventoryItem) {
    const exists = items.some((i) => i.id === item.id);
    const nextItems = exists
      ? items.map((i) => (i.id === item.id ? item : i))
      : [...items, item];
    setItems(nextItems);
    if (hasCloudConfig && navigator.onLine) {
      pushToSupabase(settings, nextItems, transactions).catch(() => {});
    }
  }

  function handleDeleteItem(itemId: string) {
    const nextItems = items.filter((i) => i.id !== itemId);
    setItems(nextItems);
    if (hasCloudConfig && navigator.onLine) {
      deleteItemFromSupabase(settings, itemId).catch(() => {});
    }
  }

  function handleBulkImportItems(
    newItems: InventoryItem[],
    newCategories: CategoryInfo[],
    summaryNote: string
  ) {
    const nextSettings = { ...settings, categories: newCategories };
    setItems(newItems);
    setSettings(nextSettings);
    const invTx: InventoryTransaction = {
      id: `tx-csv-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'initial_inventory',
      personName: 'Admin',
      eventName: 'CSV-Import',
      note: summaryNote,
      status: 'completed',
      items: [],
      synced: false,
    };
    const nextTxs = [invTx, ...transactions];
    setTransactions(nextTxs);
    if (hasCloudConfig && navigator.onLine) {
      pushToSupabase(nextSettings, newItems, nextTxs).catch(() => {});
    }
  }

  const lowStockCount = useMemo(
    () => items.filter((i) => i.quantity < i.minStock).length,
    [items]
  );

  const openLoansCount = useMemo(
    () =>
      transactions.filter((t) => t.type === 'withdraw' && t.status !== 'completed')
        .length,
    [transactions]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header
        clubName={settings.clubName}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lowStockCount={lowStockCount}
        openLoansCount={openLoansCount}
        isOnline={isOnline}
        hasCloudConfig={hasCloudConfig}
        unsyncedCount={unsyncedCount}
        isSyncing={isSyncing}
        onManualSync={() => syncWithCloud()}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 py-5">
        {activeTab === 'booking' && (
          <OpenBookingView
            items={items}
            transactions={transactions}
            settings={settings}
            selectedReturnTxId={selectedReturnTxId}
            onClearSelectedReturnTx={() => setSelectedReturnTxId(null)}
            onExecuteBooking={handleExecuteBooking}
          />
        )}

        {activeTab === 'history' && (
          <HistoryLogView
            transactions={transactions}
            onStartReturnFromTx={(txId) => {
              setSelectedReturnTxId(txId);
              setActiveTab('booking');
            }}
            onUndoTransaction={handleUndoTransaction}
          />
        )}

        {activeTab === 'shopping' && (
          <ShoppingListView
            items={items}
            onExecuteBooking={handleExecuteBooking}
          />
        )}

        {activeTab === 'admin' && (
          <AdminView
            items={items}
            transactions={transactions}
            settings={settings}
            isUnlocked={isAdminUnlocked}
            onUnlock={() => setIsAdminUnlocked(true)}
            onLock={() => setIsAdminUnlocked(false)}
            onSaveInitialInventory={handleSaveInitialInventory}
            onUpsertItem={handleUpsertItem}
            onDeleteItem={handleDeleteItem}
            onBulkImportItems={handleBulkImportItems}
            onUpdateSettings={(newSettings, deletedCatId) => {
              setSettings(newSettings);
              if (newSettings.supabaseUrl && newSettings.supabaseAnonKey && navigator.onLine) {
                pushConfigToSupabase(newSettings, deletedCatId ? [deletedCatId] : [])
                  .then(() => syncWithCloud(items, transactions, newSettings))
                  .catch(() => {});
              }
            }}
            onManualSync={() => syncWithCloud()}
            isSyncing={isSyncing}
          />
        )}
      </main>
    </div>
  );
};
