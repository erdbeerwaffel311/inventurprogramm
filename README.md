# Vereinskeller – Inventur & Bestands-App (PWA)

Niederschwelliges Inventur- und Bestandsprogramm für den Vereinskeller – optimiert für Smartphones (iOS & Android als installierbare Web-App) und PC, inklusive Offline-Modus für Keller ohne Empfang und kostenloser Multi-Geräte-Synchronisation über Supabase.

## Hauptfunktionen

- **Offener Buchungsbereich (ohne Login)**:
  - **Entnehmen**, **Zurückgeben** (inkl. Event-/Rückgabe-Modus für übrig gebliebene Reste & Leihgeräte) und **Befüllen / Einkauf**.
  - **Kategorisierte Klick-Liste (+/-)**: Schnelle Auswahl nach Kategorien, Unterstützung für Kisten + Einzelflaschen sowie angebrochene Einheiten (`+½`).
  - **Intelligente Textblock-Erkennung**: Kopierte WhatsApp-Nachrichten oder Listen einfügen – Mengen, Einheiten und Artikel werden lokal & offline automatisch erkannt (optional zusätzlich per Gemini/OpenAI API).
- **Logbuch & Automatische Einkaufsliste**:
  - Transparente Historie aller Buchungen inkl. Storno-Funktion.
  - Automatische Mindestbestand-Warnung, 1-Klick WhatsApp-Export und direkte Einbuchung erledigter Einkäufe.
- **Passwortgeschützter Admin-Bereich (Standard-Passwort: `admin`)**:
  - **Erstinventur-Schnellzählung** aller Artikel auf einer Seite.
  - **Eigene Kategorien & Artikel verwalten** (Anlegen, Bearbeiten, Löschen).
  - **CSV / Excel Import & Export** inkl. Mustervorlage (`1_resources/Vereinskeller_Erstinventur_Vorlage.csv`).
  - **Multi-Geräte Cloud-Sync (Supabase)** & druckbarer **Kellertür-QR-Code**, über den sich die Handys aller Vereinsmitglieder mit 1 Scan automatisch mit der Vereins-Datenbank verbinden.

---

## Auf GitHub hochladen & für alle Geräte online stellen

Dieses Repository ist bereits fertig konfiguriert für **GitHub Pages** (`.github/workflows/deploy.yml`), **Vercel** (`vercel.json`) und **Netlify** (`netlify.toml`).

1. Lege auf [GitHub.com](https://github.com/new) ein neues leeres Repository an (z. B. `vereinskeller`).
2. Verbinde dieses lokale Repository und lade es hoch:
   ```bash
   git remote add origin https://github.com/<DEIN-NUTZERNAME>/vereinskeller.git
   git push -u origin main
   ```
3. **Kostenloses Hosting aktivieren**:
   - **Option A (GitHub Pages)**: Gehe in deinem GitHub-Repository auf *Settings -> Pages* und wähle unter *Build and deployment -> Source* die Option **GitHub Actions**. Nach ca. 1 Minute ist deine App online!
   - **Option B (Vercel / Netlify)**: Importiere das GitHub-Repository kostenlos auf [vercel.com](https://vercel.com) oder [netlify.com](https://netlify.com) – die Einstellungen aus `vercel.json` bzw. `netlify.toml` werden automatisch erkannt.
