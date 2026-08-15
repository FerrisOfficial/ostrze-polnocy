# Bitwa pod Mostem

Dynamiczna gra 2D o dwóch bezdomnych walczących siekierkami pod miejskim wiaduktem — lokalnie przy jednej klawiaturze albo online ze znajomym przez kod pokoju.

## Zagraj

[Uruchom grę na GitHub Pages](https://ferrisofficial.github.io/ostrze-polnocy/)

Wybierz **Gra online**. Jedna osoba tworzy pokój i wysyła kod złożony z sześciu znaków, a druga wpisuje go w formularzu dołączania. Gospodarz steruje Mirkiem, a gość Staszkiem.

## Sterowanie

- Gracz 1 — `A` / `D`: ruch, `W`: skok, `F`: atak.
- Gracz 2 — `←` / `→`: ruch, `↑`: skok, `L`: atak.
- `P`: pauza (lokalnie albo po stronie gospodarza).

Na urządzeniach dotykowych gra wyświetla ekranowe przyciski sterowania.

## Uruchomienie lokalne

Wymagany jest Node.js 22.13 lub nowszy.

```bash
npm install
npm run dev
```

GitHub Actions automatycznie buduje statyczną wersję gry i publikuje ją w GitHub Pages po każdej zmianie na gałęzi `main`.

## Multiplayer na Cloudflare

Serwer pokojów znajduje się w katalogu `multiplayer/`. Każdy kod pokoju trafia do osobnego Cloudflare Durable Object, który przekazuje sterowanie gościa do gospodarza i stan walki z gospodarza do gościa przez WebSocket.

```bash
# lokalny Worker
npm run multiplayer:dev

# odtworzenie typów Env po zmianie konfiguracji
npm run multiplayer:types

# publikacja Workera i Durable Object
npm run multiplayer:deploy
```

Do wdrożenia potrzebne jest wcześniejsze `npx wrangler login`. Dozwolone adresy klienta są zapisane w `multiplayer/wrangler.jsonc` jako `ALLOWED_ORIGINS`.
