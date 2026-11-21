# Padelbot

Home Assistant App die de padelwedstrijden van een WhatsApp-groep organiseert:
aankondiging met peiling, teamvorming ("wie eerst ✅ stemt, speelt"), reservelijst,
gastspelers, herinneringen en speelhistoriek.

## Installeren in Home Assistant

1. Ga naar **Instellingen → Apps → App-winkel**.
2. Klik rechtsboven op **⋮ → Repositories**.
3. Voeg toe: `https://github.com/frederic1967/padelbot` en klik **Toevoegen**.
4. Sluit het venster, ververs de pagina en kies **Padelbot** onderaan de lijst.
5. Klik **Installeren** (de eerste keer duurt dit enkele minuten).
6. Volg de stappen in het tabblad **Documentatie** van de App.

## Voor ontwikkelaars

De code staat in `padelbot/app`. Testen: `npm install && npm test`.
Syntaxcontrole: `npm run check`.
