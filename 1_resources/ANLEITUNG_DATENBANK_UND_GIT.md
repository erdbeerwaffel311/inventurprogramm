# Anleitung: Vereinskeller-App (Datenbank, Git-Hosting & Handy-Installation)

## 1. Sofort lokal auf dem Mac starten
Du kannst die fertige App direkt über die Datei `4_final/Vereinskeller_Starten.command` per Doppelklick starten oder im Ordner `2_code` mit `npm run dev`.
- **Standard-Admin-Passwort**: `admin` (kann im Admin-Bereich unter *4. Datenbank, QR-Code & Passwort* geändert werden).

---

## 2. Kostenlose Cloud-Datenbank (Supabase) einrichten (Dauer: ca. 2 Minuten)
Damit alle Vereinsmitglieder von ihren eigenen Handys auf denselben Kellerbestand zugreifen können:

1. Gehe auf [https://supabase.com](https://supabase.com) und erstelle ein kostenloses Konto + neues Projekt (Free Tier reicht dauerhaft locker für einen Verein).
2. Klicke links im Supabase-Menü auf **SQL Editor**, füge den Inhalt aus `1_resources/supabase_schema.sql` (oder über den Kopier-Button direkt im Admin-Bereich der App) ein und klicke auf **Run**.
3. Kopiere unter **Project Settings -> Data API** die **Project URL** sowie den **anon / public Key** und trage beide im Admin-Bereich deiner App ein.

---

## 3. Über Git-Repository kostenlos für alle Handys bereitstellen
Wenn du ein Git-Repository (z. B. bei GitHub) anlegst, kannst du die App in 1 Minute kostenlos online stellen (z. B. über **Vercel**, **Netlify** oder **GitHub Pages**):

1. Lade den Inhalt von `2_code` in dein Git-Repository hoch (oder verbinde das Repository mit Vercel/Netlify mit Root Directory `2_code`).
2. Sobald die App online ist, öffne den **Admin-Bereich -> 4. Datenbank, QR-Code & Passwort**, trage deine Supabase-Daten ein und klicke auf **„Aushang drucken“**.
3. **Magischer QR-Code für die Kellertür**: Der gedruckte QR-Code enthält bereits die Datenbank-Verbindung! Jedes Vereinsmitglied scannt einfach einmalig den QR-Code an der Kellertür mit der Handy-Kamera und ist sofort mit eurer Datenbank verbunden – ohne Login, ohne Passwort und ohne technische Einrichtung.

---

## 4. Als echte Handy-App installieren (iPhone & Android)
- **iPhone (Safari)**: Link öffnen -> Unten auf das **Teilen-Symbol** tippen -> **„Zum Home-Bildschirm“** wählen.
- **Android (Chrome)**: Link öffnen -> Oben rechts auf das Menü (**⋮**) -> **„App installieren“** / **„Zum Startbildschirm hinzufügen“**.

Die App funktioniert dank integriertem Offline-Speicher (`Service Worker` + lokaler Warteschlange) **auch tief im Keller ohne Empfang** und synchronisiert alle Buchungen automatisch, sobald man wieder Empfang hat.
