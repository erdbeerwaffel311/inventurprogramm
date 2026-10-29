import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AppSettings,
  BookingMode,
  CartEntry,
  CategoryInfo,
  InventoryItem,
  InventoryTransaction,
  KellerlisteProject,
  MemberAccount,
  TransactionLineItem,
} from './types';
import {
  DEFAULT_ALLOWED_MEMBERS,
  DEFAULT_ITEMS,
  DEFAULT_MEMBER_ACCOUNTS,
  DEFAULT_SETTINGS,
  DEFAULT_TRANSACTIONS,
  LEGACY_DEMO_ITEM_IDS,
  LEGACY_DEMO_TX_IDS,
  reconcileMemberAccounts,
} from './data/defaultData';
import { roundStock, toPrimaryUnitQuantity } from './utils/units';
import {
  deleteItemFromPocketBase,
  deleteTransactionFromPocketBase,
  getPocketBaseClient,
  logoutFromPocketBase,
  normalizePocketBaseUrl,
  pullFromPocketBase,
  pushConfigToPocketBase,
  pushToPocketBase,
  toPocketBaseId,
  verifyAdmin2FACode,
} from './utils/pocketbaseSync';
import { ActiveTab, Header } from './components/Header';
import { OpenBookingView } from './components/OpenBookingView';
import { KellerlisteView } from './components/KellerlisteView';
import { HistoryLogView } from './components/HistoryLogView';
import { ShoppingListView } from './components/ShoppingListView';
import { AdminView } from './components/AdminView';
import { MemberLoginView } from './components/MemberLoginView';

