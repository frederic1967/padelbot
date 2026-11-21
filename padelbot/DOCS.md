# Padelbot

De Padelbot organiseert de padelwedstrijden van jullie WhatsApp-groep. We spelen op de
**1e en 3e woensdag** van elke maand, met **4 spelers** per wedstrijd.

## Wat de bot doet

| Wanneer | Bericht in de groep |
|---|---|
| Dinsdag, 8 dagen vooraf, 18:00 | Aankondiging, overzicht van wie hoeveel keer meespeelde (vorige 6 wedstrijden) en een peiling ✅ Ja / ❌ Nee |
| Woensdag, 7 dagen vooraf, 18:00 | Het team staat vast (en "Wie reserveert het terrein?"), of er ontbreken nog spelers |
| Donderdag, 6 dagen vooraf, 18:00 | Alleen als het team niet volledig is: één herinnering |
| Op elk moment | Team volledig, iemand haakt af, een reserve schuift door |

- De **eerste 4** die ✅ stemmen, spelen. Wie later ✅ stemt, staat op de **reservelijst**.
- Zet iemand van het team zijn stem op ❌, dan schuift de eerste reserve automatisch door.
- **Gastspelers** vullen lege plaatsen aan. Een groepslid heeft altijd voorrang op een gast.
- Na de speeldag wordt de wedstrijd automatisch in de historiek gezet.

## Commando's in de groep

| Commando | Wat het doet |
|---|---|
| `!gast Marc` | Gastspeler toevoegen |
| `!gast weg Marc` | Gastspeler verwijderen |
| `!gereserveerd` | Melden dat het terrein gereserveerd is |
| `!geen` | De wedstrijd gaat niet door |
| `!status` | Stand van de volgende wedstrijd |
| `!naam Jan` | Je naam in de berichten instellen |
| `!historiek` | Alle vorige wedstrijden |
| `!help` | Lijst met commando's |

## Eerste keer instellen

1. Zorg dat het **botnummer** (de eSIM) een WhatsApp-account heeft en lid is van de groep.
2. Vul bij **Configuratie** de **naam van de WhatsApp-groep** in, exact zoals in WhatsApp.
   Begin met je testgroep.
3. Start de App en open **Open webinterface** (of "Padelbot" in de zijbalk).
4. Koppel de bot:
   - Open WhatsApp op je telefoon en wissel naar het **bot-account**.
   - Ga naar **Instellingen → Gekoppelde apparaten → Apparaat koppelen**.
   - Scan de QR-code op de statuspagina.
   - Bekijk je Home Assistant op dezelfde telefoon? Vul dan bij Configuratie het
     **telefoonnummer van de bot** in en herstart de App. Je krijgt dan een code die je in
     WhatsApp invult via **Koppelen met telefoonnummer**.
5. De statuspagina toont "verbonden" en de naam van de groep. Klaar.

## Meldingen voor de beheerder

De bot waarschuwt je als de WhatsApp-koppeling verbroken is, en wanneer de eSIM herladen moet
worden. Standaard verschijnt dat als melding in Home Assistant. Gebruik je de Home Assistant-app
op je telefoon, vul dan bij **Meldingen voor de beheerder** bv. `notify.mobile_app_jouw_telefoon`
in voor een pushmelding.

## eSIM herladen

Vul bij **Laatste herlading eSIM** de datum van je laatste herlading in (bv. `2026-11-25`).
De bot herinnert je 30, 14 en 3 dagen voor het nummer na een jaar zou vervallen. Pas na het
herladen de datum aan en herstart de App.

## Gegevens

Alles staat in de App zelf (`/data`) en zit in je gewone Home Assistant-back-ups.