const STORAGE_KEYS = {
  ITEMS: 'vk_inventory_items_v2',
  TRANSACTIONS: 'vk_inventory_transactions_v2',
  SETTINGS: 'vk_app_settings_v1',
  LOGGED_IN_MEMBER: 'vk_logged_in_member_v1',
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('booking');
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [initial2FAVerified, setInitial2FAVerified] = useState(false);
  const [selectedReturnTxId, setSelectedReturnTxId] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const parsed = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };

      if (
        !parsed.pocketbaseUrl ||
        String(parsed.pocketbaseUrl).includes('supabase.co')
      ) {
        parsed.pocketbaseUrl = DEFAULT_SETTINGS.pocketbaseUrl;
      }
      if (!Array.isArray(parsed.allowedMembers) || parsed.allowedMembers.length === 0) {
        parsed.allowedMembers = DEFAULT_ALLOWED_MEMBERS;
      }
      parsed.memberAccounts = reconcileMemberAccounts(
        parsed.allowedMembers,
        parsed.memberAccounts || DEFAULT_MEMBER_ACCOUNTS
      );
      if (!Array.isArray(parsed.projectLists)) {
        parsed.projectLists = [];
      }

      // Prüfe QR-Code / Einladungslink-Parameter (?dbUrl=...&club=...)
      const params = new URLSearchParams(window.location.search);
      const urlDb = params.get('dbUrl');
      const clubParam = params.get('club');

      if (urlDb && !urlDb.includes('supabase.co')) {
        parsed.pocketbaseUrl = urlDb;
      }
      if (clubParam) {
        parsed.clubName = clubParam;
      }

      parsed.pocketbaseUrl = normalizePocketBaseUrl(parsed.pocketbaseUrl);

      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
      if (urlDb || clubParam) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      return parsed;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const activeMemberAccounts = useMemo(
    () => reconcileMemberAccounts(settings.allowedMembers, settings.memberAccounts),
    [settings.allowedMembers, settings.memberAccounts]
  );

  const [loggedInMember, setLoggedInMember] = useState<MemberAccount | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOGGED_IN_MEMBER);
      if (!raw) return null;
      const savedAcc = JSON.parse(raw) as MemberAccount;
      if (!savedAcc?.username) return null;
      return savedAcc;
    } catch {
      return null;
    }
  });

  // Automatische Erkennung beim Öffnen über den 2FA-Bestätigungslink aus der E-Mail
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const has2FAParam =
      searchParams.get('2fa') === 'verify' ||
      Boolean(searchParams.get('2fa_code')) ||
      window.location.hash.includes('access_token=');
    if (!has2FAParam) return;

    // 1. Expliziter SiP-Parameter: Sofort zur SiP-Webseite weiterleiten
    if (
      searchParams.get('source') === 'sip' ||
      searchParams.get('app') === 'sip' ||
      window.location.hash.includes('source=sip') ||
      window.location.hash.includes('app=sip')
    ) {
      window.location.replace(
        `https://sip.schuelerunion-vorarlberg.at/${window.location.search}${window.location.hash}`
      );
      return;
    }

    const client = getPocketBaseClient(settings);
    if (!client) return;

    // 2. Intelligente Trennung: Prüfe, ob in der Datenbank ein frischer 2FA-Request für SiP vorliegt
    async function handleIncoming2FA() {
      try {
        const sipPbId = toPocketBaseId('__sip_users_config__');
        const appPbId = toPocketBaseId('__app_config__');
        const records = await client!
          .collection('keller_items')
          .getFullList({
            filter: `id = "${sipPbId}" || id = "${appPbId}"`,
            requestKey: null,
          });

        const sipConfig = records?.find((d) => d.id === sipPbId)?.payload;
        const appConfig = records?.find((d) => d.id === appPbId)?.payload;

        const now = Date.now();
        const sipExp = sipConfig?.twoFactorToken?.expiresAt
          ? new Date(sipConfig.twoFactorToken.expiresAt).getTime()
          : 0;
        const appExp = appConfig?.twoFactorToken?.expiresAt
          ? new Date(appConfig.twoFactorToken.expiresAt).getTime()
          : 0;

        // Falls SiP einen aktiveren/neueren 2FA-Request hat als das Inventurprogramm, leite direkt zu SiP weiter
        if (sipExp > now && sipExp > appExp) {
          window.location.replace(
            `https://sip.schuelerunion-vorarlberg.at/${window.location.search}${window.location.hash}`
          );
          return;
        }

        // Andernfalls: Normal für Inventurprogramm verarbeiten
        if (
          (searchParams.get('2fa_code') ||
            searchParams.get('code') ||
            searchParams.get('token') ||
            window.location.hash.includes('access_token=')) &&
          settings.adminEmail
        ) {
          verifyAdmin2FACode(settings, settings.adminEmail, window.location.href)
            .then((ok) => {
              if (ok) {
                setInitial2FAVerified(true);
                setIsAdminUnlocked(true);
                setActiveTab('admin');
                window.history.replaceState({}, document.title, window.location.pathname);
              }
            })
            .catch(() => {});
        }
      } catch {}
    }
    handleIncoming2FA();

    const unsubscribe = client.authStore.onChange(async (token, record) => {
      const recordEmail = typeof record?.email === 'string' ? record.email : '';
      if (
        token &&
        recordEmail &&
        (!settings.adminEmail ||
          recordEmail.toLowerCase() === settings.adminEmail.trim().toLowerCase())
      ) {
        if (
          searchParams.get('source') === 'sip' ||
          searchParams.get('app') === 'sip' ||
          window.location.hash.includes('source=sip')
        ) {
          window.location.replace(
            `https://sip.schuelerunion-vorarlberg.at/${window.location.search}${window.location.hash}`
          );
          return;
        }

        try {
          const data = await client!
            .collection('keller_items')
            .getOne(toPocketBaseId('__sip_users_config__'), { requestKey: null });
          const sipExp = data?.payload?.twoFactorToken?.expiresAt
            ? new Date(data.payload.twoFactorToken.expiresAt).getTime()
            : 0;
          if (sipExp > Date.now()) {
            window.location.replace(
              `https://sip.schuelerunion-vorarlberg.at/${window.location.search}${window.location.hash}`
            );
            return;
          }
        } catch {}

        setInitial2FAVerified(true);
        setIsAdminUnlocked(true);
        setActiveTab('admin');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [settings]);

  const [items, setItems] = useState<InventoryItem[]>(() => {
    try {
      localStorage.removeItem('vk_inventory_items_v1');
      const saved = localStorage.getItem(STORAGE_KEYS.ITEMS);
      const parsed: InventoryItem[] = saved ? JSON.parse(saved) : DEFAULT_ITEMS;
      return parsed.filter(
        (i) => i && typeof i.id === 'string' && !i.id.startsWith('__') && !LEGACY_DEMO_ITEM_IDS.has(i.id)
      );
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

  const hasCloudConfig = Boolean(settings.pocketbaseUrl?.trim());

  const unsyncedCount = useMemo(
    () => transactions.filter((t) => !t.synced).length,
    [transactions]
  );

  // Cloud-Synchronisation (Push ausstehender Offline-Buchungen + Pull des aktuellen Bestands)
  const syncWithCloud = useCallback(
    async (currentItems = items, currentTxs = transactions, currentSettings = settings) => {
      if (!navigator.onLine || !currentSettings.pocketbaseUrl?.trim()) {
        return;
      }

      setIsSyncing(true);
      try {
        const hasUnsynced = currentTxs.some((t) => !t.synced);
        if (hasUnsynced) {
          await pushToPocketBase(currentSettings, currentItems, currentTxs);
          setTransactions((prev) => prev.map((tx) => ({ ...tx, synced: true })));
        }

        const remote = await pullFromPocketBase(currentSettings);
        if (remote) {
          const cleanRemoteItems = remote.items.filter(
            (i) => i && typeof i.id === 'string' && !i.id.startsWith('__') && !LEGACY_DEMO_ITEM_IDS.has(i.id)
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

            const nextAllowedMembers = remote.config.allowedMembers?.length
              ? remote.config.allowedMembers
              : currentSettings.allowedMembers || DEFAULT_ALLOWED_MEMBERS;
            const nextMemberAccounts = reconcileMemberAccounts(
              nextAllowedMembers,
              remote.config.memberAccounts?.length
                ? remote.config.memberAccounts
                : currentSettings.memberAccounts || DEFAULT_MEMBER_ACCOUNTS
            );

            // Merge projectLists from cloud + local (newest updatedAt wins)
            const remoteProjects = Array.isArray(remote.config.projectLists)
              ? remote.config.projectLists
              : [];
            const localProjects = Array.isArray(currentSettings.projectLists)
              ? currentSettings.projectLists
              : [];
            const mergedProjectsMap = new Map<string, KellerlisteProject>();
            for (const p of remoteProjects) {
              mergedProjectsMap.set(p.id, p);
            }
            for (const lp of localProjects) {
              const existing = mergedProjectsMap.get(lp.id);
              if (!existing || new Date(lp.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
                if (!remote.config.projectLists) {
                  mergedProjectsMap.set(lp.id, lp);
                }
              }
            }
            const nextProjectLists = remote.config.projectLists !== undefined
              ? remoteProjects
              : Array.from(mergedProjectsMap.values());

            const updatedSettings: AppSettings = {
              ...currentSettings,
              clubName: remote.config.clubName || currentSettings.clubName,
              adminPassword: remote.config.adminPassword || currentSettings.adminPassword,
              adminEmail:
                remote.config.adminEmail !== undefined
                  ? remote.config.adminEmail
                  : currentSettings.adminEmail,
              twoFactor:
                remote.config.twoFactor !== undefined
                  ? remote.config.twoFactor
                  : currentSettings.twoFactor,
              allowedMembers: nextAllowedMembers,
              memberAccounts: nextMemberAccounts,
              projectLists: nextProjectLists,
              commonEvents: remote.config.commonEvents?.length
                ? remote.config.commonEvents
                : currentSettings.commonEvents,
              categories: mergedCats,
            };

            setSettings(updatedSettings);

            if (localHadNewCustomCats || !remote.config.memberAccounts?.length) {
              await pushConfigToPocketBase(updatedSettings, remote.config.deletedCategoryIds || []);
            }
          } else {
            // Noch kein __keller_config__ in PocketBase vorhanden:
            await pushConfigToPocketBase(currentSettings);
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

    // Berechne aktuell maximal rückgebbare (ausgeliehene/entnommene) Menge pro Artikel in Haupteinheit
    const openBorrowedByItem: Record<string, number> = {};
    for (const tx of transactions) {
      if (tx.type !== 'withdraw' || tx.status === 'completed') continue;
      if (params.relatedTransactionId && tx.id !== params.relatedTransactionId) continue;
      for (const line of tx.items) {
        const rem = Math.max(
          0,
          roundStock(Math.abs(line.quantityChange) - (line.returnedQuantity || 0))
        );
        if (rem > 0) {
          openBorrowedByItem[line.itemId] = roundStock(
            (openBorrowedByItem[line.itemId] || 0) + rem
          );
        }
      }
    }

    const lineItems: TransactionLineItem[] = [];
    const nextItems = items.map((item) => {
      const entry = params.entries.find((e) => e.itemId === item.id);
      if (!entry || entry.amount <= 0) return item;

      let deltaPrimary = toPrimaryUnitQuantity(item, entry.amount, entry.unit);

      // Bei Entnahmen niemals mehr ausbuchen als aktuell im Lagerbestand vorhanden ist
      if (params.mode === 'withdraw') {
        const availablePrimary = Math.max(0, roundStock(item.quantity));
        deltaPrimary = Math.min(deltaPrimary, availablePrimary);
        if (deltaPrimary <= 0) return item;
      }

      // Bei Rückgaben niemals mehr einbuchen als tatsächlich ausgeliehen/entnommen wurde
      if (params.mode === 'return') {
        const maxReturnPrimary = openBorrowedByItem[item.id] || 0;
        deltaPrimary = Math.min(deltaPrimary, maxReturnPrimary);
        if (deltaPrimary <= 0) return item;
      }

      const signedChange = params.mode === 'withdraw' ? -deltaPrimary : deltaPrimary;
      const previousStock = item.quantity;
      const newStock = roundStock(Math.max(0, previousStock + signedChange));

      const effectiveEnteredAmount =
        (params.mode === 'withdraw' || params.mode === 'return') &&
        item.subUnit &&
        item.subUnitsPerUnit &&
        item.subUnitsPerUnit > 1 &&
        entry.unit.toLowerCase() === item.subUnit.toLowerCase()
          ? roundStock(deltaPrimary * item.subUnitsPerUnit)
          : params.mode === 'withdraw' || params.mode === 'return'
          ? deltaPrimary
          : entry.amount;

      lineItems.push({
        itemId: item.id,
        itemName: item.name,
        quantityChange: signedChange,
        enteredAmount: effectiveEnteredAmount,
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

    // Bei allgemeiner Rückgabe (ohne spezifische Event-Auswahl) die zurückgegebene Menge
    // auf die offenen Entnahmen anrechnen (älteste zuerst)
    const remainingCreditByItem: Record<string, number> = {};
    if (params.mode === 'return' && !params.relatedTransactionId) {
      for (const li of lineItems) {
        remainingCreditByItem[li.itemId] = Math.abs(li.quantityChange);
      }
    }

    const updatedExistingTxs = [...transactions]
      .reverse()
      .map((tx) => {
        if (params.relatedTransactionId && tx.id === params.relatedTransactionId) {
          const updatedLines = tx.items.map((line) => {
            const retEntry = lineItems.find((l) => l.itemId === line.itemId);
            if (!retEntry) return line;
            return {
              ...line,
              returnedQuantity: roundStock(
                Math.min(
                  Math.abs(line.quantityChange),
                  (line.returnedQuantity || 0) + Math.abs(retEntry.quantityChange)
                )
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

        if (
          params.mode === 'return' &&
          !params.relatedTransactionId &&
          tx.type === 'withdraw' &&
          tx.status !== 'completed'
        ) {
          let touched = false;
          const updatedLines = tx.items.map((line) => {
            const toCredit = remainingCreditByItem[line.itemId] || 0;
            if (toCredit <= 0) return line;
            const taken = Math.abs(line.quantityChange);
            const alreadyRet = line.returnedQuantity || 0;
            const openQty = Math.max(0, roundStock(taken - alreadyRet));
            if (openQty <= 0) return line;

            const applied = roundStock(Math.min(openQty, toCredit));
            remainingCreditByItem[line.itemId] = roundStock(toCredit - applied);
            touched = true;
            return {
              ...line,
              returnedQuantity: roundStock(alreadyRet + applied),
            };
          });

          if (touched) {
            const allReturned = updatedLines.every(
              (l) => (l.returnedQuantity || 0) >= Math.abs(l.quantityChange) - 0.0001
            );
            return {
              ...tx,
              items: updatedLines,
              status: (allReturned ? 'completed' : 'partially_returned') as
                | 'completed'
                | 'partially_returned',
              synced: false,
            };
          }
        }

        return tx;
      })
      .reverse();

    const nextTransactions = [
      ...(lineItems.length > 0 ? [newTx] : []),
      ...updatedExistingTxs,
    ];

    setItems(nextItems);
    setTransactions(nextTransactions);

    if (hasCloudConfig && navigator.onLine) {
      pushToPocketBase(settings, nextItems, nextTransactions)
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
      pushToPocketBase(settings, nextItems, nextTxs).catch(() => {});
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
      deleteTransactionFromPocketBase(settings, txId).catch(() => {});
      pushToPocketBase(settings, nextItems, nextTxs).catch(() => {});
    }
  }

  function handleUpsertItem(item: InventoryItem) {
    const exists = items.some((i) => i.id === item.id);
    const nextItems = exists
      ? items.map((i) => (i.id === item.id ? item : i))
      : [...items, item];
    setItems(nextItems);
    if (hasCloudConfig && navigator.onLine) {
      pushToPocketBase(settings, nextItems, transactions).catch(() => {});
    }
  }

  function handleDeleteItem(itemId: string) {
    const nextItems = items.filter((i) => i.id !== itemId);
    setItems(nextItems);
    if (hasCloudConfig && navigator.onLine) {
      deleteItemFromPocketBase(settings, itemId).catch(() => {});
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
      pushToPocketBase(nextSettings, newItems, nextTxs).catch(() => {});
    }
  }

  function handleUpdateProjectLists(nextLists: KellerlisteProject[]) {
    const nextSettings: AppSettings = {
      ...settings,
      projectLists: nextLists,
    };
    setSettings(nextSettings);
    if (hasCloudConfig && navigator.onLine) {
      pushConfigToPocketBase(nextSettings).catch(() => {});
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

  const projectListsCount = useMemo(
    () => (settings.projectLists || []).length,
    [settings.projectLists]
  );

  // Vor dem Eintritt in das Programm muss man sich mit vorname.nachname@schuelerunion.at + Passwort anmelden
  if (!loggedInMember && !initial2FAVerified) {
    return (
      <MemberLoginView
        clubName={settings.clubName}
        settings={settings}
        memberAccounts={activeMemberAccounts}
        onLoginSuccess={(account) => {
          setLoggedInMember(account);
          localStorage.setItem(STORAGE_KEYS.LOGGED_IN_MEMBER, JSON.stringify(account));
          localStorage.setItem('vk_last_person_name', account.name);
        }}
      />
    );
  }

  const currentUserName = loggedInMember?.name || 'Admin';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header
        clubName={settings.clubName}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lowStockCount={lowStockCount}
        openLoansCount={openLoansCount}
        projectListsCount={projectListsCount}
        isOnline={isOnline}
        hasCloudConfig={hasCloudConfig}
        unsyncedCount={unsyncedCount}
        isSyncing={isSyncing}
        onManualSync={() => syncWithCloud()}
        currentUserName={currentUserName}
        onLogout={() => {
          logoutFromPocketBase(settings);
          setLoggedInMember(null);
          localStorage.removeItem(STORAGE_KEYS.LOGGED_IN_MEMBER);
          setIsAdminUnlocked(false);
        }}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 py-5">
        {activeTab === 'booking' && (
          <OpenBookingView
            items={items}
            transactions={transactions}
            settings={settings}
            currentUserName={currentUserName}
            selectedReturnTxId={selectedReturnTxId}
            onClearSelectedReturnTx={() => setSelectedReturnTxId(null)}
            onExecuteBooking={handleExecuteBooking}
          />
        )}

        {activeTab === 'kellerliste' && (
          <KellerlisteView
            items={items}
            settings={settings}
            currentUserName={currentUserName}
            onUpdateProjectLists={handleUpdateProjectLists}
            onExecuteBookingFromList={handleExecuteBooking}
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
            initial2FAVerified={initial2FAVerified}
            onClearInitial2FAVerified={() => setInitial2FAVerified(false)}
            onSaveInitialInventory={handleSaveInitialInventory}
            onUpsertItem={handleUpsertItem}
            onDeleteItem={handleDeleteItem}
            onBulkImportItems={handleBulkImportItems}
            onUpdateSettings={(newSettings, deletedCatId) => {
              setSettings(newSettings);
              if (newSettings.pocketbaseUrl && navigator.onLine) {
                pushConfigToPocketBase(newSettings, deletedCatId ? [deletedCatId] : [])
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
